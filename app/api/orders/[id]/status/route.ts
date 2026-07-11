import { NextRequest, NextResponse, after } from 'next/server'
import { revalidateTag } from 'next/cache'
import { OrderStatus, FulfillmentType, RunnerStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { placePaidOrder } from '@/lib/place-order'
import { reconcileMasterStatus } from '@/lib/reconcile-order-status'
import { fireAndForgetFirebaseUpdate } from '@/lib/firebase-sync'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { enforceRateLimit } from '@/lib/ratelimit'
import {
  getOrderQueue,
  JOB_UNCOLLECTED,
  JOB_UNDELIVERABLE,
} from '@/lib/queues'
import { enqueueOrderPayout } from '@/lib/order-side-effects'
import { refundVendorPortion } from '@/lib/process-refund'
import { enqueueJobSafely } from '@/lib/queue-safe'
import { CURBSIDE_WAIT_TIMEOUT_MS, ORDER_CANCELLATION_FEE_USD, HOME_DELIVERY_GPS_RADIUS_M, REFUND_WINDOW_MS } from '@/lib/constants'
import { logger } from '@/lib/logger'

// PATCH /api/orders/:id/status
// Advance an order through its lifecycle.
//
// Vendor-initiated transitions (caller must be a VendorMember):
//   PLACED     → ACCEPTED  | CANCELLED
//   ACCEPTED   → PREPARING | CANCELLED
//   PREPARING  → READY     | CANCELLED
//   READY      → COMPLETED | CANCELLED   (BOOTH_PICKUP only — delivery orders go via runner)
//
// Runner-initiated transitions (caller must be the assigned runner):
//   READY            → RUNNER_COLLECTED  (runner picks up from vendor)
//   RUNNER_COLLECTED → DELIVERED         (runner delivers; requires photoUrl + GPS for HOME_DELIVERY)
//
// Side-effects per transition:
//   → READY:     schedule BullMQ delayed job (UNCOLLECTED / UNDELIVERABLE)
//   → COMPLETED / DELIVERED: enqueue process-vendor-payout BullMQ job (Stripe transfer async)
//   → CANCELLED: write Cancellation record + enqueue process-refund BullMQ job (Stripe refund async)
//   All:         Firebase RTDB write to orders/{vendorId}/{orderId}
//                             and customerOrders/{customerId}/{orderId}

// ─── Transition tables ────────────────────────────────────────────────────────

// Customer-initiated: payment confirmation (client-side fallback for when webhook is delayed)
const CUSTOMER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PLACED],
}

const VENDOR_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.PLACED]:    [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  [OrderStatus.ACCEPTED]:  [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY, OrderStatus.CANCELLED],
  [OrderStatus.READY]:     [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
}

// Runner-only transitions
const RUNNER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.READY]:            [OrderStatus.RUNNER_COLLECTED],
  [OrderStatus.RUNNER_COLLECTED]: [OrderStatus.DELIVERED],
}

