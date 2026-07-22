import { db } from './db'
import { OrderStatus, FulfillmentType } from '@prisma/client'

/**
 * PRE-collection release (Commit 2, U2) — a runner who claimed an order but has NOT yet
 * collected it hands it back to the pool. Mirrors the collect/claim shape: one atomic
 * conditional updateMany + a custody event in ONE transaction.
 *
 * ⚠️ ASSERTED REGRESSION. The release writes status = READY EXPLICITLY. It cannot lean on the
 * derivation: canAdvance(RUNNER_COLLECTED → READY) is false (READY rank 4 < RUNNER_COLLECTED
 * rank 5) and WRITE_GUARD.READY excludes RUNNER_COLLECTED — the monotonic reconciler refuses to
 * regress a claimed order. So the release asserts the target state (same category as a cancel),
 * nulling runnerId/dispatchedAt so the order is a fresh unclaimed READY row a second runner can
 * claim, and stamping releasedAt (the runner feed re-arms off THIS, never readyAt).
 *
 * GATED PRE-collection only: `collectedAt IS NULL` is in the contested WHERE, so a COLLECTED
 * order can never be released here — the runner has the bag, and handing it back requires the
 * vendor-confirmed return path (U3). The same clause also makes a collect/release race safe:
 * whichever commits first, the other's updateMany matches zero rows.
 */
export type ReleaseOutcome =
  | { outcome: 'released' }
  | { outcome: 'not_found' }
  | { outcome: 'order_voided' } // voided = dead to all custody ops (ghost fix, 2026-07-21)
  | { outcome: 'wrong_event' }
  | { outcome: 'not_your_delivery' }
  | { outcome: 'already_collected' } // has the bag → must use the vendor-confirmed return (U3)
  | { outcome: 'not_releasable'; status: string }

export async function releaseOrder(input: {
  orderId: string
  runnerId: string
  eventId: string
  actorId?: string | null
  actorRole?: string // 'runner' (default) — an admin releasing a stranded order passes 'admin'
}): Promise<ReleaseOutcome> {
  const { orderId, runnerId, eventId, actorId, actorRole } = input

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, eventId: true, status: true, runnerId: true, collectedAt: true, fulfillmentType: true, voidedAt: true },
  })
  if (!order) return { outcome: 'not_found' }
  if (order.voidedAt) return { outcome: 'order_voided' }
  if (order.eventId !== eventId) return { outcome: 'wrong_event' }
  if (order.runnerId !== runnerId) return { outcome: 'not_your_delivery' }
  if (order.collectedAt) return { outcome: 'already_collected' }
  if (order.status !== OrderStatus.RUNNER_COLLECTED) return { outcome: 'not_releasable', status: order.status }

  const won = await db.$transaction(async tx => {
    const upd = await tx.order.updateMany({
      // `collectedAt: null` + `runnerId: me` + `status: RUNNER_COLLECTED` are the contested
      // guards — a concurrent collect (sets collectedAt) or a double-release matches zero here.
      where: { id: order.id, runnerId, status: OrderStatus.RUNNER_COLLECTED, collectedAt: null },
      // Asserted regression to a fresh unclaimed READY row + re-arm the window off releasedAt.
      // Clear the vehicle SNAPSHOT columns (a re-claimer re-snapshots); the runner's vehicle
      // is NOT lost — it stays in this claim's 'claimed' custody-event metadata.
      data: { status: OrderStatus.READY, runnerId: null, dispatchedAt: null, releasedAt: new Date(),
              runnerVehicleMake: null, runnerVehicleColor: null, runnerVehiclePlate: null },
    })
    if (upd.count === 0) return false
    await tx.deliveryCustodyEvent.create({
      data: {
        orderId: order.id,
        eventType: 'released',
        actorId: actorId ?? null,
        actorRole: actorRole ?? 'runner',
        runnerId, // denormalized — WHOSE claim was released, since Order.runnerId is now null
        metadata: { fromStatus: order.status, releasedTo: 'pool', ...(actorRole && actorRole !== 'runner' ? { by: actorRole } : {}) },
      },
    })
    return true
  })

  if (won) return { outcome: 'released' }

  // Lost the atomic flip — re-read to answer honestly (a concurrent collect, or a double-release).
  const fresh = await db.order.findUnique({ where: { id: order.id }, select: { status: true, collectedAt: true } })
  if (fresh?.collectedAt) return { outcome: 'already_collected' }
  return { outcome: 'not_releasable', status: fresh?.status ?? 'UNKNOWN' }
}

/**
 * Admin release of a stranded PRE-collection order (the CLAIMED_NOT_COLLECTED handle, U5). The
 * admin isn't the assigned runner, so this reads the order's current runnerId and releases on
 * its behalf — attributed to the admin in the custody trail. Same atomic, pre-collection-gated
 * core; a COLLECTED order still refuses (that's the deliberate-refund path, not a release).
 */
export async function adminReleaseStranded(input: { orderId: string; eventId: string; actorId: string }): Promise<ReleaseOutcome> {
  const order = await db.order.findUnique({ where: { id: input.orderId }, select: { runnerId: true } })
  if (!order?.runnerId) return { outcome: 'not_your_delivery' } // no assigned runner to release
  return releaseOrder({ orderId: input.orderId, runnerId: order.runnerId, eventId: input.eventId, actorId: input.actorId, actorRole: 'admin' })
}
