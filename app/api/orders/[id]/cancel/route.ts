import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { reconcileMasterStatus } from '@/lib/reconcile-order-status'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/ratelimit'
import { refundVendorPortion } from '@/lib/process-refund'
import { logger } from '@/lib/logger'

// PATCH /api/orders/:id/cancel   body: { vendorId?: string, reason?: string }
//
// Customer-initiated cancel — PER-VENDOR, decision E:
//   • A vendor portion still PLACED & unaccepted → auto-refund that slice
//     (refundVendorPortion CASE 1; no transfer existed). Service fee NEVER
//     refunded (decision B). The portion is marked REFUNDED by the engine.
//   • A vendor portion already ACCEPTED/PREPARING/READY → the customer CANNOT
//     self-refund. We file a RefundRequest (PENDING) for an admin/organizer to
//     approve, which then runs the SAME engine. Money does NOT move here.
//   • Terminal portions (COMPLETED/DECLINED/REFUNDED/CANCELLED) → skipped.
//
// If body.vendorId is given, only that portion is acted on; otherwise every
// portion. The master order flips to CANCELLED only once all portions are
// terminal (and none completed). This route NEVER calls Stripe directly — all
// money flows through the per-vendor refund engine.
//
// TIP POLICY (Part A): cancellations here are PRE-runner-delivery, so no runner
// has earned the tip (RunnerEarning is only recorded on DELIVERED). Per the
// locked policy, a tip with no runner to pay it to is OWED BACK to the customer
// — it is NOT kept by FairSynq. The per-vendor refund engine refunds vendor
// SUBTOTAL slices only and never touches the tip; the tip's customer-refund is a
// money-OUT movement (same class as runner/organizer payout) tracked for the
// refund/payout money-flow phase. The reconciler's tip-accounting guard ALERTS
// any tip left in limbo (charged, order cancelled, no runner, not yet refunded)
// so it is never SILENTLY retained as revenue.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAuth()
    const { id: orderId } = await params

    const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? clerkId
    const { allowed } = await enforceRateLimit(ip, 'refund', { failClosed: false })
    if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

    const body = await req.json().catch(() => ({})) as { vendorId?: string; reason?: string }
    const reason = body.reason ? String(body.reason).slice(0, 300) : 'Customer requested cancellation'

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, customerId: true, eventId: true, voidedAt: true,
        vendorOrderStatuses: { select: { vendorId: true, status: true } },
      },
    })
    if (!order) return apiError('Order not found', 404, 'ORDER_NOT_FOUND')
    if (order.voidedAt) return apiError('Order is not cancellable', 409, 'CANCEL_NOT_ALLOWED')

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')
    if (order.customerId !== dbUser.id) return apiError('Access denied', 403, 'FORBIDDEN')

    let portions = order.vendorOrderStatuses
    if (body.vendorId) {
      portions = portions.filter(p => p.vendorId === body.vendorId)
      if (portions.length === 0) return apiError('Vendor portion not found on this order', 404, 'NOT_FOUND')
    }

    const refunded: string[] = []
    const requested: string[] = []
    const skipped: string[] = []

    for (const p of portions) {
      if (p.status === 'PLACED') {
        try {
          const res = await refundVendorPortion({
            orderId, vendorId: p.vendorId, reason: 'customer_cancelled_preaccept', actor: dbUser.id,
          })
          if (res.status !== 'noop') refunded.push(p.vendorId); else skipped.push(p.vendorId)
        } catch (err) {
          logger.error('[Cancel] pre-accept refund failed', { orderId, vendorId: p.vendorId, error: String(err) })
          return apiError('Refund could not be processed — please contact support', 502, 'REFUND_FAILED')
        }
      } else if (['ACCEPTED', 'PREPARING', 'READY'].includes(p.status)) {
        await db.refundRequest.upsert({
          where: { orderId_vendorId: { orderId, vendorId: p.vendorId } },
          create: { eventId: order.eventId, orderId, vendorId: p.vendorId, reason, status: 'PENDING', requestedBy: dbUser.id },
          update: {}, // preserve an existing request
        })
        requested.push(p.vendorId)
      } else {
        skipped.push(p.vendorId)
      }
    }

    // Flip master order → CANCELLED through the single aggregator, supplying the
    // customer-cancel INTENT it can't derive from status alone (all-refunded looks
    // identical to completed-then-refunded). The aggregator applies CANCELLED only
    // when every portion is terminal & none completed, behind canAdvance — so this
    // ALSO fixes the latent bug where the old unguarded update could regress an
    // already-COMPLETED order to CANCELLED. The per-portion refunds/refund-requests
    // above stay here (caller-specific). The Cancellation audit row likewise stays
    // here for now (Phase 4 decides uniform ownership once W7 is in scope).
    const rec = await reconcileMasterStatus(orderId, { cancel: { by: 'customer', reason } })
    if (rec.wrote) {
      await db.cancellation.upsert({
        where: { orderId },
        // Pure audit (who/when/why). Refund truth lives in Refund rows — the
        // deprecated refundIssued/refundAmount are no longer written (readers derive).
        create: { orderId, vendorId: order.vendorOrderStatuses[0]?.vendorId ?? '', reason },
        update: { reason },
      })
    }

    return success({
      orderId,
      refundedVendors: refunded,    // slice refunded (fee kept), portion REFUNDED
      requestedVendors: requested,  // pending organizer approval (post-acceptance)
      skippedVendors: skipped,
      message: requested.length && !refunded.length
        ? 'Vendor has accepted — a refund request was submitted for organizer approval.'
        : undefined,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