// ─── Haversine distance check ─────────────────────────────────────────────────

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // ── Test-mode bypass: auth mocked via header, DB work skipped ─────────
    // Allows rate-limit integration tests without real Clerk tokens or DB state.
    // Guard: only active when RATE_LIMIT_TEST=true (never set in production).
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

    // ── 1. Load order ──────────────────────────────────────────────────────
    const order = await db.order.findUnique({
      where: { id: (await params).id },
      include: { vendor: true },
    })

    if (!order) return apiError('Order not found', 404, 'ORDER_NOT_FOUND')

    // ── 2. Identify caller and parse body ─────────────────────────────────
    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    const body = await req.json()
    const { status: newStatus, reason, photoUrl, lat, lng } = body as {
      status: OrderStatus
      reason?: string
      photoUrl?: string   // runner delivery confirmation photo
      lat?: number        // runner GPS lat
      lng?: number        // runner GPS lng
    }

    if (!newStatus) {
      throw new ApiError('status is required', 400, 'VALIDATION_ERROR')
    }

    // ── 3. Determine caller role and validate transition ───────────────────

    // Customer payment confirmation: PENDING_PAYMENT → PLACED
    // Auth: caller must be the order's customer (not vendor/runner)
    const isCustomerTransition = CUSTOMER_TRANSITIONS[order.status]?.includes(newStatus) ?? false
    if (isCustomerTransition) {
      if (order.customerId !== dbUser.id) {
        return apiError('Access denied', 403, 'FORBIDDEN')
      }
      // Idempotent — if the webhook already placed the order, this is a no-op
      if (order.status !== OrderStatus.PENDING_PAYMENT) {
        return success({ orderId: order.id, status: order.status })
      }
      // Fast-path placement on client confirm. NEVER trust the client that
      // payment succeeded — verify the PaymentIntent with Stripe first, so a
      // customer can't place an unpaid order by calling this endpoint directly.
      if (!order.stripePaymentIntentId) {
        return apiError('Order has no payment intent', 409, 'NO_PAYMENT_INTENT')
      }
      const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId)
      if (pi.status !== 'succeeded') {
        return apiError('Payment has not completed', 409, 'PAYMENT_NOT_COMPLETED')
      }
      // Shared, idempotent placement — webhook will run the same path as backstop.
      await placePaidOrder(order.id, (pi.latest_charge as string | null) ?? undefined)
      return success({ orderId: order.id, status: OrderStatus.PLACED })
    }

    const isRunnerTransition =
      newStatus === OrderStatus.RUNNER_COLLECTED ||
      newStatus === OrderStatus.DELIVERED

    if (isRunnerTransition) {
      // Runner must have a record and be assigned to this event's order
      const runner = await db.runner.findUnique({ where: { userId: dbUser.id } })
      if (!runner || runner.eventId !== order.eventId) {
        return apiError('Access denied — not a runner for this event', 403, 'FORBIDDEN')
      }

      // Approval gate — re-verified INDEPENDENTLY here; never assume the go-online
      // gate already ran (the claim route must stand on its own).
      if (runner.approvalStatus !== 'APPROVED') {
        return apiError('Runner account is not approved', 403, 'RUNNER_NOT_APPROVED')
      }
      // ACTIVE gate — closes the "OFFLINE runner claims via direct API" hole. Applies
      // to the CLAIM (READY -> RUNNER_COLLECTED) ONLY — NEVER to DELIVERED, so a
      // runner who claimed then went offline/was rejected can still complete the
      // delivery instead of stranding the customer's food.
      if (newStatus === OrderStatus.RUNNER_COLLECTED && runner.status !== RunnerStatus.ACTIVE) {
        return apiError('Must be online (ACTIVE) to claim a delivery', 403, 'RUNNER_NOT_ACTIVE')
      }

      const allowedRunnerNext = RUNNER_TRANSITIONS[order.status]
      if (!allowedRunnerNext?.includes(newStatus)) {
        throw new ApiError(
          `Cannot transition from ${order.status} to ${newStatus}`,
          409,
          'INVALID_TRANSITION'
        )
      }

      // Only HOME_DELIVERY and CURBSIDE orders go through runner flow
      if (
        order.fulfillmentType === FulfillmentType.BOOTH_PICKUP
      ) {
        throw new ApiError('BOOTH_PICKUP orders do not use runner transitions', 409, 'INVALID_TRANSITION')
      }

      // DELIVERED requires a photo
      if (newStatus === OrderStatus.DELIVERED && !photoUrl) {
        throw new ApiError('photoUrl is required to mark an order as delivered', 400, 'VALIDATION_ERROR')
      }

      // ── RACE-SAFE CLAIM ──────────────────────────────────────────────────
      // Two runners may tap "Claim" on the same order at the same instant. The
      // claim MUST be a single atomic conditional update — never a read-then-write
      // (the stale `!order.runnerId` check + separate update had a race window
      // where both runners passed the check and both claimed). Same atomic-flip
      // pattern as placePaidOrder. `runnerId IS NULL` is the contested guard:
      // exactly one updateMany returns count 1 (the winner); the loser gets 0.
      if (newStatus === OrderStatus.RUNNER_COLLECTED && order.runnerId !== runner.id) {
        const claim = await db.order.updateMany({
          // Atomic AND status-aware: only an unclaimed, still-READY row matches. The
          // status guard means a claim landing after the UNDELIVERABLE timeout fired
          // can't even set runnerId on the terminal order (no stray assignment) —
          // the resurrection is prevented at the claim, with canAdvance as backstop.
          where: { id: order.id, runnerId: null, status: OrderStatus.READY },
          data: { runnerId: runner.id, dispatchedAt: new Date() },
        })
        if (claim.count === 0) {
          // Lost the claim, or the order is no longer a claimable READY one (e.g. it
          // already timed out). Bail BEFORE the status flip.
          return apiError('This delivery is no longer claimable', 409, 'ALREADY_CLAIMED')
        }
      }

      // Only the ASSIGNED runner may mark their order delivered — never another runner.
      if (newStatus === OrderStatus.DELIVERED && order.runnerId !== runner.id) {
        return apiError('This delivery is assigned to another runner', 403, 'NOT_YOUR_DELIVERY')
      }

      // ── Phase 4: runner status via the aggregator ──────────────────────────
      // The atomic claim above won the assignment (runnerId, race-safe). Now write
      // the runner DATA (delivery proof) and let the aggregator DERIVE the master
      // status from the persistent columns — RUNNER_COLLECTED from runnerId,
      // DELIVERED from curbsidePhotoUrl — behind canAdvance. The aggregator owns the
      // status write (gaining the monotonic guard) AND the DELIVERED side-effects
      // (RunnerEarning + OrganizerEarning accrual + delayed payout). Returns here so
      // runner transitions never reach the legacy monolithic update below.
      if (newStatus === OrderStatus.DELIVERED) {
        await db.order.update({
          where: { id: order.id },
          data: {
            curbsidePhotoUrl: photoUrl ?? null,
            ...(lat != null ? { runnerConfirmedLat: lat } : {}),
            ...(lng != null ? { runnerConfirmedLng: lng } : {}),
          },
        })
      }
      const rec = await reconcileMasterStatus(order.id)
      if (!rec.wrote) {
        return apiError(rec.reason, 409, 'INVALID_TRANSITION')
      }
      return success({ orderId: order.id, status: rec.to })
    } else {
      // Vendor-initiated transition
      const isMember = await getVendorAuth(dbUser.id, order.vendorId, req)
      if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

      const allowed = VENDOR_TRANSITIONS[order.status]
      if (!allowed) {
        throw new ApiError(
          `Order in ${order.status} state cannot be advanced`,
          409,
          'INVALID_TRANSITION'
        )
      }

      if (!allowed.includes(newStatus)) {
        throw new ApiError(
          `Cannot transition from ${order.status} to ${newStatus}`,
          409,
          'INVALID_TRANSITION'
        )
      }
    }

    // ── 4. Build timestamp + data patch ───────────────────────────────────
    const timestampPatch: Record<string, Date | null> = {}
    if (newStatus === OrderStatus.ACCEPTED)         timestampPatch.acceptedAt  = new Date()
    if (newStatus === OrderStatus.READY)            timestampPatch.readyAt     = new Date()
    if (newStatus === OrderStatus.COMPLETED)        timestampPatch.completedAt = new Date()
    if (newStatus === OrderStatus.CANCELLED)        timestampPatch.cancelledAt = new Date()

    // NOTE: runner transitions (RUNNER_COLLECTED/DELIVERED) returned above, routed
    // through the aggregator. This monolithic update handles the remaining
    // (legacy/vendor + customer-confirm) transitions only.

    // ── 5. Apply DB update (status + timestamps) ──────────────────────────
    const updatedOrder = await db.order.update({
      where: { id: order.id },
      data: {
        status: newStatus,
        ...(newStatus === OrderStatus.ACCEPTED && {
          startedAt: new Date(),
          cancellationFee: ORDER_CANCELLATION_FEE_USD,
        }),
        ...(newStatus === OrderStatus.CANCELLED && {
          cancelledBy: 'vendor',
          cancellationReason: reason ?? null,
        }),
        ...timestampPatch,
      },
    })

    // ── 6. Side-effects per transition ─────────────────────────────────────

    // 6a. READY → schedule delayed BullMQ job ──────────────────────────────
    if (newStatus === OrderStatus.READY) {
      const queue = getOrderQueue()
      if (queue) {
        const jobData = { orderId: order.id, vendorId: order.vendorId, eventId: order.eventId }
        const isDelivery = order.fulfillmentType === FulfillmentType.HOME_DELIVERY
        const jobName = isDelivery ? JOB_UNDELIVERABLE : JOB_UNCOLLECTED

        const result = await enqueueJobSafely({
          queue,
          name:    jobName,
          data:    jobData,
          jobId:   `${jobName}-${order.id}`,
          delay:   CURBSIDE_WAIT_TIMEOUT_MS,
          priority: 'normal',
        })

        if (result === 'dropped') {
          logger.error('[CRITICAL] Timeout job dropped', { jobName, orderId: order.id })
        }
      }
    }

    // 6b. COMPLETED → delayed payout enqueue + analytics cache bust. (DELIVERED is
    // handled by the aggregator via the runner path above — incl. its earnings
    // accrual, which moved into reconcileMasterStatus in Phase 4.)
    if (newStatus === OrderStatus.COMPLETED) {
      try {
        await handleCompleted(order)
      } catch (e) {
        logger.warn('[Status] handleCompleted side-effect failed: ' + String(e))
      }
      revalidateTag(`analytics-${order.vendorId}`, 'default')
      revalidateTag(`stats-${order.vendorId}`, 'default')
      revalidateTag(`revenue-${order.vendorId}`, 'default')
    }

    // 6c. CANCELLED -> Stripe refund + Cancellation record
    if (newStatus === OrderStatus.CANCELLED) {
      try {
        await handleCancelled(order, reason)
      } catch (e) {
        logger.warn('[Status] handleCancelled side-effect failed: ' + String(e))
      }
    }

    // ── 7. Firebase RTDB writes (best-effort, kept alive by after()) ──────
    const patch = { status: newStatus, updatedAt: Date.now() }
    after(() => {
      fireAndForgetFirebaseUpdate(
        `fairs/${order.eventId}/orders/${order.vendorId}/${order.id}`,
        patch,
        { orderId: order.id }
      )
      fireAndForgetFirebaseUpdate(
        `fairs/${order.eventId}/customerOrders/${order.customerId}/${order.id}`,
        patch,
        { orderId: order.id }
      )
    })

    return success({ orderId: order.id, status: newStatus })
  } catch (err) {
    return handleApiError(err)
  }
}

