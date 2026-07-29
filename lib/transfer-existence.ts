/**
 * DOES EVERY TRANSFER ID WE STORE ACTUALLY EXIST IN STRIPE?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
 * Pattern X2 finds a settled transfer with no ledger row. There was no INVERSE: nothing checked
 * that a ledger row's transfer id resolves to anything at all. A row could claim payment against
 * an id that does not exist and every screen would stay perfectly consistent with itself and
 * wrong.
 *
 * Run once by hand, it immediately found 76 `Payout` rows — and 76 `VendorEarning` rows marked
 * `paid` — pointing at ids Stripe has never heard of. That is the FOURTH test-pollution incident
 * on this database and the first three were each found by accident. This check would have caught
 * all four on the day they happened.
 *
 * ── MEMBERSHIP IS ABSENCE FROM STRIPE, NEVER ID SHAPE ───────────────────────────────────────
 * The polluted ids happen to be short (`tr_` + 8 chars, from a test spy's `tr_${rand()}`) while
 * real ones are `tr_` + 24. That correlation is CORROBORATION, never the criterion — a heuristic
 * is how you delete the wrong money row. Measured on all 140 rows the two partitions agreed
 * exactly (0 fake-shaped-but-live, 0 real-shaped-but-missing), and `shapeDisagreements` is
 * reported so that if they ever diverge it surfaces as a finding rather than a silent
 * reclassification.
 *
 * ── WHY BULK, AND WHY NOT A RECONCILER PATTERN ──────────────────────────────────────────────
 * `transfers.list` returns 100 per page with `amount`/`reversed`/`destination`/`metadata`
 * inline — measured at 69 transfers in 792ms, versus ~103ms per `retrieve`. So the whole check
 * is one call, ~11× cheaper than the per-row shape.
 *
 * It is still NOT a sweep pattern. Every other pattern reads the database only; this one needs
 * the network, and putting it in the 60s loop would make a Stripe outage look like a sweep
 * failure. Nothing it finds is 60-second-urgent — a divergence is a REPORTING error, the money
 * has already moved or it hasn't. Hand-runnable + admin-triggered is the right cadence.
 */

import { db } from './db'
import { stripe } from './stripe'
import { POLLUTED_TRANSFER_IDS, POLLUTION_COHORT_REASON } from './pollution-cohort'

export interface TransferCheckRow {
  leg: 'vendor' | 'runner' | 'organizer'
  /** vendor → Payout.id · runner → orderId · organizer → batch id */
  ref: string
  transferId: string
  eventId: string
  amountCents: number
  /** True ⇒ Stripe has no such transfer. The defect. */
  missing: boolean
  /** Corroboration only — never the membership rule. */
  shortShaped: boolean
}

export interface TransferCheckResult {
  scanned: number
  ok: number
  missing: TransferCheckRow[]
  /** Rows where the shape heuristic and the definitive rule DISAGREE. Should be 0; a finding if not. */
  shapeDisagreements: TransferCheckRow[]
  stripeTransfersSeen: number
  /** Rows deliberately excluded — see ACKNOWLEDGED_MISSING_TRANSFERS. */
  suppressed: TransferCheckRow[]
}

/**
 * ⛔ PERMANENT — NOT a temporary marker awaiting cleanup. The cleanup is DONE (2026-07-29).
 *
 * This said "TEMPORARY — pending the cleanup decision". The decision was made and executed: the
 * VendorEarning rows are retired to `cancelled`, and the fabricated `Payout` rows STAY, on
 * purpose — they are the artifact this very check names. So the set does not expire; retiring
 * the earnings is precisely what makes it permanent. See lib/pollution-cohort.ts for the three
 * dependents and what breaks if it is pruned.
 *
 * 76 `Payout` rows on Italian Fest 2026 carry transfer ids Stripe has never had. They are
 * DECLARED here so the check is usable today: anything OUTSIDE this set fails loudly.
 *
 * WHAT THEY ARE, measured — not inferred from dates or amounts:
 *   • The ORDERS are REAL. All 76 have a `stripePaymentIntentId` AND a `stripeChargeId`, and
 *     every sampled PaymentIntent resolves in Stripe. They are the operator's own manual test
 *     orders through the real checkout (`customerName: 'Refund Test'`, one Clerk user).
 *   • The PAYOUT ROWS are fabricated — written by a test suite's Stripe spy against prod.
 *   • 38 of the 76 orders ALSO have a genuine payout, so these are duplicate rows layered on
 *     top of real ones, not a phantom order set.
 *
 * NOTE: Stripe is in TEST MODE and always has been, so no real money is implicated anywhere in
 * this. What is at stake is LEDGER CORRECTNESS going into the real fair — not a debt.
 *
 * Keyed by transfer id (globally unique) rather than by row id, so it cannot silently widen.
 */
