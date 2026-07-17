import { NextRequest, NextResponse, after } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { fireAndForgetFirebaseUpdate } from '@/lib/firebase-sync'
import { reconcileMasterStatus } from '@/lib/reconcile-order-status'
import { refundVendorPortion } from '@/lib/process-refund'
import { enforceRateLimit } from '@/lib/ratelimit'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { logger } from '@/lib/logger'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'

// Valid per-vendor status transitions
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PLACED:    ['ACCEPTED', 'DECLINED'],
  ACCEPTED:  ['PREPARING'],
  PREPARING: ['READY'],
  READY:     ['COMPLETED'],
}

// PATCH /api/orders/:id/vendor-status
// Advances this vendor's portion of an order independently.
// Only affects VendorOrderStatus — the master Order.status is only updated
// when ALL vendors have reached a terminal state (COMPLETED or DECLINED).
// If ALL vendors decline → master order cancelled + Stripe refund issued.
// If ALL vendors complete/decline (mixed) → master order marked COMPLETED.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // ── Test-mode bypass (mirrors status/route.ts — see comment there) ────
    if (process.env.RATE_LIMIT_TEST === 'true') {
      const testId = req.headers.get('x-test-vendor-id')
      if (!testId) return apiError('Unauthorized', 401, 'UNAUTHORIZED')
      const { allowed, headers: rlHeaders } = await enforceRateLimit(`vendor-status:${testId}`, 'vendorStatus')
      if (!allowed) {
        return NextResponse.json({ error: 'Too many requests — slow down.' }, { status: 429, headers: rlHeaders })
      }
      return NextResponse.json({ ok: true }, { status: 200 })
    }

    const clerkId = await requireAuth()

    const { allowed, headers: rlHeaders } = await enforceRateLimit(`vendor-status:${clerkId}`, 'vendorStatus')
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests — slow down.' }, { status: 429, headers: rlHeaders })
    }

    const orderId = (await params).id

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    const { status: newStatus } = await req.json() as { status: string }
    if (!newStatus) throw new ApiError('status is required', 400, 'VALIDATION_ERROR')

    // Resolve the calling user's vendor membership — no vendorId known yet, so DB lookup
    const membership = await db.vendorMember.findFirst({
      where: { userId: dbUser.id },
      select: { vendorId: true },
    })
    if (!membership) return apiError('Access denied — not a vendor member', 403, 'FORBIDDEN')

    const { vendorId } = membership

    // Second-level auth: confirm this user is actually a member of that vendor (cache hit)
    const confirmedMember = await getVendorAuth(dbUser.id, vendorId, req)
    if (!confirmedMember) return apiError('Access denied — not a vendor member', 403, 'FORBIDDEN')

    // Load the VendorOrderStatus for this vendor
    const vendorStatus = await db.vendorOrderStatus.findUnique({
      where: { orderId_vendorId: { orderId, vendorId } },
    })
    if (!vendorStatus) {
      return apiError('This order does not include your vendor', 404, 'NOT_FOUND')
    }

    // Idempotent: if already in the target status, return success immediately
    if (vendorStatus.status === newStatus) {
      return success({ vendorId, orderId, status: newStatus })
    }

    // Validate transition
    const validTransitions = ALLOWED_TRANSITIONS[vendorStatus.status]
    if (!validTransitions?.includes(newStatus)) {
      throw new ApiError(
        `Cannot transition from ${vendorStatus.status} to ${newStatus}`,
        409,
        'INVALID_TRANSITION'
      )
    }

    // A RUNNER-FULFILLED order is completed by the RUNNER (RUNNER_COLLECTED → DELIVERED),
    // NOT by the vendor. Blocking READY → COMPLETED here stops a vendor marking a delivery
    // "done" while the food is still on their counter (claim == collect today) or in a
    // runner's car — the premature-completion bug. The system advances the vendor's VOS to
    // COMPLETED on the DELIVERED transition instead (see reconcile-order-status). CURBSIDE is
    // gated ONLY when the method is RUNNER_DELIVERS; CUSTOMER_WALKS curbside (and BOOTH_PICKUP)
    // are genuinely vendor-completed — no runner — so they stay allowed.
    //
    // ⚠️ ORDERING: this gate is SAFE only because the system-advance (VOS→COMPLETED on
    // DELIVERED) already exists. Without it, gating here would leave every delivery order
    // permanently at VOS=READY → a universal silent analytics under-report.
    if (newStatus === 'COMPLETED') {
      const ord = await db.order.findUnique({
        where: { id: orderId },
        select: { fulfillmentType: true, event: { select: { fulfillmentConfig: { select: { curbsideMethod: true } } } } },
      })
      const runnerFulfilled = !!ord && (
        ord.fulfillmentType === 'HOME_DELIVERY' ||
        (ord.fulfillmentType === 'CURBSIDE' && ord.event?.fulfillmentConfig?.curbsideMethod === 'RUNNER_DELIVERS')
      )
      if (runnerFulfilled) {
        return apiError('This delivery is completed by the runner, not the vendor', 409, 'RUNNER_COMPLETES_DELIVERY')
      }
    }

    const TIMESTAMP_FIELD: Record<string, string> = {
      ACCEPTED:  'acceptedAt',
      PREPARING: 'preparingAt',
      READY:     'readyAt',
      COMPLETED: 'completedAt',
      DECLINED:  'declinedAt',
    }

    // Apply the vendor-level status update, timestamp, and monotonic version counter.
    // version is used by the dashboard's onChildChanged handler to discard
    // out-of-order Firebase pushes — higher version always wins.
    const tsField = TIMESTAMP_FIELD[newStatus]
    const updated = await db.vendorOrderStatus.update({
      where: { orderId_vendorId: { orderId, vendorId } },
      data: {
        status:  newStatus,
        version: { increment: 1 },
        ...(tsField ? { [tsField]: new Date() } : {}),
      },
      select: { version: true },
    })

    // Audit log — fire-and-forget, never blocks response
    const auditActionMap: Record<string, string | undefined> = {
      ACCEPTED:  AUDIT_ACTIONS.ORDER_ACCEPTED,
      DECLINED:  AUDIT_ACTIONS.ORDER_DECLINED,
      PREPARING: AUDIT_ACTIONS.ORDER_MARKED_PREPARING,
      READY:     AUDIT_ACTIONS.ORDER_MARKED_READY,
      COMPLETED: AUDIT_ACTIONS.ORDER_COMPLETED,
    }
    const auditAction = auditActionMap[newStatus]
    if (auditAction) {
      logVendorAction(vendorId, dbUser.id, auditAction as Parameters<typeof logVendorAction>[2], { orderId })
    }

    // Revalidate analytics on every status change — decline must clear revenue immediately
    revalidateTag(`analytics-${vendorId}`, 'default')
    revalidateTag(`stats-${vendorId}`, 'default')
    revalidateTag(`revenue-${vendorId}`, 'default')

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, eventId: true, customerId: true, vendorId: true,
        stripePaymentIntentId: true, stripeChargeId: true,
      },
    })
    if (!order) return apiError('Order not found', 404, 'ORDER_NOT_FOUND')

    // A vendor declining their portion IS a per-vendor refund of that vendor's
    // slice (fee kept, reconciled) — route it through the SINGLE engine, not a
    // whole-order/fee-inclusive Stripe refund. markVendorStatus:false keeps the
    // portion DECLINED (its accurate terminal state, relied on by history); the
    // Refund row records the money. This also self-heals the old leak where a
    // single decline in a multi-vendor order refunded nothing. Don't block the
    // response; the reconciler (Pattern G/H) backstops a failed refund.
    if (newStatus === 'DECLINED' && order.stripePaymentIntentId) {
      try {
        await refundVendorPortion({ orderId, vendorId, reason: 'vendor_declined', actor: `vendor:${vendorId}`, markVendorStatus: false })
      } catch (err) {
        logger.error('[VendorStatus] per-vendor decline refund failed — reconciler will retry', { orderId, vendorId, error: String(err) })
      }
    }

    // ── Master status: the aggregator owns READY / COMPLETED / CANCELLED ──────
    // After writing this vendor's portion (and firing any per-decline refund
    // above), hand master-status derivation to the single aggregator. Behind
    // canAdvance it applies READY (all active ready), COMPLETED (BOOTH all-done →
    // enqueues the DELAYED payout behind the refund window), or CANCELLED (all
    // declined) — or no-ops. It is fulfillment-aware: a delivery order never
    // completes vendor-side (it clamps to READY; completion is the runner's
    // DELIVERED in W3). The per-decline refund (above) and the per-vendor
    // Firebase/stats pushes (below) STAY here — they are per-vendor-status
    // side-effects, not master-transition ones. Awaited so the runner feed /
    // payout are consistent on response; never throws (side-effects are
    // best-effort internally).
    try {
      await reconcileMasterStatus(orderId)
    } catch (err) {
      logger.error('[VendorStatus] master reconcile failed — reconciler/next transition will retry', { orderId, error: String(err) })
    }

    // Always update both RTDB paths on every vendor status transition.
    // Vendor path: lightweight payload — id + status + version only.
    //   onChildChanged on the dashboard reads this to sync cross-tab status moves.
    //   version is a monotonic ms timestamp used to discard stale out-of-order pushes.
    // Customer path: used by the customer order tracking page — must fire on
    //   every transition so the customer sees ACCEPTED/PREPARING/READY in real time.
    const now = Date.now()
    after(() => {
      fireAndForgetFirebaseUpdate(
        `fairs/${order.eventId}/orders/${vendorId}/${orderId}`,
        { id: orderId, status: newStatus, updatedAt: now, version: updated.version },
        { orderId }
      )
      fireAndForgetFirebaseUpdate(
        `fairs/${order.eventId}/customerOrders/${order.customerId}/${orderId}`,
        { status: newStatus, vendorId, updatedAt: now },
        { orderId }
      )
    })

    // Push live stats to vendorStats/{vendorId} on every status change.
    // Revenue is COMPLETED/DELIVERED only — decline must immediately zero it out.
    // Runs in after() so it doesn't block the API response.
    after(async () => {
      try {
        const startOfToday = new Date()
        startOfToday.setHours(0, 0, 0, 0)

        const [orderCount, revenueAgg] = await Promise.all([
          db.vendorOrderStatus.count({
            where: {
              vendorId,
              status: { in: ['COMPLETED', 'DELIVERED'] },
              order: { placedAt: { gte: startOfToday } },
            },
          }),
          db.orderItem.aggregate({
            where: {
              vendorId,
              createdAt: { gte: startOfToday },
              order: { vendorOrderStatuses: { some: { vendorId, status: { in: ['COMPLETED', 'DELIVERED'] } } } },
            },
            _sum: { totalPrice: true },
          }),
        ])

        // Vendor keeps their full item subtotal — no commission deducted.
        const todayRevenue = parseFloat(
          (revenueAgg._sum.totalPrice ?? 0).toFixed(2)
        )

        fireAndForgetFirebaseUpdate(
          `fairs/${order.eventId}/vendorStats/${vendorId}`,
          { todayOrders: orderCount, todayRevenue, updatedAt: Date.now() },
          { orderId }
        )
      } catch (err) {
        logger.error('[VendorStatus] Failed to push stats to Firebase', { orderId, error: String(err) })
      }
    })

    return success({ vendorId, orderId, status: newStatus })
  } catch (err) {
    return handleApiError(err)
  }
}
