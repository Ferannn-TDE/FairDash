/**
 * Async side-effect helpers for order status transitions.
 *
 * These functions enqueue BullMQ jobs rather than calling Stripe inline,
 * keeping HTTP response times under 50ms regardless of Stripe latency.
 * Imported by both the Next.js route handlers and scripts/test-c1.ts.
 */

import { db } from './db'
import { getOrderQueue, JOB_VENDOR_PAYOUT, JOB_REFUND } from './queues'

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
 * Enqueues a process-vendor-payout job. Returns true if enqueued, false if
 * Redis is unavailable. jobId deduplication prevents double-payout on retry.
 */
export async function enqueueVendorPayout(input: VendorPayoutInput): Promise<boolean> {
  const queue = getOrderQueue()
  if (!queue) {
    console.warn(`[SideEffects] Redis unavailable — payout job for order ${input.orderId} not enqueued`)
    return false
  }

  await queue.add(
    JOB_VENDOR_PAYOUT,
    {
      eventId: input.eventId,
      orderId: input.orderId,
      vendorId: input.vendorId,
      vendorStripeAccountId: input.vendorStripeAccountId,
      stripePaymentIntentId: input.stripePaymentIntentId ?? undefined,
      stripeChargeId: input.stripeChargeId ?? undefined,
      transferAmountCents: Math.round(input.vendorPayout * 100),
      payoutIdempotencyKey: `transfer-completed-${input.orderId}`,
    },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      jobId: `payout-${input.orderId}`,
    }
  )

  return true
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
    where: { orderId: input.orderId },
    create: {
      orderId: input.orderId,
      vendorId: input.vendorId,
      reason: input.refundReason ?? null,
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

  await queue.add(
    JOB_REFUND,
    {
      eventId: input.eventId,
      orderId: input.orderId,
      vendorId: input.vendorId,
      cancellationVendorId: input.vendorId,
      stripePaymentIntentId: input.stripePaymentIntentId,
      stripeChargeId: input.stripeChargeId ?? undefined,
      refundReason: input.refundReason ?? 'cancelled',
      refundIdempotencyKey: `stripe-refund-${input.orderId}`,
    },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      jobId: `refund-${input.orderId}`,
    }
  )

  return true
}
