/**
 * THE ONE WRITER OF A DURABLE PAYOUT-FAILURE MARKER — reachable from BOTH paths.
 *
 * ── WHY THIS MOVED OUT OF THE WORKER ────────────────────────────────────────────────────────
 * This logic lived in `workers/order-worker.ts`, was not exported, and took a BullMQ `Job`. So
 * only the worker path could write a marker. The reconciler's Pattern P/Q loops
 * (`reconcileRunnerPayouts`, `reconcileOrganizerPayouts`) catch their failures into an alert
 * STRING and write nothing durable at all.
 *
 * That gap is not hypothetical. Two terminal Stripe errors failed every 60 seconds for EIGHT
 * DAYS on the reconciler path — a transfer_group conflict, then a burned idempotency key created
 * by fixing it — and the only trace either left was a line in a Railway log scroll. They were
 * found because a human happened to be reading it.
 *
 * The markers themselves already existed and Pattern U already reads them
 * (`reconciler.ts:1374`, `:1383`). They were simply unreachable from the path that was failing.
 * That is why this file exists and why NO new action strings were introduced: inventing
 * RUNNER_PAYOUT_FAILED / ORGANIZER_PAYOUT_FAILED would have created a second vocabulary for a
 * state that already has one, and Pattern U would not have read it.
 *
 * ── CAUSE, NOT JUST STATE ───────────────────────────────────────────────────────────────────
 * The audit `reason` alone describes the MECHANISM of failure ("exhausted after 3 attempts",
 * "halted unrecoverably") and says nothing about the CAUSE. Both of the eight-day failures were
 * "halted unrecoverably"; their causes were unrelated. A screen showing that string twice tells
 * the reader nothing and sends them back to the log — the exact problem this closes.
 *
 * So the classified verdict, the raw Stripe message, and Stripe's `type`/`code` ride along in
 * the audit's `metadata` (a Json column — no schema change). `type`/`code` are what a human
 * actually searches on.
 *
 * ⚠️ `stripeMessage` is STRIPE-AUTHORED TEXT bound for an admin screen. Render it as TEXT,
 * never as markup.
 */

import { db } from './db'
import { writeMoneyAudit, type MoneyActor } from './admin-money'
import { classifyStripeError } from './stripe-error-class'
import { logger } from './logger'

export type PayoutLeg = 'vendor' | 'runner' | 'organizer'

export interface PayoutFailureCause {
  /** classifyStripeError's verdict — 'terminal' is what justifies marking and halting retries. */
  verdict: string
  /** Stripe's own message. UNTRUSTED TEXT — render escaped. */
  stripeMessage: string
  /** e.g. 'StripeInvalidRequestError' — what a human greps for. */
  stripeType?: string
  /** e.g. 'resource_missing'. */
  stripeCode?: string
}

/** Everything the marker needs, with NO BullMQ Job — that coupling is what made it unreachable. */
export interface PayoutFailureInput {
  leg: PayoutLeg
  /** Required for vendor + runner (the per-order legs). */
  orderId?: string | null
  /** Required for organizer (batched per event); also the audit scope for the others. */
  eventId?: string | null
  /** WHO is recording this — `worker:<job>:<id>` or `reconciler:<pattern>`. Never a lie. */
  actor: MoneyActor
  /** WHY this failure is final: retries exhausted, or an unrecoverable halt. */
  finality: string
  /** The classified cause. Absent for callers that have no error object (legacy worker path). */
  cause?: PayoutFailureCause
}

/** Build a cause from a raw thrown error — so callers don't each re-derive the shape. */
export function describeFailureCause(err: unknown): PayoutFailureCause {
  const v = classifyStripeError(err)
  return {
    verdict: v.class,
    stripeMessage: err instanceof Error ? err.message : String(err),
    stripeType: v.type,
    stripeCode: v.code,
  }
}

/**
 * Write the durable marker + the honest-actor PAYOUT_FAILED audit.
 *
 * BEST-EFFORT BY CONSTRUCTION: bookkeeping must never throw out of a failure path or mask the
 * original error. A caller is already handling a failure when it gets here.
 *
 * Returns whether a marker was written, so a caller can decide whether to keep retrying —
 * `false` means the row was already paid or already failed, not that anything went wrong.
 */
export async function recordPayoutFailure(input: PayoutFailureInput): Promise<boolean> {
  const { leg, orderId, eventId, actor, finality, cause } = input
  const metadata = cause
    ? { verdict: cause.verdict, stripeMessage: cause.stripeMessage, stripeType: cause.stripeType ?? null, stripeCode: cause.stripeCode ?? null }
    : undefined

  try {
    if (leg === 'runner' && orderId) {
      const earning = await db.runnerEarning.findUnique({ where: { orderId } })
      // A paid row is never re-marked — that would un-pay it in every reader.
      if (!earning || earning.status === 'paid') return false
      if (earning.status !== 'failed') {
        await db.runnerEarning.update({ where: { orderId }, data: { status: 'failed' } })
      }
      await writeMoneyAudit(actor, earning.eventId, {
        action: 'PAYOUT_FAILED', payeeType: 'runner', payeeId: earning.runnerId,
        orderId: earning.orderId, earningId: earning.id, amountCents: earning.amountCents,
        reason: `runner payout ${finality}`,
        metadata,
      })
      logger.money('[RunnerPayout] FAILED — marked + audited, manual intervention required', {
        orderId, verdict: cause?.verdict, stripeCode: cause?.stripeCode,
      })
      return true
    }

    if (leg === 'organizer' && eventId) {
      // Mark the batch that was mid-flight (latest non-paid for the event), if one formed.
      const batch = await db.organizerPayout.findFirst({
        where: { eventId, status: { not: 'paid' } },
        orderBy: { createdAt: 'desc' },
      })
      if (batch && batch.status !== 'failed') {
        await db.organizerPayout.update({ where: { id: batch.id }, data: { status: 'failed' } })
      }
      await writeMoneyAudit(actor, eventId, {
        action: 'PAYOUT_FAILED', payeeType: 'organizer', payeeId: batch?.organizerId ?? eventId,
        orderId: null, earningId: batch?.id ?? null, amountCents: batch?.totalCents ?? null,
        reason: `organizer payout ${finality}`,
        metadata,
      })
      logger.money('[OrganizerPayout] FAILED — marked + audited, manual intervention required', {
        eventId, batchId: batch?.id, verdict: cause?.verdict, stripeCode: cause?.stripeCode,
      })
      return !!batch
    }

    if (leg === 'vendor' && orderId) {
      // The vendor marker (order.payoutStatus='FAILED') is set by the CALLER — this adds the
      // honest-actor audit + the failed-since timestamp the enum column cannot carry.
      const order = await db.order.findUnique({ where: { id: orderId }, select: { eventId: true, vendorId: true } })
      if (!order) return false
      const unpaidCents = (await db.vendorEarning.aggregate({
        _sum: { subtotalCents: true }, where: { orderId, status: { notIn: ['paid', 'cancelled'] } },
      }))._sum.subtotalCents ?? null
      await writeMoneyAudit(actor, order.eventId, {
        action: 'PAYOUT_FAILED', payeeType: 'vendor', payeeId: order.vendorId ?? orderId,
        orderId, earningId: null, amountCents: unpaidCents,
        reason: `vendor payout ${finality}`,
        metadata,
      })
      return true
    }
  } catch (err) {
    logger.error('[PayoutFailure] marker bookkeeping failed (the original failure still stands)', {
      leg, orderId: orderId ?? undefined, eventId: eventId ?? undefined, error: String(err),
    })
  }
  return false
}
