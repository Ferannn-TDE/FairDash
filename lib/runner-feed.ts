import { OrderStatus, FulfillmentType, Prisma } from '@prisma/client'

/**
 * The runner feed's ONE definition of "orders a runner may see" (list + single-order detail).
 * Exported so the ghost guard binds to the REAL predicate, never a drifting copy — the same
 * shape as vendorOrderScope/statusWhere for the vendor readers (incoming-divergence fix).
 *
 * `voidedAt: null` is load-bearing. The void floor (money/audit INCLUDES voided, operational
 * surfaces EXCLUDE them) was locked before the runner feed existed as a consumer, and the feed
 * never got the filter — so the first two delivery orders ever voided (#WVRDERFI, #8DBXU1FR)
 * kept appearing as an active delivery and a claimable order, and were actually claimed,
 * collected, and released as ghosts on 2026-07-21. The feed is operational: it excludes.
 */

const RUNNER_FULFILLMENT = { in: [FulfillmentType.HOME_DELIVERY, FulfillmentType.CURBSIDE] }

/** List: claimable READY (unassigned or mine) + my active RUNNER_COLLECTED. Never voided. */
export function runnerFeedWhere(eventId: string, runnerId: string): Prisma.OrderWhereInput {
  return {
    eventId,
    voidedAt: null,
    fulfillmentType: RUNNER_FULFILLMENT,
    OR: [
      { status: OrderStatus.READY, OR: [{ runnerId: null }, { runnerId }] },
      { status: OrderStatus.RUNNER_COLLECTED, runnerId },
    ],
  }
}

/**
 * Single-order detail: my own order (any status), or a still-claimable unassigned READY one.
 * Scoped to THIS runner (runner-boundary-proof) and never voided.
 */
export function runnerOrderDetailWhere(orderId: string, eventId: string, runnerId: string): Prisma.OrderWhereInput {
  return {
    id: orderId,
    eventId,
    voidedAt: null,
    fulfillmentType: RUNNER_FULFILLMENT,
    OR: [
      { runnerId },
      { status: OrderStatus.READY, runnerId: null },
    ],
  }
}
