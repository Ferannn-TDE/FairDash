import { NextRequest, NextResponse, after } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { fireAndForgetFirebaseUpdate } from '@/lib/firebase-sync'
import { enqueueRefund } from '@/lib/order-side-effects'
import { enforceRateLimit } from '@/lib/ratelimit'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'

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

<<<<<<< Updated upstream
    const { allowed, headers: rlHeaders } = await enforceRateLimit(`vendor-status:${clerkId}`, 'vendorStatus')
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests — slow down.' }, { status: 429, headers: rlHeaders })
=======
    const { allowed: rlAllowed } = await enforceRateLimit(clerkId, 'vendorStatus', { failClosed: false })
    if (!rlAllowed) {
      return NextResponse.json(
        { error: 'Too many requests — slow down.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
>>>>>>> Stashed changes
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

    // Validate transition
    const validTransitions = ALLOWED_TRANSITIONS[vendorStatus.status]
    if (!validTransitions?.includes(newStatus)) {
      throw new ApiError(
        `Cannot transition from ${vendorStatus.status} to ${newStatus}`,
        409,
        'INVALID_TRANSITION'
      )
    }

    const TIMESTAMP_FIELD: Record<string, string> = {
      ACCEPTED:  'acceptedAt',
      PREPARING: 'preparingAt',
      READY:     'readyAt',
      COMPLETED: 'completedAt',
      DECLINED:  'declinedAt',
    }

    // Apply the vendor-level status update + set the corresponding timestamp
    const tsField = TIMESTAMP_FIELD[newStatus]
    const updated = await db.vendorOrderStatus.update({
      where: { orderId_vendorId: { orderId, vendorId } },
      data: {
        status: newStatus,
        ...(tsField ? { [tsField]: new Date() } : {}),
      },
    })

    // Invalidate analytics cache when this vendor's portion completes
    if (newStatus === 'COMPLETED') {
      revalidateTag(`analytics-${vendorId}`, 'default')
      revalidateTag(`stats-${vendorId}`,     'default')
      revalidateTag(`revenue-${vendorId}`,   'default')
    }

    // Check aggregate state across all vendors to decide master order update
    const allStatuses = await db.vendorOrderStatus.findMany({
      where: { orderId },
      select: { status: true, vendorId: true },
    })

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, eventId: true, customerId: true, vendorId: true,
        stripePaymentIntentId: true, stripeChargeId: true,
      },
    })
    if (!order) return apiError('Order not found', 404, 'ORDER_NOT_FOUND')

    const allDeclined  = allStatuses.every(s => s.status === 'DECLINED')
    const allTerminal  = allStatuses.every(s => ['COMPLETED', 'DECLINED'].includes(s.status))

    if (allDeclined) {
      // Every vendor declined — cancel the master order and refund
      await db.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'vendor' },
      })

      // Enqueue Stripe refund (async, idempotent via jobId dedup)
      if (order.stripePaymentIntentId) {
        try {
          await enqueueRefund({
            orderId,
            vendorId: order.vendorId,
            eventId: order.eventId,
            stripePaymentIntentId: order.stripePaymentIntentId,
            stripeChargeId: order.stripeChargeId,
            refundReason: 'all_vendors_declined',
          })
        } catch (err) {
          console.error('[VendorStatus] Failed to enqueue refund job:', err)
        }
      }

      // Firebase — notify customer of cancellation
      after(() =>
        fireAndForgetFirebaseUpdate(
          `fairs/${order.eventId}/customerOrders/${order.customerId}/${orderId}`,
          { status: 'CANCELLED', updatedAt: Date.now() },
          { orderId }
        )
      )
    } else if (allTerminal) {
      // Some completed, some declined — master order done
      await db.order.update({ where: { id: orderId }, data: { status: 'COMPLETED', completedAt: new Date() } })
      revalidateTag(`analytics-${vendorId}`, 'default')
      revalidateTag(`stats-${vendorId}`,     'default')
      revalidateTag(`revenue-${vendorId}`,   'default')

      after(() =>
        fireAndForgetFirebaseUpdate(
          `fairs/${order.eventId}/customerOrders/${order.customerId}/${orderId}`,
          { status: 'COMPLETED', updatedAt: Date.now() },
          { orderId }
        )
      )
    }

    // Always update both RTDB paths on every vendor status transition.
    // Vendor path: used by the vendor dashboard Firebase listener.
    // Customer path: used by the customer order tracking page — must fire on
    // every transition so the customer sees ACCEPTED/PREPARING/READY in real time,
    // not only when all vendors reach a terminal state.
    const now = Date.now()
    after(() => {
      fireAndForgetFirebaseUpdate(
        `fairs/${order.eventId}/orders/${vendorId}/${orderId}`,
        { status: newStatus, updatedAt: now },
        { orderId }
      )
      fireAndForgetFirebaseUpdate(
        `fairs/${order.eventId}/customerOrders/${order.customerId}/${orderId}`,
        { status: newStatus, vendorId, updatedAt: now },
        { orderId }
      )
    })

    return success({ vendorId, orderId, status: newStatus })
  } catch (err) {
    return handleApiError(err)
  }
}
