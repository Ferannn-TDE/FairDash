import { db } from './db'

/**
 * Runner custody stats — the ONE derivation of "how many deliveries, out of how many chances".
 *
 * THE RULE (decided 2026-07-23, both surfaces): CUSTODY IS THE SPINE FOR COUNTS; THE LEDGER IS
 * THE SPINE FOR MONEY. Delivery counts, delivered/collected, completion denominators all derive
 * from DeliveryCustodyEvent here. Dollars, paid/pending, per-delivery breakdown derive from
 * RunnerEarning (lib/runner-earnings.ts). They answer different questions: the ledger only ever
 * knew about deliveries that generated money, so a DELIVERED zero-fee no-tip order (a real
 * delivery, no accrual) is invisible to it — counting from the ledger undercounted the runner's
 * own "Deliveries" stat. This module has NO fee, tip, or RunnerEarning dependency by design.
 *
 * Completion policy (v1, decided 2026-07-22): a runner is measured on POSSESSION-then-failure,
 * not on flagging early. The denominator is orders this runner actually COLLECTED (took the
 * bag — a 'collected' custody event); the numerator is those the runner DELIVERED. A PRE-collect
 * release never produces a 'collected' event, so it is not in the denominator and does NOT
 * count against the runner — which is the whole point of the release path we built. A
 * POST-collect return does count against (collected, not delivered). Voided orders are ghosts:
 * dead to this module like every other runner surface (order: { voidedAt: null }).
 *
 * DELIBERATE v1 SIMPLIFICATION (flagged, not solved): "return-after-collect counts against
 * completion" treats a runner who returned spoiled/wrong food the same as one who flaked. A
 * later version may want to distinguish those, and to not damn the first runner forever when a
 * SECOND runner completes the order. For now: collected-but-not-delivered-by-this-runner counts
 * against, full stop.
 *
 * "Delivered by this runner" = the order is DELIVERED and still assigned to them (a confirmed
 * return nulls Order.runnerId, so a returned order can never be miscounted as their delivery).
 * No collected events → rate 1.0 (a runner who hasn't taken possession of anything has failed
 * nothing).
 *
 * The "today" bucket keys on the 'collected' event's timestamp: no deliveredAt column exists
 * (Order.completedAt is a load-bearing null on DELIVERED — Pattern C/S money windows — and
 * OrderEvent is not written on the DELIVERED transition). Collect→deliver is minutes on a fair
 * day, so the collect time is the honest available day-bucket; the only distortion is an order
 * collected before midnight and delivered after.
 */

/** One distinct (order, runner) 'collected' custody row — the pure core's whole input. */
export interface CustodyCountRow {
  timestamp: Date
  order: { status: string; runnerId: string | null }
}

export interface RunnerCustodyStats {
  collected: number      // distinct orders this runner took possession of (the denominator)
  delivered: number      // of those, DELIVERED and still assigned to them
  deliveredToday: number // delivered, with the collect event stamped today
  rate: number           // 0..1; 1.0 when collected === 0 (failed nothing)
}

/**
 * The pure core — counts from custody rows alone. No fee, tip, or ledger field is even in the
 * input shape: a delivered order counts whether or not it accrued a cent (the fee-shaped-count
 * class this module exists to prevent).
 */
export function summarizeCustody(rows: CustodyCountRow[], runnerId: string, nowMs = Date.now()): RunnerCustodyStats {
  const startOfToday = new Date(nowMs); startOfToday.setHours(0, 0, 0, 0)
  const collected = rows.length
  const deliveredRows = rows.filter(r => r.order.status === 'DELIVERED' && r.order.runnerId === runnerId)
  const delivered = deliveredRows.length
  const deliveredToday = deliveredRows.filter(r => r.timestamp >= startOfToday).length
  return { collected, delivered, deliveredToday, rate: collected === 0 ? 1 : delivered / collected }
}

/**
 * Batched DB reader — one query for a whole roster (the admin runners page loads up to 500;
 * a per-runner query would be the N+1 slow-creep the admin-504 watch item warns about).
 * Event scoping lives HERE, via order.eventId (DeliveryCustodyEvent carries no eventId of its
 * own), so every caller — admin today, a runner-facing per-fair view later — passes the same
 * scope instead of growing a second implementation.
 */
export async function computeRunnerCompletionRates(
  runnerIds: string[],
  scope?: { eventId?: string },
): Promise<Map<string, RunnerCustodyStats>> {
  const stats = new Map<string, RunnerCustodyStats>()
  if (runnerIds.length === 0) return stats

  const events = await db.deliveryCustodyEvent.findMany({
    // voidedAt: null — a voided (out-of-model test-junk) order must not score a runner, same
    // as every other aggregate (fair-vendors, admin-fair-reports, organizer-payout). The
    // custody WRITE paths refuse voided orders (collect-order returns order_voided), but a
    // legacy event written before the void must not linger in the denominator. One filter
    // covers both sides: delivered is derived from this same filtered list.
    where: {
      eventType: 'collected',
      runnerId: { in: runnerIds },
      order: { voidedAt: null, ...(scope?.eventId ? { eventId: scope.eventId } : {}) },
    },
    select: { runnerId: true, timestamp: true, order: { select: { status: true, runnerId: true } } },
    // A re-collect after a confirmed return is a second chance on the same order, not a second
    // order — distinct per (order, runner).
    distinct: ['orderId', 'runnerId'],
  })

  for (const id of runnerIds) {
    stats.set(id, summarizeCustody(events.filter(e => e.runnerId === id), id))
  }
  return stats
}

/** Single-runner form — a thin caller over the batch. */
export async function computeRunnerCompletionRate(
  runnerId: string,
  scope?: { eventId?: string },
): Promise<RunnerCustodyStats> {
  const stats = await computeRunnerCompletionRates([runnerId], scope)
  return stats.get(runnerId)!
}
