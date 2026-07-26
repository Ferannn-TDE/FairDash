/**
 * IS THIS PAYOUT FAILURE FINAL? — the one definition, so the worker's failed-handler gate can
 * be proven without booting a worker.
 *
 * WHY THIS IS NOT INLINE IN THE HANDLER: `worker.on('failed', …)` is a closure inside
 * `workers/order-worker.ts`, a module that constructs PrismaClient, Stripe, Firebase and a
 * Redis-backed Worker at import time. A test that imported it to check one boolean would need
 * all four. The decision is pure, so it lives here and both the worker and its guard import it.
 *
 * ── THE BUG THIS EXISTS TO PREVENT (confirmed against BullMQ 5.76.8) ────────────────────────
 * The gate used to read `job.attemptsMade >= (job.opts.attempts ?? 3)`. BullMQ fails an
 * `UnrecoverableError` job WITHOUT exhausting attempts:
 *
 *   job.js:483  shouldRetryJob() → returns [false, 0] on UnrecoverableError, never touching
 *               attemptsMade
 *   job.js:549  attemptsMade += 1, once, on the non-retry branch
 *
 * So a `PayoutReconciliationError` on the first try reached the handler with attemptsMade = 1
 * against opts.attempts = 3. `1 >= 3` is false, so the durable marker AND the PAYOUT_FAILED
 * audit were both skipped.
 *
 * The result was an INVERTED marker path: a transient network blip that burned all three
 * retries got a durable marker, while a ledger drift — a money-identity break, the most
 * serious failure this system can raise — got a log line and nothing persisted. Pattern U
 * reads the PAYOUT_FAILED audit for its failed-since timestamp, so the stuck-money reader was
 * blind to exactly the failures a human would most want surfaced.
 *
 * It had never fired in production only because the runner and organizer payout legs had never
 * executed. The worker is live now, so the path is reachable for the first time.
 */

/** The shape this needs from a BullMQ Job — kept structural so the guard needs no Job instance. */
export interface FailedJobFacts {
  attemptsMade: number
  maxAttempts: number | undefined
}

export interface PayoutFinality {
  /** True ⇒ no further attempt will run, so the durable marker + audit MUST be written now. */
  final: boolean
  /** True ⇒ BullMQ halted this without exhausting retries (the case the old gate missed). */
  unrecoverable: boolean
  /** Honest human text for the money-audit `reason`. Never claims exhaustion that didn't happen. */
  finality: string
}

/**
 * `err.name` is checked ALONGSIDE `instanceof` on purpose. It mirrors BullMQ's own test
 * (job.js:486 — `err instanceof UnrecoverableError || err.name == 'UnrecoverableError'`) and it
 * survives a duplicated bullmq module instance, where `instanceof` across two copies of the
 * class silently returns false and would restore the exact bug this file documents.
 */
export function isUnrecoverable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: unknown; constructor?: { name?: unknown } }
  return e.name === 'UnrecoverableError' || e.constructor?.name === 'UnrecoverableError'
}

/**
 * Gate on FINALITY, never on the attempt count alone. "Exhausted" is one way a payout failure
 * becomes final; an unrecoverable halt is another, and it is the more serious one.
 */
export function payoutFailureFinality(err: unknown, job: FailedJobFacts): PayoutFinality {
  const unrecoverable = isUnrecoverable(err)
  const exhausted = job.attemptsMade >= (job.maxAttempts ?? 3)
  return {
    final: exhausted || unrecoverable,
    unrecoverable,
    finality: unrecoverable
      ? `halted unrecoverably after ${job.attemptsMade} attempt(s) — no further attempts will run`
      : `exhausted after ${job.attemptsMade} attempt(s)`,
  }
}

/**
 * THE OLD GATE, preserved EXECUTABLY so the guard can prove the bug existed rather than
 * asserting it in prose. A test that only passes after a fix does not demonstrate a defect.
 * Not called by production code. Do not "clean this up" — deleting it removes the only
 * mechanical evidence that the marker path was ever inverted.
 */
export function legacyExhaustedOnlyGate(job: FailedJobFacts): boolean {
  return job.attemptsMade >= (job.maxAttempts ?? 3)
}