// ─── COMPLETED side-effect ────────────────────────────────────────────────────

async function handleCompleted(
  order: { id: string; eventId: string },
) {
  // Per-vendor payout: the worker reads the settled Stripe fee and splits it
  // proportionally across ALL vendors on the cart, sending one transfer each.
  // Connection/verification is checked per-vendor inside the worker (unconnected
  // vendors are held, not skipped silently). Idempotent — safe if this fires
  // more than once (e.g. multi-vendor completion).
  // DELAYED behind the refund window (decision C2) — same as the vendor-status
  // completion path. Without the delay this route would pay out immediately and
  // defeat the window. The reconciler (Pattern C) backstops it post-window.
  const enqueued = await enqueueOrderPayout({
    orderId: order.id,
    eventId: order.eventId,
    delayMs: REFUND_WINDOW_MS,
  })

  if (enqueued) logger.info('[Status] delayed payout job enqueued', { orderId: order.id })
}

// ─── CANCELLED side-effect ────────────────────────────────────────────────────

async function handleCancelled(
  order: { id: string; vendorId: string; eventId: string; stripePaymentIntentId: string | null; stripeChargeId: string | null },
  reason?: string
) {
  // Write the cancellation audit record (money-truth lives in Refund rows).
  await db.cancellation.upsert({
    where: { orderId: order.id },
    create: { orderId: order.id, vendorId: order.vendorId, reason: reason ?? null },
    update: { reason: reason ?? null },
  })

  if (!order.stripePaymentIntentId) return // no payment taken — nothing to refund

  // Per-vendor refund through the SINGLE engine (fee kept, reconciled, idempotent),
  // NOT a whole-order/fee-inclusive Stripe refund. A whole-order cancel = refund
  // every vendor's slice; loop them. Idempotent — already-refunded vendors no-op.
  const items = await db.orderItem.findMany({ where: { orderId: order.id }, select: { vendorId: true } })
  const vendorIds = [...new Set(items.map(i => i.vendorId))]
  for (const vendorId of vendorIds) {
    try {
      await refundVendorPortion({ orderId: order.id, vendorId, reason: reason ?? 'vendor_cancelled', actor: 'system' })
    } catch (err) {
      logger.error('[Status] per-vendor cancel refund failed — reconciler will retry', { orderId: order.id, vendorId, error: String(err) })
    }
  }

  logger.info('[Status] per-vendor refunds issued for cancelled order', { orderId: order.id, vendors: vendorIds.length })
}
