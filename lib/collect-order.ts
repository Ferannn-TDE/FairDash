import { db } from './db'
import { OrderStatus, FulfillmentType } from '@prisma/client'

/**
 * The "collect from vendor" core (Commit 2, U1) — the runner physically takes the bag.
 * Extracted from the route so the guard exercises the REAL atomic + idempotent path, not a
 * copy (mirrors classifyVendorSlice in the double-pay fix).
 *
 * ATOMIC + IDEMPOTENT: the write is a single conditional updateMany
 *   WHERE id, runnerId = me, status = RUNNER_COLLECTED, collectedAt IS NULL,
 * and the collectedAt stamp + the `collected` DeliveryCustodyEvent commit in ONE transaction
 * (field and audit-spine row together, or neither). A double-tap or a retry after a
 * lost-but-succeeded response returns `already_collected` — no second stamp, no second event.
 */
export type CollectOutcome =
  | { outcome: 'collected'; collectedAt: Date }
  | { outcome: 'already_collected'; collectedAt: Date | null }
  | { outcome: 'not_found' }
  | { outcome: 'wrong_event' }
  | { outcome: 'not_runner_order' } // BOOTH_PICKUP is not runner-collected
  | { outcome: 'not_your_delivery' }
  | { outcome: 'not_collectable'; status: string }

export async function collectOrder(input: {
  orderId: string
  runnerId: string
  eventId: string
  actorId?: string | null
}): Promise<CollectOutcome> {
  const { orderId, runnerId, eventId, actorId } = input

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, eventId: true, status: true, runnerId: true, collectedAt: true, fulfillmentType: true },
  })
  if (!order) return { outcome: 'not_found' }
  if (order.eventId !== eventId) return { outcome: 'wrong_event' }
  if (order.fulfillmentType === FulfillmentType.BOOTH_PICKUP) return { outcome: 'not_runner_order' }
  if (order.runnerId !== runnerId) return { outcome: 'not_your_delivery' }

  // Idempotent fast-path: already collected (the lost-response retry / double-tap). Benign.
  if (order.collectedAt) return { outcome: 'already_collected', collectedAt: order.collectedAt }
  // A released (→ READY) or already-delivered order is not collectable here.
  if (order.status !== OrderStatus.RUNNER_COLLECTED) return { outcome: 'not_collectable', status: order.status }

  const collectedAt = new Date()
  const won = await db.$transaction(async tx => {
    const upd = await tx.order.updateMany({
      // `collectedAt: null` is the contested guard — exactly one concurrent call flips it.
      where: { id: order.id, runnerId, status: OrderStatus.RUNNER_COLLECTED, collectedAt: null },
      data: { collectedAt },
    })
    if (upd.count === 0) return false // a concurrent retry won the flip
    await tx.deliveryCustodyEvent.create({
      data: {
        orderId: order.id,
        eventType: 'collected',
        actorId: actorId ?? null,
        actorRole: 'runner',
        runnerId,
        metadata: { fromStatus: order.status },
      },
    })
    return true
  })

  if (won) return { outcome: 'collected', collectedAt }

  // Lost the atomic flip to a concurrent retry → it is now collected. Benign, no second event.
  const fresh = await db.order.findUnique({ where: { id: order.id }, select: { collectedAt: true } })
  return { outcome: 'already_collected', collectedAt: fresh?.collectedAt ?? null }
}
