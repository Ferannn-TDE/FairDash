import { NextRequest, NextResponse, after } from 'next/server'
import { OrderStatus, FulfillmentType, RunnerStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { placePaidOrder } from '@/lib/place-order'
import { reconcileMasterStatus } from '@/lib/reconcile-order-status'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/ratelimit'
// ⚠️ HOME_DELIVERY_GPS_RADIUS_M + haversineMetres below are ORPHANED — PRE-EXISTING, not
// introduced here. The 100m delivery-GPS check this route's header claims (and schema.prisma
// documents on runnerConfirmedLat/Lng) is implemented NOWHERE in the repo. Kept deliberately
// as the marker of a missing control; deleting them would erase the only trace. See CURRENT_STATE §7.
import { HOME_DELIVERY_GPS_RADIUS_M } from '@/lib/constants'
import { logger } from '@/lib/logger'
import { resolveOrder } from '@/lib/resolve-order'

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
//   RUNNER_COLLECTED → DELIVERED         (runner delivers; requires proofPath + GPS for HOME_DELIVERY)
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
        return NextResponse.json({ success: false, error: { message: 'Too many requests — slow down.', code: 'RATE_LIMITED' } }, { status: 429, headers: rlHeaders })
      }
      return NextResponse.json({ ok: true }, { status: 200 })
    }

    const clerkId = await requireAuth()

    const { allowed, headers: rlHeaders } = await enforceRateLimit(`vendor-status:${clerkId}`, 'vendorStatus')
    if (!allowed) {
      return NextResponse.json({ success: false, error: { message: 'Too many requests — slow down.', code: 'RATE_LIMITED' } }, { status: 429, headers: rlHeaders })
    }

    // ── 1. Load order ──────────────────────────────────────────────────────
    const order = await resolveOrder((await params).id, {
      include: { vendor: true },
    })

    if (!order) return apiError('Order not found', 404, 'ORDER_NOT_FOUND')

    // ── 2. Identify caller and parse body ─────────────────────────────────
    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    const body = await req.json()
    const { status: newStatus, reason, proofPath, lat, lng } = body as {
      status: OrderStatus
      reason?: string
      proofPath?: string  // runner proof-of-delivery photo — a Supabase object PATH, not a URL
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
      // Voided orders are dead to every operational surface (the void floor: money/audit
      // include, operations exclude). Named refusal — a ghost claim/deliver must fail
      // loudly, not fall through to a generic "no longer claimable".
      if (order.voidedAt) {
        return apiError('This order was voided by an admin', 409, 'ORDER_VOIDED')
      }
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

      // DELIVERED requires the proof-of-delivery photo path
      if (newStatus === OrderStatus.DELIVERED && !proofPath) {
        throw new ApiError('proofPath is required to mark an order as delivered', 400, 'VALIDATION_ERROR')
      }

      // ── RACE-SAFE CLAIM ──────────────────────────────────────────────────
      // Two runners may tap "Claim" on the same order at the same instant. The
      // claim MUST be a single atomic conditional update — never a read-then-write
      // (the stale `!order.runnerId` check + separate update had a race window
      // where both runners passed the check and both claimed). Same atomic-flip
      // pattern as placePaidOrder. `runnerId IS NULL` is the contested guard:
      // exactly one updateMany returns count 1 (the winner); the loser gets 0.
      if (newStatus === OrderStatus.RUNNER_COLLECTED && order.runnerId !== runner.id) {
        const claimed = await db.$transaction(async tx => {
          const claim = await tx.order.updateMany({
            // Atomic AND status-aware: only an unclaimed, still-READY row matches. The
            // status guard means a claim landing after the UNDELIVERABLE timeout fired
            // can't even set runnerId on the terminal order (no stray assignment) —
            // the resurrection is prevented at the claim, with canAdvance as backstop.
            where: { id: order.id, runnerId: null, status: OrderStatus.READY, voidedAt: null },
            data: {
              runnerId: runner.id,
              dispatchedAt: new Date(),
              // Claim-time VEHICLE SNAPSHOT — the car taking THIS order. The profile is
              // mutable; the delivery is forever. Cleared on release/return-confirm.
              runnerVehicleMake: runner.vehicleMake,
              runnerVehicleColor: runner.vehicleColor,
              runnerVehiclePlate: runner.vehiclePlate,
            },
          })
          if (claim.count === 0) return false
          // Append-only record of who + what car, in the SAME transaction — so the display
          // columns (cleared on release) and the history can never drift, and a returned
          // order never loses runner A's vehicle (it lives here, not just in the columns).
          await tx.deliveryCustodyEvent.create({
            data: {
              orderId: order.id,
              eventType: 'claimed',
              actorId: clerkId,
              actorRole: 'runner',
              runnerId: runner.id,
              metadata: {
                vehicleMake: runner.vehicleMake ?? null,
                vehicleColor: runner.vehicleColor ?? null,
                vehiclePlate: runner.vehiclePlate ?? null,
              },
            },
          })
          return true
        })
        if (!claimed) {
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
      // DELIVERED from deliveryProofPath — behind canAdvance. The aggregator owns the
      // status write (gaining the monotonic guard) AND the DELIVERED side-effects
      // (RunnerEarning + OrganizerEarning accrual + delayed payout). Returns here so
      // runner transitions never reach the legacy monolithic update below.
      if (newStatus === OrderStatus.DELIVERED) {
        await db.order.update({
          where: { id: order.id },
          data: {
            deliveryProofPath: proofPath ?? null,
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
      // ── VENDOR BRANCH REMOVED ────────────────────────────────────────────────
      // This branch wrote Order.status directly, guarded by a VENDOR_TRANSITIONS table
      // read in a SEPARATE query — a read-then-write race on master status, and a THIRD
      // copy of a derivation MASTER_RANK/canAdvance already owns.
      //
      // Nothing called it. The vendor dashboard advances the PER-VENDOR row via
      // PATCH /api/orders/:id/vendor-status (app/vendor/[fairSlug]/dashboard/page.tsx:79);
      // master status is then DERIVED from those rows by reconcileMasterStatus. A vendor
      // was never supposed to write master status directly — that inverts the derivation.
      //
      // A dead path carrying a known race is worse than no path: it stays reachable by any
      // authenticated vendor member and silently bypasses the aggregator's monotonic guard.
      // Removed rather than made status-conditional, because "correct but nothing should
      // ever call it" is not a state worth maintaining.
      return apiError(
        'Vendors advance their own portion via /api/orders/:id/vendor-status, not the master order status',
        409,
        'USE_VENDOR_STATUS_ROUTE',
      )
    }


    // NOTE: every branch above RETURNS. Customer confirm returns at the placePaidOrder
    // call, runner transitions return through reconcileMasterStatus, and the vendor branch
    // now returns USE_VENDOR_STATUS_ROUTE. The old monolithic tail here — timestamp patch,
    // unconditional db.order.update, and the READY/COMPLETED/CANCELLED side-effects — was
    // reachable ONLY from the deleted vendor branch, so it is gone with it. Those
    // side-effects still run, from their real owners: the READY timeout arm and the payout
    // enqueue live in reconcileMasterStatus (lib/reconcile-order-status.ts:441, :502), and
    // the per-vendor refund on decline lives in the vendor-status route.
  } catch (err) {
    return handleApiError(err)
  }
}


