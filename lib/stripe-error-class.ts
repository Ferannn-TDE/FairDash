/**
 * IS THIS STRIPE FAILURE TERMINAL OR TRANSIENT? — the one definition.
 *
 * WHY THIS EXISTS BEFORE ANYTHING CONSUMES IT. Two open items need this same judgement:
 * taxonomy item 1 (fast-fail instead of burning 3 retries on a dead account) and item 4 (flip
 * `stripeVerified` when a destination no longer exists). Written inside each, that is one
 * decision derived in two places — this codebase's central bug class. It lands once, first, with
 * nothing wired to it; items 1 and 4 consume it afterwards.
 *
 * ── THE STATE THIS REPLACES ─────────────────────────────────────────────────────────────────
 * NOTHING in this repo classified a Stripe error. Every catch site on a money path
 * (`process-refund:268/293/340`, `process-chargeback:110/173`, `tip-refund:193`,
 * `runner-payout:338`, `organizer-payout:314`) does the same thing: `String(err)` into a log or
 * an alert string. `process-payout` does not catch around `transfers.create` at all. So the
 * retry decision was made ENTIRELY by BullMQ's blanket `attempts: 3` one level up, which cannot
 * see the error either — it just re-runs. "How does it decide whether to retry" had one honest
 * answer: it doesn't, it retries everything three times. That is taxonomy item 1, stated exactly.
 *
 * ── WHY DATA, NOT `instanceof` ──────────────────────────────────────────────────────────────
 * Keyed on the error's FIELDS, never on class identity. Two reasons, both concrete:
 *   1. Duplicated-module hazard — the same one that made `err.name` necessary alongside
 *      `instanceof` for BullMQ's UnrecoverableError. Two copies of `stripe` in a tree and
 *      `instanceof` silently returns false.
 *   2. `err.name` is NOT usable as a fallback here the way it was there: Stripe's error classes
 *      leave `name` as `'Error'` (verified against the installed SDK). The discriminator is
 *      `type`, which subclasses set from an explicit string literal (`Error.js:121`), NOT from
 *      `constructor.name` — that is only the null-fallback, so it survives minification.
 *
 * ── FIELDS, AND WHICH ARE ACTUALLY GUARANTEED (stripe 22.2.0) ───────────────────────────────
 *   type       string             REQUIRED — e.g. 'StripeInvalidRequestError'
 *   rawType    RawErrorType?      OPTIONAL — the API's own word, e.g. 'invalid_request_error'
 *   code       string?            OPTIONAL — e.g. 'resource_missing'
 *   statusCode number?            OPTIONAL
 *   param      string?            OPTIONAL — which field was at fault, e.g. 'destination'
 * Only `type` is non-optional, so every rule below tolerates the others being absent.
 */

export type StripeFailureClass = 'terminal' | 'transient' | 'unknown'

export interface StripeFailureVerdict {
  /**
   * `unknown` is a REAL answer, never a silent default. Misclassifying costs money in BOTH
   * directions: called terminal, a payment that would have succeeded stops being retried;
   * called transient, retries burn against a dead account. So anything not positively
   * recognised lands here and the CALLER decides — the classifier does not guess.
   */
  class: StripeFailureClass
  /** Why, in words — for the audit `reason` and the log line. Never empty. */
  reason: string
  type?: string
  code?: string
  statusCode?: number
  param?: string
}

/**
 * ── THE UNDECIDED SET — checked FIRST, and the ordering is load-bearing ──────────────────────
 * Each of these arrives wearing a costume that a broad rule below would misread. `balance_
 * insufficient` on a transfer is delivered as `invalid_request_error`, which the 4xx rule would
 * call TERMINAL — and that is the expensive direction: platform funds may simply not have
 * settled yet, so "never retry" would be wrong. Checking the undecided set before the broad
 * rules is what keeps these genuinely undecided instead of accidentally decided.
 *
 * These are for a human to promote. An entry I am unsure of is worse than one left open.
 */
