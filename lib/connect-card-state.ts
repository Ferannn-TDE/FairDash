// ─────────────────────────────────────────────────────────────────────────────
// Payout-setup card state (readiness 1.4) — PURE and browser-safe.
//
// The one place that decides what StripeConnectCard shows for vendor, runner and organizer:
//
//   not_connected — no Stripe account yet                → "Set up payouts"
//   needs_info    — Stripe is waiting on the payee       → "Stripe needs: ID document" + finish button
//   verifying     — nothing due from the payee, but transfers aren't active yet (Stripe is
//                   reviewing). Used to read "Payout setup unfinished" with a finish button,
//                   which sent people back into a flow they had already completed.
//   active        — transfers active                     → "Payouts active"
//
// scripts/connect-card-state-test.ts pins the states, the wording and the poll schedule.
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectCardState = 'not_connected' | 'needs_info' | 'verifying' | 'active'

/** A requirement Stripe is waiting on the PAYEE for (awaiting_action_from = 'user'). */
export interface ConnectDueItem {
  description: string
  deadline: 'currently_due' | 'past_due' | 'eventually_due' | string
}

export interface ConnectStatusView {
  connected: boolean
  readyToReceivePayments: boolean
  /** User-actionable requirements that block now (currently_due / past_due). */
  dueItems?: ConnectDueItem[]
  /** Fallback when Stripe returned no entries: the summary deadline. */
  onboardingComplete?: boolean
}

export function deriveConnectCardState(s: ConnectStatusView): ConnectCardState {
  if (!s.connected) return 'not_connected'
  if (s.readyToReceivePayments) return 'active'
  const blocking = (s.dueItems ?? []).filter(i => i.deadline === 'currently_due' || i.deadline === 'past_due')
  if (blocking.length > 0) return 'needs_info'
  // No entries at all but the summary says something is due → still the payee's move.
  if (!s.dueItems?.length && s.onboardingComplete === false) return 'needs_info'
  return 'verifying'
}

// Stripe's requirement descriptions → words a payee recognises. Matched by substring on the
// lower-cased description, first hit wins; unknown items fall back to a generic line.
const PLAIN: Array<[RegExp, string]> = [
  [/document/, 'ID document'],  // verification.document, additional_document, id_document…
  [/ssn|id_number|tax id|tin\b/, 'Social Security or tax ID number'],
  [/\bdob\b|date of birth/, 'date of birth'],
  [/address/, 'home address'],
  [/bank|external_account|payout method/, 'bank account for payouts'],
  [/tos_acceptance|terms of service|terms/, 'agreement to Stripe’s terms'],
  [/phone/, 'phone number'],
  [/email/, 'email address'],
  [/business_profile|website|\burl\b|mcc|product description/, 'business details'],
  [/first_name|last_name|\bname\b/, 'legal name'],
]
export const GENERIC_NEED = 'more information'

export function plainRequirement(description: string): string {
  const d = description.toLowerCase()
  return PLAIN.find(([re]) => re.test(d))?.[1] ?? GENERIC_NEED
}

/** "Stripe needs: ID document, date of birth" — de-duplicated, blocking items only. */
export function needsLine(items: ConnectDueItem[] | undefined): string {
  const blocking = (items ?? []).filter(i => i.deadline === 'currently_due' || i.deadline === 'past_due')
  const words = [...new Set(blocking.map(i => plainRequirement(i.description)))]
  return `Stripe needs: ${words.length ? words.join(', ') : GENERIC_NEED}`
}

/**
 * While verifying, how long until the next status read (ms), and whether it should be a
 * fresh (uncached) Stripe read. Every 3s for the first 30s, every 15s up to 5 min, then a
 * slow cached refresh every 60s so the page still updates on its own.
 */
export function verifyingPoll(elapsedMs: number): { delayMs: number; fresh: boolean; longWait: boolean } {
  if (elapsedMs < 30_000) return { delayMs: 3_000, fresh: true, longWait: false }
  if (elapsedMs < 300_000) return { delayMs: 15_000, fresh: true, longWait: false }
  return { delayMs: 60_000, fresh: false, longWait: true }
}

export const VERIFYING_COPY = {
  title: 'Verifying with Stripe',
  body: 'Usually under a minute. No action needed.',
  longWait: 'Still verifying. This page updates on its own; you can leave and come back.',
}

/**
 * The verifying poll LOOP, on verifyingPoll's schedule. Keeps reading until the answer is not
 * "verifying" (null = a failed read → keep going) or `cancelled()` turns true (unmount, or the
 * card left verifying). Owns its own timing so it cannot depend on React re-rendering.
 *
 * 2026-10-20: the card used to re-arm its timer from a useEffect keyed on state. A read that
 * answered "verifying" again set the SAME state, React skipped the re-render, and the card
 * froze on "Verifying with Stripe" after one poll.
 */
export async function pollWhileVerifying(opts: {
  load: (fresh: boolean) => Promise<ConnectCardState | null>
  sleep: (ms: number) => Promise<void>
  now: () => number
  cancelled: () => boolean
  onLongWait?: (longWait: boolean) => void
}): Promise<void> {
  const start = opts.now()
  while (!opts.cancelled()) {
    const { delayMs, fresh, longWait } = verifyingPoll(opts.now() - start)
    opts.onLongWait?.(longWait)
    await opts.sleep(delayMs)
    if (opts.cancelled()) return
    const next = await opts.load(fresh)
    if (next !== null && next !== 'verifying') return
  }
}
