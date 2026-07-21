import { db } from './db'
import { OrderStatus } from '@prisma/client'

/**
 * POST-collection return, step 1 (Commit 2, U3) — a runner who has ALREADY COLLECTED the food
 * but can't deliver signals intent to hand it back to the vendor. This does NOT move the order:
 * the runner still physically has the bag, so status stays RUNNER_COLLECTED and runnerId stays
 * set. It only stamps returnRequestedAt (the "return in progress" flag) + a custody event. The
 * order returns to the pool only when the VENDOR confirms possession (confirmReturn, step 2).
 *
 * Why not just release (U2)? Release is PRE-collection (food still on the counter). Once
 * collected, a blind release would be a phantom hand-back — the pool would show an order whose
 * food is in a runner's car. So the collected path requires a human (vendor) to confirm the food
 * is actually back before it's re-offered.
 *
 * ATOMIC + IDEMPOTENT, same shape as collect/release: the contested guard is
 *   returnRequestedAt IS NULL (+ collectedAt IS NOT NULL + runnerId = me). A double-tap returns
 * already_requested — no second stamp, no second event.
 */
export type RequestReturnOutcome =
  | { outcome: 'return_requested'; returnRequestedAt: Date }
  | { outcome: 'already_requested'; returnRequestedAt: Date | null }
  | { outcome: 'not_found' }
  | { outcome: 'order_voided' } // voided = dead to all custody ops (ghost fix, 2026-07-21)
  | { outcome: 'wrong_event' }
  | { outcome: 'not_your_delivery' }
  | { outcome: 'not_collected' } // no bag yet → that's a release (U2), not a return
  | { outcome: 'not_returnable'; status: string }

export async function requestReturn(input: {
  orderId: string
  runnerId: string
  eventId: string
  actorId?: string | null
}): Promise<RequestReturnOutcome> {
  const { orderId, runnerId, eventId, actorId } = input

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, eventId: true, status: true, runnerId: true, collectedAt: true, returnRequestedAt: true, voidedAt: true },
  })
  if (!order) return { outcome: 'not_found' }
  if (order.voidedAt) return { outcome: 'order_voided' }
  if (order.eventId !== eventId) return { outcome: 'wrong_event' }
  if (order.runnerId !== runnerId) return { outcome: 'not_your_delivery' }
  if (!order.collectedAt) return { outcome: 'not_collected' }
  if (order.status !== OrderStatus.RUNNER_COLLECTED) return { outcome: 'not_returnable', status: order.status }
  if (order.returnRequestedAt) return { outcome: 'already_requested', returnRequestedAt: order.returnRequestedAt }

  const returnRequestedAt = new Date()
  const won = await db.$transaction(async tx => {
    const upd = await tx.order.updateMany({
      where: { id: order.id, runnerId, status: OrderStatus.RUNNER_COLLECTED, collectedAt: { not: null }, returnRequestedAt: null },
      data: { returnRequestedAt },
    })
    if (upd.count === 0) return false
    await tx.deliveryCustodyEvent.create({
      data: {
        orderId: order.id,
        eventType: 'return_requested',
        actorId: actorId ?? null,
        actorRole: 'runner',
        runnerId,
        metadata: { fromStatus: order.status },
      },
    })
    return true
  })

  if (won) return { outcome: 'return_requested', returnRequestedAt }

  const fresh = await db.order.findUnique({ where: { id: order.id }, select: { returnRequestedAt: true } })
  return { outcome: 'already_requested', returnRequestedAt: fresh?.returnRequestedAt ?? null }
}