const UNDECIDED_CODES: Record<string, string> = {
  balance_insufficient:
    'platform balance too low for the transfer — may be TRANSIENT (funds settle later) or TERMINAL ' +
    '(nothing incoming). Retrying 3× within seconds helps in neither case; the right answer is ' +
    'probably a longer-delay requeue, which is a scheduling decision, not a classification.',
  insufficient_funds:
    'same question as balance_insufficient, different code path. Note lib/clawback.ts already treats ' +
    'a negative balance as a BUSINESS case (NegativeBalanceEvent), not an error — so a rule here ' +
    'could contradict an existing deliberate behaviour.',
  lock_timeout:
    'Stripe object contention. Almost certainly transient, but on a MONEY object a lock timeout can ' +
    'mean a concurrent write partly landed — retrying could double-apply. Wants confirmation.',
  idempotency_key_in_use:
    'a concurrent request is using the same key. Transient in wall-clock terms, but on a payout it ' +
    'means another attempt is IN FLIGHT — retrying races it.',
}

const UNDECIDED_TYPES: Record<string, string> = {
  StripeIdempotencyError:
    'an idempotency key reused with DIFFERENT parameters. Retrying the same call fails identically ' +
    '(terminal-shaped), but it signals a code bug AND may mean an earlier attempt partly succeeded. ' +
    'Wrong either way is expensive.',
  StripeCardError:
    'should be unreachable on our money paths (transfers/reversals are not card charges) — but ' +
    'refunds touch a charge, so reachability is unproven. Classifying an unreachable case is how ' +
    'a wrong rule ships unnoticed.',
}

/** Permanently unrecoverable — the request will never succeed as issued. */
const TERMINAL_CODES: Record<string, string> = {
  resource_missing: 'the referenced object does not exist (deleted/never-created destination, charge, or transfer)',
  account_invalid: 'the connected account is not usable by this platform',
  account_closed: 'the connected account is closed',
  transfers_not_allowed: 'the destination account cannot receive transfers',
  charge_already_refunded: 'already refunded — re-issuing cannot succeed',
}

const TERMINAL_TYPES: Record<string, string> = {
  StripeAuthenticationError: 'bad API credentials — every retry fails identically until config changes',
  StripePermissionError: 'not permitted to act on this account (revoked/deauthorized connection)',
  StripeInvalidGrantError: 'OAuth grant is invalid/expired/foreign',
  StripeInvalidClientError: 'OAuth client is not ours',
}

const TRANSIENT_TYPES: Record<string, string> = {
  StripeConnectionError: 'could not reach Stripe (network/TLS) — the request may not have been seen at all',
  StripeRateLimitError: 'rate limited — back off and retry',
  StripeAPIError: "Stripe-side error; Stripe's own guidance is to retry",
}

const v = (
  c: StripeFailureClass,
  reason: string,
  f: { type?: string; code?: string; statusCode?: number; param?: string },
): StripeFailureVerdict => ({ class: c, reason, ...f })

/**
 * PURE — decides from fields already on the thrown object. No Stripe call, no I/O, not async.
 * That is deliberate and it is what makes this usable inside a catch block, inside the worker's
 * failed handler, and inside a reconciler pattern alike. If it ever needs to ASK Stripe whether
 * an account still exists, that is a different function with different callers, not this one.
 */
