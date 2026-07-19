import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { refundVendorPortion } from '@/lib/process-refund'
import { writeMoneyAudit } from '@/lib/admin-money'
import { logger } from '@/lib/logger'

// POST /api/admin/events/[id]/money/refund
// Body: { orderId, vendorId?, reason }   — vendorId omitted = refund EVERY vendor portion
//
// C1 — the ADMIN control point into the refund engine.
//
// WHY THIS ROUTE EXISTS AT ALL: the refund engine was previously reachable ONLY via
// /api/organizer/... behind requireOrganizerAuth, which demands an OrgMember row. An
// AdminUser does not have one — so the platform admin literally could not issue a
// refund on their own platform. This is that missing door.
//
// It is a NEW DOOR, not a loosened lock: we do NOT relax requireOrganizerAuth to let
// admins through (that would weaken the organizer boundary for everyone). Admin comes
// in through the admin chokepoint, which independently proves STRICT platform admin.
//
// Routes through the SINGLE refund engine (refundVendorPortion) — never raw Stripe.
// The engine owns CASE 1 (refund before payout: no reversal needed) vs CASE 2 (refund
// after payout: reverse the transfer), and never refunds the 10% service fee.
//
// NOTE ON HELD MONEY: an admin hold gates the PAYOUT, not the refund. Refunding a
// held slice is correct and allowed — the money is still in the platform balance, so
// it goes straight back to the customer (CASE 1, no clawback needed). Holding first
// and refunding second is in fact the cleanest possible sequence.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { event, adminClerkId } = await requireAdminFairContext(id)

    const body = (await req.json().catch(() => ({}))) as {
      orderId?: unknown
      vendorId?: unknown
      reason?: unknown
    }

    if (typeof body.orderId !== 'string' || !body.orderId) {
      throw new ApiError('orderId is required', 400, 'VALIDATION_ERROR')
    }
    if (typeof body.reason !== 'string' || !body.reason.trim()) {
      throw new ApiError('reason is required for every admin money action', 400, 'REASON_REQUIRED')
    }
    const reason = body.reason.slice(0, 300)

    const order = await db.order.findUnique({
      where: { id: body.orderId },
      select: { id: true, eventId: true, voidedAt: true, orderItems: { select: { vendorId: true } } },
    })
    if (!order) throw new ApiError('Order not found', 404, 'NOT_FOUND')
    // Fair scoping: an admin acting in Fair A cannot refund Fair B's order, even with
    // a valid order id. The chokepoint resolved WHICH fair; this binds the order to it.
    if (order.eventId !== event.id) throw new ApiError('Order is not in this fair', 404, 'NOT_FOUND')
    if (order.voidedAt) throw new ApiError('Order is out of model — not refundable', 422, 'UNPROCESSABLE')

    // The engine records an actor as a User id.
    const adminUser = await db.user.findUnique({ where: { clerkId: adminClerkId }, select: { id: true } })
    if (!adminUser) throw new ApiError('Admin user record not found', 404, 'NOT_FOUND')

    const allVendorIds = [...new Set(order.orderItems.map(i => i.vendorId))]
    if (typeof body.vendorId === 'string' && body.vendorId && !allVendorIds.includes(body.vendorId)) {
      throw new ApiError('Vendor is not on this order', 400, 'VALIDATION_ERROR')
    }
    const targets = typeof body.vendorId === 'string' && body.vendorId ? [body.vendorId] : allVendorIds

    logger.warn('[AdminMoney] refund initiated by admin', {
      admin: adminClerkId, eventId: event.id, orderId: order.id, targets, reason,
    })

    const results = []
    for (const vendorId of targets) {
      const res = await refundVendorPortion({
        orderId: order.id, vendorId, reason, actor: adminUser.id,
        moneyActor: { id: adminClerkId, type: 'admin' },
      })

      // Audit EVERY refund, per vendor slice — same durable trail as hold/freeze, through the
      // ONE shared writer. This is the admin refund route, so the actor is 'admin'.
      await writeMoneyAudit({ id: adminClerkId, type: 'admin' }, event.id, {
        action: 'REFUND',
        payeeType: 'vendor', payeeId: vendorId, orderId: order.id,
        amountCents: res.sliceCents, reason,
        metadata: {
          case: res.case,
          status: res.status,
          stripeRefundId: res.stripeRefundId,
          stripeReversalId: res.stripeReversalId,
          negativeBalanceCents: res.negativeBalanceCents,
        },
      })

      results.push(res)
    }

    return success({ orderId: order.id, refunds: results })
  } catch (err) {
    return handleApiError(err)
  }
}
