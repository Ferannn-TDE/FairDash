import { startOfDayInZone } from './audit-time'
/**
 * Runner earnings summarizer — the ONE derivation of "what MONEY does this runner see".
 * (Delivery COUNTS live in lib/runner-completion.ts — custody is the spine for counts.)
 *
 * History (2026-07-22 diagnosis): the LEDGER was already right — reconcileMasterStatus accrues
 * amountCents = runnerShare (runnerFeePercent × fee) + tip. But the earnings surfaces still
 * carried pre-Part-A copy claiming the number was "the delivery fee the customer paid" (and
 * "NO tips: there is no tip data model"). For #762F3H0Y: fee $12.99, tip $5.00, percent 50 →
 * ledger $11.50 = $6.50 share + $5.00 tip; the organizer row holds the other $6.49. The number
 * was true; the copy lied about what it was. This module makes the breakdown explicit so the
 * UI can only describe what the ledger actually contains.
 *
 * Decomposition: tip is 100% the runner's, so tipCents = round(order.tip × 100) and
 * feeShareCents = amountCents − tipCents (clamped at 0 for defensive honesty on any legacy row
 * that predates the formula — a clamped row shows the whole amount as fee share, never a
 * negative). Display status: tracked → pending (earned, transfers after the refund window),
 * held → held (admin freeze — still earned), paid → paid, cancelled → cancelled (excluded from
 * every total; shown struck-through in history).
 */

export interface RunnerLedgerRow {
  orderId: string
  amountCents: number
  status: string // tracked | held | cancelled | paid
  paidAt: Date | null
  createdAt: Date
  order: { tip: number | null; fulfillmentType: string }
}

export type RunnerEarningDisplayStatus = 'pending' | 'held' | 'paid' | 'cancelled'

export interface RunnerEarningLine {
  orderId: string
  totalCents: number
  feeShareCents: number
  tipCents: number
  status: RunnerEarningDisplayStatus
  fulfillmentType: string
  at: Date
  paidAt: Date | null
}

export interface RunnerEarningsSummary {
  lines: RunnerEarningLine[]
  earnedTotalCents: number   // everything not cancelled
  paidTotalCents: number
  pendingTotalCents: number  // tracked — transfers after the refund window
  heldTotalCents: number     // admin-frozen, still earned
  earnedTodayCents: number
  // NO delivery counts here — CUSTODY IS THE SPINE FOR COUNTS, THE LEDGER FOR MONEY
  // (lib/runner-completion.ts). This summary once exposed deliveriesToday/deliveriesTotal,
  // and they undercounted: a DELIVERED zero-fee no-tip order accrues no RunnerEarning row,
  // so it was invisible to a ledger-derived count. The fields were REMOVED, not kept in
  // parallel, so no future caller can reach for the wrong spine.
}

const DISPLAY_STATUS: Record<string, RunnerEarningDisplayStatus> = {
  tracked: 'pending', held: 'held', paid: 'paid', cancelled: 'cancelled',
}

/**
 * @param timeZone  The FAIR's IANA zone (Event.timezone) — REQUIRED, never defaulted. "Today"
 *   means the runner's wall-clock day where the fair is, not the server's. This used to be
 *   `setHours(0,0,0,0)` = server-local midnight, which on Vercel (UTC) split one Chicago day
 *   across two buckets and reported "$11.50" for a $21.00 day. See lib/audit-time.ts.
 *
 * ⚠️ KNOWN RESIDUAL — this keys the day on RunnerEarning.createdAt (the ACCRUAL instant, written
 * at DELIVERED), while the delivery COUNT keys on Order.collectedAt (possession start) in
 * lib/runner-completion.ts. Zoning the boundary does NOT reconcile those: an order collected
 * 11:55 PM and delivered 12:05 AM still lands the money on one day and the count on the previous
 * one. Deliberately left — deciding which instant "counts" a delivery to a day is a product
 * question, not a boundary bug. Do not silently unify them; decide it.
 */
export function summarizeRunnerEarnings(
  rows: RunnerLedgerRow[],
  timeZone: string,
  nowMs = Date.now(),
): RunnerEarningsSummary {
  const startOfToday = startOfDayInZone(nowMs, timeZone)

  const lines: RunnerEarningLine[] = rows.map(r => {
    const tipCents = Math.min(Math.max(Math.round((r.order.tip ?? 0) * 100), 0), r.amountCents)
    return {
      orderId: r.orderId,
      totalCents: r.amountCents,
      feeShareCents: r.amountCents - tipCents,
      tipCents,
      status: DISPLAY_STATUS[r.status] ?? 'pending',
      fulfillmentType: r.order.fulfillmentType,
      at: r.createdAt,
      paidAt: r.paidAt,
    }
  })

  const live = lines.filter(l => l.status !== 'cancelled')
  const sum = (ls: RunnerEarningLine[]) => ls.reduce((s, l) => s + l.totalCents, 0)
  const todayLive = live.filter(l => l.at >= startOfToday)

  return {
    lines,
    earnedTotalCents: sum(live),
    paidTotalCents: sum(live.filter(l => l.status === 'paid')),
    pendingTotalCents: sum(live.filter(l => l.status === 'pending')),
    heldTotalCents: sum(live.filter(l => l.status === 'held')),
    earnedTodayCents: sum(todayLive),
  }
}