export function classifyStripeError(err: unknown): StripeFailureVerdict {
  if (!err || typeof err !== 'object') {
    return v('unknown', 'not an error object — nothing to classify', {})
  }
  const e = err as { type?: unknown; rawType?: unknown; code?: unknown; statusCode?: unknown; param?: unknown }
  const type = typeof e.type === 'string' ? e.type : undefined
  const rawType = typeof e.rawType === 'string' ? e.rawType : undefined
  const code = typeof e.code === 'string' ? e.code : undefined
  const statusCode = typeof e.statusCode === 'number' ? e.statusCode : undefined
  const param = typeof e.param === 'string' ? e.param : undefined
  const f = { type, code, statusCode, param }

  // A non-Stripe error (a Prisma failure, a TypeError) must NEVER be called terminal — that
  // would stop retrying a payout because of an unrelated bug.
  //
  // REQUIRE A STRIPE IDENTITY, not merely "some recognised field". An earlier version of this
  // gate accepted any error carrying a `code`, and its own test caught the consequence: a
  // NON-Stripe error with `code: 'resource_missing'` classified as TERMINAL. `code` is a wildly
  // common property — Prisma uses it (`P2002`), Node uses it (`ECONNRESET`) — so a collision is
  // not hypothetical, and the failure is in the expensive direction. `type` is the only
  // non-optional field on StripeError and every subclass sets it to a 'Stripe…' literal, so it
  // is the identity; rawType is accepted as the alternative for a raw-payload-constructed error.
  const looksStripe = (type != null && type.startsWith('Stripe')) || rawType != null
  if (!looksStripe) {
    return v('unknown', 'no Stripe error identity (type/rawType absent) — not a Stripe error, retries preserved', f)
  }

  // ── ORDER IS LOAD-BEARING: undecided first, before any broad rule can absorb them ──
  if (code && UNDECIDED_CODES[code]) return v('unknown', `UNDECIDED (${code}): ${UNDECIDED_CODES[code]}`, f)
  if (type && UNDECIDED_TYPES[type]) return v('unknown', `UNDECIDED (${type}): ${UNDECIDED_TYPES[type]}`, f)
  if (rawType === 'idempotency_error') return v('unknown', `UNDECIDED (idempotency_error): ${UNDECIDED_TYPES.StripeIdempotencyError}`, f)
  if (rawType === 'card_error') return v('unknown', `UNDECIDED (card_error): ${UNDECIDED_TYPES.StripeCardError}`, f)

  if (code && TERMINAL_CODES[code]) return v('terminal', `${code}: ${TERMINAL_CODES[code]}`, f)
  if (type && TERMINAL_TYPES[type]) return v('terminal', `${type}: ${TERMINAL_TYPES[type]}`, f)
  if (type && TRANSIENT_TYPES[type]) return v('transient', `${type}: ${TRANSIENT_TYPES[type]}`, f)

  if (rawType === 'rate_limit_error' || rawType === 'rate_limit' || statusCode === 429) {
    return v('transient', 'rate limited — back off and retry', f)
  }
  if (rawType === 'authentication_error') return v('terminal', 'authentication_error: credentials will not fix themselves on retry', f)
  if (statusCode != null && statusCode >= 500) return v('transient', `HTTP ${statusCode} — Stripe-side, retry`, f)

  // A 4xx with no recognised code. Malformed requests do not fix themselves, but an UNRECOGNISED
  // 4xx code is exactly where a new Stripe error would land, so this stays 'unknown' rather than
  // being swept into terminal. Being wrong here stops retrying a payout that might have worked.
  if (statusCode != null && statusCode >= 400 && statusCode < 500) {
    return v('unknown', `HTTP ${statusCode}${code ? ` (${code})` : ''} with no classified code — a human decides`, f)
  }
  if (rawType === 'invalid_request_error') {
    return v('unknown', `invalid_request_error${code ? ` (${code})` : ''} with no classified code — a human decides`, f)
  }

  return v('unknown', `unrecognised Stripe error (type=${type ?? '?'}, code=${code ?? '?'})`, f)
}

/**
 * Convenience for the two consumers, so neither re-derives "does terminal mean stop retrying".
 * NOTE `unknown` is deliberately NOT terminal: an unrecognised failure keeps its retries.
 */
export const isTerminalStripeError = (err: unknown): boolean => classifyStripeError(err).class === 'terminal'
