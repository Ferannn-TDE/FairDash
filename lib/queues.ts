/**
 * BullMQ queue definitions — producer side only.
 *
 * API routes call getOrderQueue().add(...) to enqueue jobs.
 * The consumer (worker) runs in a separate process: `npm run worker`.
 *
 * Graceful no-Redis fallback: if REDIS_URL is unset, all queue operations
 * are skipped and a warning is logged. The app stays functional; delayed
 * jobs simply won't fire until Redis is wired up.
 *
 * All job payloads include eventId so the worker can namespace Firebase
 * writes under fairs/{eventId}/... without an extra DB round-trip.
 */

import { Queue, ConnectionOptions } from 'bullmq'
import { logger } from './logger'

// ─── Connection ───────────────────────────────────────────────────────────────

function buildConnectionOptions(url: string): ConnectionOptions {
  const parsed = new URL(url)
  const opts: ConnectionOptions = {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
    lazyConnect: true,
  }
  if (parsed.password) (opts as Record<string, unknown>).password = decodeURIComponent(parsed.password)
  if (parsed.username && parsed.username !== 'default') {
    (opts as Record<string, unknown>).username = decodeURIComponent(parsed.username)
  }
  if (parsed.protocol === 'rediss:') (opts as Record<string, unknown>).tls = {}
  return opts
}

function getConnectionOptions(): ConnectionOptions | null {
  const url = process.env.REDIS_URL
  if (!url) {
    logger.warn('[BullMQ] REDIS_URL not set — delayed jobs disabled')
    return null
  }
  try {
    return buildConnectionOptions(url)
  } catch (err) {
    logger.error('[BullMQ] Failed to parse REDIS_URL', { error: String(err) })
    return null
  }
}

// ─── Queue name ───────────────────────────────────────────────────────────────

export const ORDER_QUEUE_NAME = 'fairsynq-orders'

// TEST_REDIS_PREFIX (e.g. "test:") isolates test jobs in a separate Redis
// namespace so they never land in the production queue. BullMQ prefix option
// strips the trailing colon — we normalise it here.
export function getQueuePrefix(): string {
  const raw = process.env.TEST_REDIS_PREFIX ?? ''
  return raw.replace(/:$/, '') || 'bull'
}

// ─── Job name constants ───────────────────────────────────────────────────────
// Single source of truth. Worker imports these same constants.

/** Order timeout: vendor did not accept within 2 minutes → auto-cancel + full refund */
export const JOB_UNACCEPTED = 'mark-unaccepted'

/** Order timeout: booth/curbside not collected 10 min after READY → UNCOLLECTED, no refund */
export const JOB_UNCOLLECTED = 'mark-uncollected'

/** Order timeout: home delivery not completed 10 min after READY → UNDELIVERABLE, no refund */
export const JOB_UNDELIVERABLE = 'mark-undeliverable'

/** Vendor heartbeat stale 5 min → auto-hide from customer menu (isOffline = true) */
export const JOB_HIDE_VENDOR = 'auto-hide-vendor'

/** IncidentReport filed → if operator does not respond in 5 min → auto-refund */
export const JOB_INCIDENT_REFUND = 'incident-auto-refund'

/** Dispute OPEN → if admin does not resolve in 24 hr → status ESCALATED */
export const JOB_ESCALATE_DISPUTE = 'escalate-dispute'

/** Event closed → generate post-event report and email operator within 48 hr */
export const JOB_POST_EVENT_REPORT = 'generate-post-event-report'

/** Emergency cancel → bulk Stripe refund all open orders for an event */
export const JOB_BULK_REFUND = 'bulk-refund-event'

/** Order completed → transfer vendor payout via Stripe Connect */
export const JOB_VENDOR_PAYOUT = 'process-vendor-payout'

/** Order delivered (behind refund window) → transfer runner payout (Part B B2) */
export const JOB_RUNNER_PAYOUT = 'process-runner-payout'

/** Event closed → batched per-event organizer payout (Part B B3) */
export const JOB_ORGANIZER_PAYOUT = 'process-organizer-payout'

/** Order cancelled → issue Stripe refund to customer */
export const JOB_REFUND = 'process-refund'

/** Recurring backstop sweep → reconciles Stripe (money) ↔ DB (state), self-heals leaks */
export const JOB_RECONCILE = 'reconcile-sweep'

// ─── Job payload ──────────────────────────────────────────────────────────────
// Unified interface — all jobs share the same queue so all payloads must be
// compatible with the Worker<JobData> generic. Fields are optional when not
// relevant to a specific job type.

export interface JobData {
  // Present on every job — enables namespaced Firebase writes without a DB lookup
  eventId: string

  // Order/vendor jobs
  orderId?: string
  vendorId?: string

  // Dispute job
  disputeId?: string

  // Incident job
  incidentId?: string

  // process-vendor-payout
  vendorStripeAccountId?: string
  stripePaymentIntentId?: string
  stripeChargeId?: string
  transferAmountCents?: number
  payoutIdempotencyKey?: string

  // process-refund
  refundReason?: string
  refundIdempotencyKey?: string
  refundAmountCents?: number      // partial refund — omit for full refund
  cancellationVendorId?: string
}

// ─── Queue singleton ──────────────────────────────────────────────────────────

const globalForQueue = globalThis as unknown as {
  orderQueue: Queue | undefined
}

export function __setOrderQueueForTest(q: Queue | null): void {
  if (q === null) delete globalForQueue.orderQueue
  else globalForQueue.orderQueue = q
}

export function getOrderQueue(): Queue | null {
  if (globalForQueue.orderQueue) return globalForQueue.orderQueue

  const connection = getConnectionOptions()
  if (!connection) return null

  const queue = new Queue(ORDER_QUEUE_NAME, {
    connection,
    prefix: getQueuePrefix(),
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  })

  if (process.env.NODE_ENV !== 'production') {
    globalForQueue.orderQueue = queue
  }

  return queue
}
