import { NextRequest, NextResponse, after } from 'next/server'
import { revalidateTag } from 'next/cache'
import { OrderStatus, FulfillmentType } from '@prisma/client'
import { db } from '@/lib/db'
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
import { enqueueVendorPayout, enqueueRefund } from '@/lib/order-side-effects'
import { enqueueJobSafely } from '@/lib/queue-safe'
import { CURBSIDE_WAIT_TIMEOUT_MS, ORDER_CANCELLATION_FEE_USD, HOME_DELIVERY_GPS_RADIUS_M } from '@/lib/constants'

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
      // Idempotent — if webhook already set PLACED, this is a no-op
      if (order.status !== OrderStatus.PENDING_PAYMENT) {
        return success({ orderId: order.id, status: order.status })
      }
      await db.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PLACED },
      })
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

      // Assign runner if not already assigned (runner taking an unassigned order)
      if (newStatus === OrderStatus.RUNNER_COLLECTED && !order.runnerId) {
        await db.order.update({
          where: { id: order.id },
          data: { runnerId: runner.id, dispatchedAt: new Date() },
        })
      }
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

    const runnerDataPatch: Record<string, unknown> = {}
    if (newStatus === OrderStatus.DELIVERED) {
      runnerDataPatch.curbsidePhotoUrl = photoUrl ?? null
      if (lat != null) runnerDataPatch.runnerConfirmedLat = lat
      if (lng != null) runnerDataPatch.runnerConfirmedLng = lng
    }

    // ── 5. Apply DB update (status + timestamps + runner data) ────────────
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
        ...runnerDataPatch,
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
          console.error('[CRITICAL] Job dropped with no fallback', { jobName, orderId: order.id })
        }
      }
    }

    // 6b. COMPLETED or DELIVERED → Stripe transfer + Payout record + analytics cache bust
    if (newStatus === OrderStatus.COMPLETED || newStatus === OrderStatus.DELIVERED) {
      try {
        await handleCompleted(order)
      } catch (e) {
        console.warn('[Status] handleCompleted side-effect failed:', e)
      }
      revalidateTag(`analytics-${order.vendorId}`, 'default')
      revalidateTag(`stats-${order.vendorId}`,     'default')
      revalidateTag(`revenue-${order.vendorId}`,   'default')
    }

    // 6c. CANCELLED -> Stripe refund + Cancellation record
    if (newStatus === OrderStatus.CANCELLED) {
      try {
        await handleCancelled(order, reason)
      } catch (e) {
        console.warn('[Status] handleCancelled side-effect failed:', e)
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
  order: { id: string; vendorId: string; eventId: string; stripePaymentIntentId: string | null; stripeChargeId: string | null; vendorPayout: number; vendor: { stripeAccountId: string | null; stripeVerified: boolean } },
) {
  const vendor = order.vendor

  if (!vendor.stripeAccountId || !vendor.stripeVerified) {
    console.log(`[Status] Vendor ${order.vendorId} not on Stripe Connect — skipping payout enqueue (manual settlement)`)
    return
  }

  const enqueued = await enqueueVendorPayout({
    orderId: order.id,
    vendorId: order.vendorId,
    eventId: order.eventId,
    vendorStripeAccountId: vendor.stripeAccountId,
    stripePaymentIntentId: order.stripePaymentIntentId,
    stripeChargeId: order.stripeChargeId,
    vendorPayout: order.vendorPayout,
  })

  if (enqueued) console.log(`[Status] Vendor payout job enqueued for order ${order.id}`)
}

// ─── CANCELLED side-effect ────────────────────────────────────────────────────

async function handleCancelled(
  order: { id: string; vendorId: string; eventId: string; stripePaymentIntentId: string | null; stripeChargeId: string | null },
  reason?: string
) {
  if (!order.stripePaymentIntentId) {
    // No payment taken — just write the cancellation record
    await db.cancellation.upsert({
      where: { orderId: order.id },
      create: { orderId: order.id, vendorId: order.vendorId, reason: reason ?? null, refundIssued: false, refundAmount: null },
      update: {},
    })
    return
  }

  const enqueued = await enqueueRefund({
    orderId: order.id,
    vendorId: order.vendorId,
    eventId: order.eventId,
    stripePaymentIntentId: order.stripePaymentIntentId,
    stripeChargeId: order.stripeChargeId,
    refundReason: reason ?? 'vendor_cancelled',
  })

  if (enqueued) console.log(`[Status] Refund job enqueued for order ${order.id}`)
}
