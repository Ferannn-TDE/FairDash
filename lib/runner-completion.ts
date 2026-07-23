import { db } from './db'

/**
 * Runner completion rate = delivered / collected, fed from the custody events.
 *
 * Policy (v1, decided 2026-07-22): a runner is measured on POSSESSION-then-failure, not on
 * flagging early. The denominator is orders this runner actually COLLECTED (took the bag — a
 * 'collected' custody event); the numerator is those the runner DELIVERED. A PRE-collect
 * release never produces a 'collected' event, so it is not in the denominator and does NOT
 * count against the runner — which is the whole point of the release path we built. A
 * POST-collect return does count against (collected, not delivered).
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
 */
export interface RunnerCompletion {
  collected: number
  delivered: number
  rate: number // 0..1
}

export async function computeRunnerCompletionRate(runnerId: string): Promise<RunnerCompletion> {
  const events = await db.deliveryCustodyEvent.findMany({
    // voidedAt: null — a voided (out-of-model test-junk) order must not score a runner, same
    // as every other aggregate (fair-vendors, admin-fair-reports, organizer-payout). The
    // custody WRITE paths refuse voided orders (collect-order returns order_voided), but a
    // legacy event written before the void must not linger in the denominator. One filter
    // covers both sides: delivered is derived from this same filtered list.
    where: { eventType: 'collected', runnerId, order: { voidedAt: null } },
    select: { orderId: true, order: { select: { status: true, runnerId: true } } },
    distinct: ['orderId'],
  })
  const collected = events.length
  const delivered = events.filter(e => e.order.status === 'DELIVERED' && e.order.runnerId === runnerId).length
  const rate = collected === 0 ? 1 : delivered / collected
  return { collected, delivered, rate }
}
