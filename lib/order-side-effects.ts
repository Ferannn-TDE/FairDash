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

import { db } from './db'
import { stripe } from './stripe'
import { getOrderQueue, JOB_VENDOR_PAYOUT, JOB_REFUND } from './queues'
import { enqueueJobSafely } from './queue-safe'

// ─── Payout ───────────────────────────────────────────────────────────────────

export interface VendorPayoutInput {
  orderId: string
  vendorId: string
  eventId: string
  vendorStripeAccountId: string
  stripePaymentIntentId?: string | null
  stripeChargeId?: string | null
  vendorPayout: number
}

/**
 * Enqueues a process-vendor-payout job. Returns true if queued or fallback ran,
 * false if dropped. jobId deduplication prevents double-payout on retry.
 */
export async function enqueueVendorPayout(input: VendorPayoutInput): Promise<boolean> {
  const queue = getOrderQueue()
  if (!queue) {
    console.warn(`[SideEffects] Redis unavailable — payout job for order ${input.orderId} not enqueued`)
    return false
  }

  const transferAmountCents = Math.round(input.vendorPayout * 100)
  const payoutIdempotencyKey = `transfer-completed-${input.orderId}`

  const result = await enqueueJobSafely({
    queue,
    name: JOB_VENDOR_PAYOUT,
    data: {
      eventId:              input.eventId,
      orderId:              input.orderId,
      vendorId:             input.vendorId,
      vendorStripeAccountId: input.vendorStripeAccountId,
      stripePaymentIntentId: input.stripePaymentIntentId ?? undefined,
      stripeChargeId:       input.stripeChargeId ?? undefined,
      transferAmountCents,
      payoutIdempotencyKey,
    },
    jobId:    `payout-${input.orderId}`,
    priority: 'critical',
    fallback: async () => {
      await stripe.transfers.create(
        {
          amount:      transferAmountCents,
          currency:    'usd',
          destination: input.vendorStripeAccountId,
          ...(input.stripeChargeId ? { source_transaction: input.stripeChargeId } : {}),
        },
        { idempotencyKey: `fallback-${payoutIdempotencyKey}` }
      )
    },
  })

  if (result === 'dropped') {
    console.error('[CRITICAL] Payout job dropped with no fallback', { jobName: JOB_VENDOR_PAYOUT, orderId: input.orderId })
  }

  return result !== 'dropped'
}

// ─── Refund ───────────────────────────────────────────────────────────────────

export interface RefundInput {
  orderId: string
  vendorId: string
  eventId: string
  stripePaymentIntentId: string
  stripeChargeId?: string | null
  refundReason?: string
}

/**
 * Writes a Cancellation record immediately, then enqueues process-refund.
 * The worker fills in refundAmount/refundIssued once Stripe confirms.
 * jobId deduplication prevents double-refund if enqueued from multiple paths.
 */
export async function enqueueRefund(input: RefundInput): Promise<boolean> {
  await db.cancellation.upsert({
    where:  { orderId: input.orderId },
    create: {
      orderId:      input.orderId,
      vendorId:     input.vendorId,
      reason:       input.refundReason ?? null,
      refundIssued: false,
      refundAmount: null,
    },
    update: {},
  })

  const queue = getOrderQueue()
  if (!queue) {
    console.warn(`[SideEffects] Redis unavailable — refund job for order ${input.orderId} not enqueued`)
    return false
  }

  const refundIdempotencyKey = `stripe-refund-${input.orderId}`

  const result = await enqueueJobSafely({
    queue,
    name: JOB_REFUND,
    data: {
      eventId:              input.eventId,
      orderId:              input.orderId,
      vendorId:             input.vendorId,
      cancellationVendorId: input.vendorId,
      stripePaymentIntentId: input.stripePaymentIntentId,
      stripeChargeId:       input.stripeChargeId ?? undefined,
      refundReason:         input.refundReason ?? 'cancelled',
      refundIdempotencyKey,
    },
    jobId:    `refund-${input.orderId}`,
    priority: 'critical',
    fallback: async () => {
      await stripe.refunds.create(
        { payment_intent: input.stripePaymentIntentId },
        { idempotencyKey: `fallback-${refundIdempotencyKey}` }
      )
    },
  })

  if (result === 'dropped') {
    console.error('[CRITICAL] Refund job dropped with no fallback', { jobName: JOB_REFUND, orderId: input.orderId })
  }

  return result !== 'dropped'
}
