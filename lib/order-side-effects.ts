/**
 * Async side-effect helpers for order status transitions.
 *
 * These functions enqueue BullMQ jobs rather than calling Stripe inline,
 * keeping HTTP response times under 50ms regardless of Stripe latency.
 * Imported by both the Next.js route handlers and scripts/test-c1.ts.
 *
 * Each function uses enqueueJobSafely() which retries 3x with exponential
 * backoff and runs an inline Stripe fallback if the queue is unreachable,
 * guaranteeing no payout or refund is silently dropped.
 */

import { getOrderQueue, JOB_VENDOR_PAYOUT, JOB_RUNNER_PAYOUT, JOB_ORGANIZER_PAYOUT } from './queues'
import { enqueueJobSafely } from './queue-safe'
import { processOrderPayout } from './process-payout'
import { logger } from './logger'
import { notifyPayoutDropped } from './notify'

// ─── Payout ───────────────────────────────────────────────────────────────────

export interface OrderPayoutInput {
  orderId: string
  eventId: string
  /**
   * Delay (ms) before the payout job becomes active — the refund window. The
   * order is COMPLETED now; the payout fires later. When set, we do NOT run the
   * inline Stripe fallback on a Redis outage (that would pay within the window,
   * defeating the refund-window design); the reconciler catches it post-window.
   */
  delayMs?: number
}

/**
 * Enqueues the per-vendor payout job for a fulfilled order. The worker (or the
 * inline fallback) runs processOrderPayout(), which reads the settled Stripe
 * fee, splits it proportionally across all vendors on the cart, and sends one
 * idempotent transfer per connected vendor. jobId dedupes the job; Stripe
 * idempotency keys (per order+vendor) dedupe the transfers.
 *
 * Returns true if queued or the fallback ran, false if dropped.
 */
export async function enqueueOrderPayout(input: OrderPayoutInput): Promise<boolean> {
  const delayMs = input.delayMs ?? 0
  const queue = getOrderQueue()
  if (!queue) {
    if (delayMs > 0) {
      // Delayed payout + no Redis: do NOT run inline (would pay inside the refund
      // window). The reconciler (Pattern C) pays it once the window has closed.
      logger.warn('[SideEffects] Redis unavailable — delayed payout deferred to reconciler', {
        orderId: input.orderId, delayMs,
      })
      return false
    }
    // Immediate payout with Redis down — run inline so a fulfilled order still pays.
    logger.warn('[SideEffects] Redis unavailable — running payout inline', { orderId: input.orderId })
    try {
      await processOrderPayout(input.orderId)
      return true
    } catch (err) {
      logger.error('[SideEffects] Inline payout failed', { orderId: input.orderId, error: String(err) })
      void notifyPayoutDropped(input.orderId, 'all')
      return false
    }
  }

  const result = await enqueueJobSafely({
    queue,
    name: JOB_VENDOR_PAYOUT,
    data: {
      eventId: input.eventId,
      orderId: input.orderId,
    },
    jobId:    `payout-${input.orderId}`,
    priority: 'critical',
    delay:    delayMs > 0 ? delayMs : undefined,
    // Inline fallback only for immediate payouts. A delayed payout must not run
    // inline on enqueue failure (it would bypass the window); reconciler backstops.
    fallback: delayMs > 0 ? undefined : async () => {
      await processOrderPayout(input.orderId)
    },
  })

  if (result === 'dropped') {
    void notifyPayoutDropped(input.orderId, 'all')
  }

  return result !== 'dropped'
}

// ─── Runner payout (Part B B2) ──────────────────────────────────────────────────

/**
 * Enqueues the runner payout for a delivered order. Mirrors enqueueOrderPayout's
 * discipline EXACTLY: a delayed payout (delayMs = refund window) must NOT run the
 * inline Stripe fallback on a Redis outage — that would pay inside the window and
 * defeat the refund-window design. The reconciler (reconcileRunnerPayouts / Pattern
 * P) pays it once the window has closed. jobId dedupes the job; the Stripe
 * idempotency key (runner_payout_${orderId}) dedupes the transfer.
 */
export async function enqueueRunnerPayout(input: OrderPayoutInput): Promise<boolean> {
  const delayMs = input.delayMs ?? 0
  const queue = getOrderQueue()
  if (!queue) {
    if (delayMs > 0) {
      logger.warn('[SideEffects] Redis unavailable — delayed runner payout deferred to reconciler', {
        orderId: input.orderId, delayMs,
      })
      return false
    }
    logger.warn('[SideEffects] Redis unavailable — running runner payout inline', { orderId: input.orderId })
    try {
      const { processRunnerPayout } = await import('./runner-payout')
      await processRunnerPayout(input.orderId)
      return true
    } catch (err) {
      logger.error('[SideEffects] Inline runner payout failed', { orderId: input.orderId, error: String(err) })
      return false
    }
  }

  const result = await enqueueJobSafely({
    queue,
    name: JOB_RUNNER_PAYOUT,
    data: { eventId: input.eventId, orderId: input.orderId },
    jobId:    `runner-payout-${input.orderId}`,
    priority: 'critical',
    delay:    delayMs > 0 ? delayMs : undefined,
    // Same rule as vendor: no inline fallback for a delayed payout (would bypass
    // the window); the reconciler backstops a dropped enqueue post-window.
    fallback: delayMs > 0 ? undefined : async () => {
      const { processRunnerPayout } = await import('./runner-payout')
      await processRunnerPayout(input.orderId)
    },
  })

  return result !== 'dropped'
}

// ─── Organizer payout (Part B B3) ────────────────────────────────────────────

/**
 * Enqueues the per-event organizer batch payout (triggered at event close). No
 * delay: at close the event is over, and the per-earning window gate in
 * planOrganizerPayout still excludes any not-yet-window-closed earning (those are
 * caught by the reconciler later). Immediate inline fallback is allowed (close is
 * a low-frequency admin action, not a hot path) — and the reconciler (Pattern Q)
 * backstops a dropped enqueue regardless. jobId dedupes; the batch-id idempotency
 * key dedupes the transfer.
 */
export async function enqueueOrganizerPayout(input: { eventId: string }): Promise<boolean> {
  const queue = getOrderQueue()
  if (!queue) {
    logger.warn('[SideEffects] Redis unavailable — running organizer payout inline', { eventId: input.eventId })
    try {
      const { processEventOrganizerPayout } = await import('./organizer-payout')
      await processEventOrganizerPayout(input.eventId)
      return true
    } catch (err) {
      logger.error('[SideEffects] Inline organizer payout failed', { eventId: input.eventId, error: String(err) })
      return false
    }
  }

  const result = await enqueueJobSafely({
    queue,
    name: JOB_ORGANIZER_PAYOUT,
    data: { eventId: input.eventId },
    jobId:    `organizer-payout-${input.eventId}`,
    priority: 'critical',
    fallback: async () => {
      const { processEventOrganizerPayout } = await import('./organizer-payout')
      await processEventOrganizerPayout(input.eventId)
    },
  })

  return result !== 'dropped'
}

// ─── Refund ───────────────────────────────────────────────────────────────────
// enqueueRefund was REMOVED in the chargeback/safety-net migration. All refunds
// now route through the single engine, lib/process-refund.ts refundVendorPortion
// (per-vendor, fee-protected, reconciled) — there is no whole-order/raw-Stripe
// refund path left. Chargebacks use reversals (lib/process-chargeback.ts), not
// refunds (the bank already returned the money to the cardholder).
