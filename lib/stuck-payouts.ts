/**
 * THE STUCK-PAYOUT SET — one derivation, read by reconciler Pattern U and by the admin money
 * page. Deriving "which payouts are stuck" twice is the class this codebase keeps closing;
 * doing it once for an alert and once for a screen would be that class with a screen attached.
 *
 * ── WHY PATTERN U'S QUERIES COULD NOT BE CALLED AS-IS ───────────────────────────────────────
 * Pattern U was built to ALERT, not to LIST, and differs in four ways that all matter here:
 *   1. GLOBAL — no eventId filter. The admin money page is per-fair
 *      (`requireAdminFairContext`), so reusing it verbatim would surface OTHER FAIRS' failed
 *      payouts on one fair's page — precisely what the chokepoint exists to prevent.
 *   2. THRESHOLD-FILTERED — it suppresses anything newer than STUCK_FAILED_MIN. An admin list
 *      wants the row that failed thirty seconds ago.
 *   3. STRINGS — it formats into `sum.alerted`; there is no structured set to reuse.
 *   4. NO CAUSE — it never captured why.
 *
 * So this returns STRUCTURED, UNFILTERED, OPTIONALLY-SCOPED rows and lets each caller apply its
 * own policy: Pattern U applies the age threshold, the admin route passes an eventId.
 *
 * `eventId` is optional ON PURPOSE — Pattern U passes none (it is a platform-wide sweep), the
 * admin route always passes one. That also makes a future platform-wide super-admin view cheap:
 * it calls this with no eventId and needs no new query.
 */

import { db } from './db'
import type { PayoutLeg, PayoutFailureCause } from './payout-failure-marker'

export interface StuckPayoutRow {
  leg: PayoutLeg
  /** runner + vendor → orderId · organizer → OrganizerPayout batch id. The retry anchor. */
  id: string
  eventId: string
  /** runner → runnerId · organizer → organizerId · vendor → vendorId. May be null on legacy rows. */
  payeeId: string | null
  amountCents: number | null
  /** From the latest PAYOUT_FAILED audit. null ⇒ a legacy marker with no audit (age unknown). */
  failedAt: Date | null
  /**
   * The classified cause, recovered from that audit's metadata. null on any marker written
   * before cause-capture existed — shown as "cause not recorded" rather than guessed at.
   *
   * ⚠️ `stripeMessage` is STRIPE-AUTHORED TEXT. Render escaped, never as markup.
   */
  cause: PayoutFailureCause | null
}

/** Audit key — mirrors Pattern U: runner/vendor age by orderId, organizer by eventId. */
const auditKey = (payeeType: string, id: string) => `${payeeType}:${id}`

export async function findStuckPayouts(opts: {
  /** Scope to ONE fair. Omit for a platform-wide sweep (Pattern U). */
  eventId?: string
  /** Per-leg cap. */
  limit?: number
  /** Which legs to include. Defaults to runner + organizer (the reconciler-side legs). */
  legs?: PayoutLeg[]
} = {}): Promise<StuckPayoutRow[]> {
  const take = opts.limit ?? 100
  const legs = opts.legs ?? ['runner', 'organizer']
  const scope = opts.eventId ? { eventId: opts.eventId } : {}

  const [runners, organizers, vendors] = await Promise.all([
    legs.includes('runner')
      ? db.runnerEarning.findMany({
          where: { status: 'failed', ...scope },
          select: { orderId: true, eventId: true, runnerId: true, amountCents: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take,
        })
      : Promise.resolve([]),
    legs.includes('organizer')
      ? db.organizerPayout.findMany({
          where: { status: 'failed', ...scope },
          select: { id: true, eventId: true, organizerId: true, totalCents: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take,
        })
      : Promise.resolve([]),
    legs.includes('vendor')
      ? db.order.findMany({
          where: { payoutStatus: 'FAILED', ...scope },
          select: { id: true, eventId: true, vendorId: true, vendorPayout: true },
          orderBy: [{ placedAt: 'asc' }, { id: 'asc' }], take,
        })
      : Promise.resolve([]),
  ])

  // One audit read for the whole set — the failed-since timestamp AND the cause both live there
  // (the status columns carry neither). desc ⇒ the first row seen per key is the latest.
  const audits = await db.adminMoneyAction.findMany({
    where: { action: 'PAYOUT_FAILED', ...(opts.eventId ? { eventId: opts.eventId } : {}) },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, payeeType: true, orderId: true, eventId: true, metadata: true },
    take: 2000,
  })
  const latest = new Map<string, { at: Date; cause: PayoutFailureCause | null }>()
  for (const a of audits) {
    const k = auditKey(a.payeeType, a.orderId ?? a.eventId)
    if (latest.has(k)) continue
    const m = a.metadata as Record<string, unknown> | null
    const cause: PayoutFailureCause | null =
      m && typeof m.stripeMessage === 'string'
        ? {
            verdict: typeof m.verdict === 'string' ? m.verdict : 'unknown',
            stripeMessage: m.stripeMessage,
            stripeType: typeof m.stripeType === 'string' ? m.stripeType : undefined,
            stripeCode: typeof m.stripeCode === 'string' ? m.stripeCode : undefined,
          }
        : null
    latest.set(k, { at: a.createdAt, cause })
  }
  const lookup = (payeeType: string, id: string) => latest.get(auditKey(payeeType, id)) ?? null

  const rows: StuckPayoutRow[] = []
  for (const r of runners) {
    const a = lookup('runner', r.orderId)
    rows.push({ leg: 'runner', id: r.orderId, eventId: r.eventId, payeeId: r.runnerId,
      amountCents: r.amountCents, failedAt: a?.at ?? null, cause: a?.cause ?? null })
  }
  for (const o of organizers) {
    const a = lookup('organizer', o.eventId)
    rows.push({ leg: 'organizer', id: o.id, eventId: o.eventId, payeeId: o.organizerId,
      amountCents: o.totalCents, failedAt: a?.at ?? null, cause: a?.cause ?? null })
  }
  for (const v of vendors) {
    const a = lookup('vendor', v.id)
    rows.push({ leg: 'vendor', id: v.id, eventId: v.eventId, payeeId: v.vendorId,
      amountCents: v.vendorPayout == null ? null : Math.round(v.vendorPayout * 100),
      failedAt: a?.at ?? null, cause: a?.cause ?? null })
  }
  return rows
}