export const ACKNOWLEDGED_MISSING_TRANSFERS = {
  reason: POLLUTION_COHORT_REASON,
  /**
   * The ids live in lib/pollution-cohort.ts — ONE declared set, shared with the vendor display
   * filter rather than copied. Two consumers of one list; a second copy is how the two would
   * drift and how a vendor would end up seeing money that was never sent.
   */
  ids: POLLUTED_TRANSFER_IDS,
}

const shortShaped = (id: string) => id.replace(/^tr_/, '').length < 20

/** Every transfer Stripe currently has, paginated. One call per 100. */
export async function fetchAllStripeTransferIds(maxPages = 50): Promise<Set<string>> {
  const ids = new Set<string>()
  let startingAfter: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const res = await stripe.transfers.list({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) })
    for (const t of res.data) ids.add(t.id)
    if (!res.has_more || res.data.length === 0) break
    startingAfter = res.data[res.data.length - 1].id
  }
  return ids
}

export async function checkTransferExistence(opts: { eventId?: string } = {}): Promise<TransferCheckResult> {
  const live = await fetchAllStripeTransferIds()
  const scope = opts.eventId ? { eventId: opts.eventId } : {}

  const [payouts, runners, organizers] = await Promise.all([
    db.payout.findMany({ where: scope, select: { id: true, stripeTransferId: true, netAmount: true, eventId: true, createdAt: true } }),
    // `{ not: null }` — NOT `{ not: undefined }`, which Prisma treats as no filter at all and
    // silently matches every row (see §8). The nullable columns need the explicit null.
    db.runnerEarning.findMany({ where: { stripeTransferId: { not: null }, ...scope }, select: { orderId: true, stripeTransferId: true, amountCents: true, eventId: true } }),
    db.organizerPayout.findMany({ where: { stripeTransferId: { not: null }, ...scope }, select: { id: true, stripeTransferId: true, totalCents: true, eventId: true } }),
  ])

  const rows: (TransferCheckRow & { createdAt?: Date })[] = [
    ...payouts.map(p => ({
      leg: 'vendor' as const, ref: p.id, transferId: p.stripeTransferId, eventId: p.eventId,
      amountCents: Math.round(p.netAmount * 100), missing: !live.has(p.stripeTransferId),
      shortShaped: shortShaped(p.stripeTransferId), createdAt: p.createdAt,
    })),
    ...runners.map(r => ({
      leg: 'runner' as const, ref: r.orderId, transferId: r.stripeTransferId!, eventId: r.eventId,
      amountCents: r.amountCents, missing: !live.has(r.stripeTransferId!),
      shortShaped: shortShaped(r.stripeTransferId!),
    })),
    ...organizers.map(o => ({
      leg: 'organizer' as const, ref: o.id, transferId: o.stripeTransferId!, eventId: o.eventId,
      amountCents: o.totalCents, missing: !live.has(o.stripeTransferId!),
      shortShaped: shortShaped(o.stripeTransferId!),
    })),
  ]

  const A = ACKNOWLEDGED_MISSING_TRANSFERS
  const acknowledged = (r: TransferCheckRow) => A.ids.has(r.transferId)

  const missingAll = rows.filter(r => r.missing)
  return {
    scanned: rows.length,
    ok: rows.length - missingAll.length,
    missing: missingAll.filter(r => !acknowledged(r)),
    suppressed: missingAll.filter(acknowledged),
    // The two rules must partition identically. Any row where they disagree is a finding.
    shapeDisagreements: rows.filter(r => r.missing !== r.shortShaped),
    stripeTransfersSeen: live.size,
  }
}
