import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { resolveOwnedFair } from '@/lib/organizer-fair-context'
import { refundVendorPortion } from '@/lib/process-refund'
import { logger } from '@/lib/logger'

// POST /api/organizer/fairs/[fairSlug]/orders/[orderId]/refund
// body: { vendorId?: string, reason?: string }
//
// Admin/organizer per-vendor refund (decisions A + B). Routes through the SINGLE
// refund engine — refundVendorPortion — which refunds the vendor's SUBTOTAL
// SLICE ONLY (10% service fee never refunded) and, if the payout already fired,
// reverses the transfer (CASE 2). NEVER calls Stripe directly here.
//   • body.vendorId set → refund that one vendor's portion.
//   • body.vendorId omitted → full-order refund = refund EVERY vendor portion
//     (looped through the same engine; the fee is still kept on every slice).
// Any matching pending customer RefundRequest is marked APPROVED on success.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string; orderId: string }> }
) {
  try {
    const { organizerId, clerkId } = await requireOrganizerAuth()
    const { fairSlug, orderId } = await params

    // MONEY CARVE-OUT: refunds must stay reachable AFTER a fair is soft-deleted,
    // so this resolves with includeArchived — it must NOT adopt the default
    // (archived-excluding) resolver, or deleting a fair would strand its refunds.
    const event = await resolveOwnedFair(fairSlug, organizerId, { includeArchived: true })

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, eventId: true, voidedAt: true, orderItems: { select: { vendorId: true } } },
    })
    if (!order) return apiError('Order not found', 404, 'NOT_FOUND')
    if (order.eventId !== event.id) return apiError('Access denied', 403, 'FORBIDDEN')
    if (order.voidedAt) return apiError('Order is out of model — not refundable', 422, 'UNPROCESSABLE')

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const body = await req.json().catch(() => ({})) as { vendorId?: string; reason?: string }
    const reason = body.reason ? String(body.reason).slice(0, 300) : 'Refund issued by organizer'

    const allVendorIds = [...new Set(order.orderItems.map(i => i.vendorId))]
    if (body.vendorId && !allVendorIds.includes(body.vendorId)) {
      return apiError('Vendor is not on this order', 400, 'VALIDATION_ERROR')
    }
    const targets = body.vendorId ? [body.vendorId] : allVendorIds

    logger.info('[Organizer] Per-vendor refund initiated', { orderId, organizerId, targets, reason })

    const results: Array<{ vendorId: string; case: 1 | 2 | null; status: string; refundId: string | null; reversalId: string | null; negativeBalanceCents: number }> = []
    for (const vendorId of targets) {
      try {
        const res = await refundVendorPortion({ orderId, vendorId, reason, actor: dbUser.id, moneyActor: { id: dbUser.id, type: 'organizer' } })
        results.push({
          vendorId, case: res.case, status: res.status,
          refundId: res.stripeRefundId, reversalId: res.stripeReversalId,
          negativeBalanceCents: res.negativeBalanceCents,
        })
        await db.refundRequest.updateMany({
          where: { orderId, vendorId, status: 'PENDING' },
          data: { status: 'APPROVED', resolvedBy: dbUser.id, resolvedAt: new Date() },
        })
      } catch (err) {
        logger.error('[Organizer] Refund failed for vendor portion', { orderId, vendorId, error: String(err) })
        return apiError(
          `Refund failed for vendor ${vendorId}: ${err instanceof Error ? err.message : 'unknown error'}`,
          502, 'REFUND_FAILED',
        )
      }
    }

    void db.orderEvent.create({
      data: { orderId, eventType: 'refund_initiated', actorId: dbUser.id, actorRole: 'organizer', metadata: { reason, targets, results } },
    }).catch(() => {})

    return success({ orderId, refunds: results })
  } catch (err) {
    return handleApiError(err)
  }
}
