import { startOfDayInZone } from './audit-time'
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
 * No possession → rate 1.0 (a runner who hasn't taken possession of anything has failed
 * nothing).
 *
 * A DELIVERY IS ITSELF PROOF OF POSSESSION. The status route permits RUNNER_COLLECTED →
 * DELIVERED on the proof photo alone — no collectedAt precondition — so a runner can legally
 * deliver without ever tapping "collect". Counting only tap-evidenced orders would erase that
 * real delivery: the same evidence-shaped-undercount class as the fee-shaped count this module
 * replaced (reconcile-order-status's "DELIVERED accrual is still a proxy for collection" note
 * is the same acknowledgment). So the denominator is the UNION of tap-collected orders and
 * delivered-assigned orders; the numerator is delivered-assigned.
 *
 * The "today" bucket keys on the 'collected' event's timestamp, falling back to dispatchedAt
 * (claim time) when the tap was skipped: no deliveredAt column exists (Order.completedAt is a
 * load-bearing null on DELIVERED — Pattern C/S money windows — and OrderEvent is not written
 * on the DELIVERED transition). Claim→collect→deliver is minutes on a fair day, so the
 * possession-window start is the honest available day-bucket; the only distortion is an order
 * picked up before midnight and delivered after.
 */

/**
 * One distinct order this runner is involved with — via a 'collected' custody event, a live
 * DELIVERED assignment, or both. The pure core's whole input: no money field exists here.
 */
export interface CustodyCountRow {
  /** 'collected' event timestamp; null = the tap was skipped (possession proven by delivery). */
  collectedAt: Date | null
  /** Fallback possession signal for the day bucket (Order.dispatchedAt — claim time). */
  possessionAt: Date | null
  order: { status: string; runnerId: string | null }
}

export interface RunnerCustodyStats {
  collected: number      // distinct orders this runner took possession of (the denominator)
  delivered: number      // of those, DELIVERED and still assigned to them
  deliveredToday: number // delivered, with the possession window starting today
  rate: number           // 0..1; 1.0 when collected === 0 (failed nothing)
}

/**
 * The pure core — counts from possession rows alone. No fee, tip, or ledger field is even in
 * the input shape: a delivered order counts whether or not it accrued a cent (the
 * fee-shaped-count class this module exists to prevent), and whether or not the collect tap
 * was made (delivery proves possession).
 */
/**
 * @param timeZone  The FAIR's IANA zone (Event.timezone) — REQUIRED, never defaulted. See
 *   lib/audit-time.ts: this used to be server-local midnight, which on a UTC host split one
 *   Chicago day in two and reported 1 delivery for a 2-delivery day.
 *
 * ⚠️ KNOWN RESIDUAL — the day here is keyed on possession (collectedAt ?? dispatchedAt), while
 * the MONEY day in lib/runner-earnings.ts is keyed on RunnerEarning.createdAt (accrual, at
 * DELIVERED). Zoning does not reconcile them: an order collected 11:55 PM and delivered 12:05 AM
 * counts on one day and pays on the next. Deliberately left — which instant "counts" a delivery
 * to a day is a product decision, not a boundary bug.
 */
export function summarizeCustody(
  rows: CustodyCountRow[],
  runnerId: string,
  timeZone: string,
  nowMs = Date.now(),
): RunnerCustodyStats {
  const startOfToday = startOfDayInZone(nowMs, timeZone)
  const deliveredRows = rows.filter(r => r.order.status === 'DELIVERED' && r.order.runnerId === runnerId)
  // The denominator: every row is a possession — a tap-collected order, a delivered order, or
  // both (the caller de-duplicates per order). A row that is neither (defensive) doesn't count.
  const collected = rows.filter(r => r.collectedAt !== null || (r.order.status === 'DELIVERED' && r.order.runnerId === runnerId)).length
  const delivered = deliveredRows.length
  const dayOf = (r: CustodyCountRow) => r.collectedAt ?? r.possessionAt
  const deliveredToday = deliveredRows.filter(r => { const d = dayOf(r); return d !== null && d >= startOfToday }).length
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

  // voidedAt: null on BOTH queries — a voided (out-of-model test-junk) order must not score a
  // runner, same as every other aggregate (fair-vendors, admin-fair-reports, organizer-payout).
  // The custody WRITE paths refuse voided orders (collect-order returns order_voided), but a
  // legacy event written before the void must not linger in the denominator.
  const orderScope = { voidedAt: null, ...(scope?.eventId ? { eventId: scope.eventId } : {}) }

  // THE FAIR'S ZONE, per runner, resolved HERE so no caller can forget to pass one and silently
  // fall back to the server's. Runner is event-scoped (Runner.eventId), so the zone is always
  // reachable from the row itself — a hardcoded 'America/Chicago' would be right for today's
  // only fair and wrong for the first fair anywhere else.
  const [runnerZones, events, deliveredOrders] = await Promise.all([
    db.runner.findMany({
      where: { id: { in: runnerIds } },
      select: { id: true, event: { select: { timezone: true } } },
    }),
    // Possession by tap: the 'collected' custody events. A re-collect after a confirmed return
    // is a second chance on the same order, not a second order — distinct per (order, runner).
    db.deliveryCustodyEvent.findMany({
      where: { eventType: 'collected', runnerId: { in: runnerIds }, order: orderScope },
      select: { orderId: true, runnerId: true, timestamp: true, order: { select: { status: true, runnerId: true } } },
      distinct: ['orderId', 'runnerId'],
    }),
    // Possession by delivery: DELIVERED orders assigned to a roster runner whose collect tap
    // was skipped would otherwise vanish from the count (the evidence-shaped-undercount class).
    db.order.findMany({
      where: { status: 'DELIVERED', runnerId: { in: runnerIds }, ...orderScope },
      select: { id: true, runnerId: true, status: true, dispatchedAt: true },
    }),
  ])

  // Union per (runner, order): a tap-collected row wins (it has the honest possession
  // timestamp); a delivered order without a tap joins with dispatchedAt as the day signal.
  const byRunner = new Map<string, Map<string, CustodyCountRow>>()
  for (const id of runnerIds) byRunner.set(id, new Map())
  for (const e of events) {
    if (e.runnerId) byRunner.get(e.runnerId)?.set(e.orderId, { collectedAt: e.timestamp, possessionAt: null, order: e.order })
  }
  for (const o of deliveredOrders) {
    const rows = byRunner.get(o.runnerId!)
    if (rows && !rows.has(o.id)) rows.set(o.id, { collectedAt: null, possessionAt: o.dispatchedAt, order: { status: o.status, runnerId: o.runnerId } })
  }

  const zoneOf = new Map(runnerZones.map(r => [r.id, r.event.timezone]))
  for (const id of runnerIds) {
    // Event.timezone is non-nullable with a schema default, so a missing entry can only mean the
    // runner id does not exist — in which case there are no rows to bucket and the zone is inert.
    stats.set(id, summarizeCustody([...byRunner.get(id)!.values()], id, zoneOf.get(id) ?? 'UTC'))
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
