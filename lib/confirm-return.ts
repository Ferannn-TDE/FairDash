import { db } from './db'
import { OrderStatus } from '@prisma/client'

/**
 * POST-collection return, step 2 (Commit 2, U3) — the VENDOR confirms the food is physically
 * back in their possession, so the order returns to the pool. This is the missing vendor
 * transition from RUNNER_COLLECTED: the vendor's normal COMPLETED path is gated off for
 * runner-fulfilled orders (bf981f2), so this is its OWN action, keyed on returnRequestedAt —
 * never the VOS lanes (the vendor's VOS doesn't advance for runner-fulfilled orders anyway).
 *
 * ⚠️ ASSERTED REGRESSION (same as release, U2): writes status=READY EXPLICITLY — the monotonic
 * reconciler refuses RUNNER_COLLECTED→READY. Clears the whole custody lifecycle (runnerId,
 * dispatchedAt, collectedAt, returnRequestedAt) and stamps releasedAt, so the order is a fresh
 * unclaimed READY row a new runner can claim.
 *
 * ATOMIC + IDEMPOTENT: the contested guard is status=RUNNER_COLLECTED + returnRequestedAt NOT
 * NULL. A double-confirm (or a confirm racing the runner's own request) lands exactly once.
 */
export type ConfirmReturnOutcome =
  | { outcome: 'returned' }
  | { outcome: 'not_found' }
  | { outcome: 'not_on_order' } // the confirming vendor is not part of this order
  | { outcome: 'no_return_requested' } // nothing to confirm — the runner hasn't requested a return
  | { outcome: 'not_confirmable'; status: string }

export async function confirmReturn(input: {
  orderId: string
  vendorId: string
  actorId?: string | null
}): Promise<ConfirmReturnOutcome> {
  const { orderId, vendorId, actorId } = input

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, runnerId: true, returnRequestedAt: true },
  })
  if (!order) return { outcome: 'not_found' }

  // The confirming vendor must actually be on this order.
  const onOrder = await db.vendorOrderStatus.findUnique({
    where: { orderId_vendorId: { orderId, vendorId } },
    select: { orderId: true },
  })
  if (!onOrder) return { outcome: 'not_on_order' }

  if (!order.returnRequestedAt) return { outcome: 'no_return_requested' }
  if (order.status !== OrderStatus.RUNNER_COLLECTED) return { outcome: 'not_confirmable', status: order.status }

  // Capture the returning runner BEFORE nulling it — the custody trail records who handed it back.
  const returningRunnerId = order.runnerId

  const won = await db.$transaction(async tx => {
    const upd = await tx.order.updateMany({
      where: { id: order.id, status: OrderStatus.RUNNER_COLLECTED, returnRequestedAt: { not: null } },
      // Asserted regression to a fresh unclaimed READY row; clear the whole custody lifecycle.
      data: {
        status: OrderStatus.READY,
        runnerId: null,
        dispatchedAt: null,
        collectedAt: null,
        returnRequestedAt: null,
        releasedAt: new Date(),
      },
    })
    if (upd.count === 0) return false
    await tx.deliveryCustodyEvent.create({
      data: {
        orderId: order.id,
        eventType: 'return_confirmed',
        actorId: actorId ?? null,
        actorRole: 'vendor',
        runnerId: returningRunnerId, // denormalized — WHO handed it back
        metadata: { fromStatus: order.status, confirmedBy: vendorId, releasedTo: 'pool' },
      },
    })
    return true
  })

  if (won) return { outcome: 'returned' }

  // Lost the atomic flip (double-confirm / race) — re-read to answer honestly.
  const fresh = await db.order.findUnique({ where: { id: order.id }, select: { status: true } })
  return { outcome: 'not_confirmable', status: fresh?.status ?? 'UNKNOWN' }
}
