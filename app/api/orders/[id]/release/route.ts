import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireRunnerAuth } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/ratelimit'
import { releaseOrder } from '@/lib/release-order'
import { logger } from '@/lib/logger'

// POST /api/orders/:id/release  — Commit 2, U2
//
// PRE-collection release: a runner hands a CLAIMED-but-NOT-collected order back to the pool.
// Delegates to lib/releaseOrder — one atomic conditional updateMany (gated collectedAt IS NULL)
// that asserts status=READY + nulls runnerId/dispatchedAt + stamps releasedAt, and writes a
// `released` custody event, in one transaction. A collected order is refused here (that needs
// the vendor-confirmed return, U3).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const userId = await requireRunnerAuth()

    const { allowed, headers: rlHeaders } = await enforceRateLimit(`release:${userId}`, 'vendorStatus')
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests — slow down.' }, { status: 429, headers: rlHeaders })
    }

    const dbUser = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } })
    if (!dbUser) return apiError('Forbidden — runner access required', 403, 'FORBIDDEN')
    const runner = await db.runner.findUnique({ where: { userId: dbUser.id }, select: { id: true, eventId: true } })
    if (!runner) return apiError('Forbidden — runner access required', 403, 'FORBIDDEN')

    const r = await releaseOrder({ orderId: id, runnerId: runner.id, eventId: runner.eventId, actorId: userId })

    switch (r.outcome) {
      case 'released':
        logger.info('[Release] runner released a pre-collection order to the pool', { orderId: id, runnerId: runner.id })
        return success({ orderId: id, released: true })
      case 'not_found':
        return apiError('Order not found', 404, 'ORDER_NOT_FOUND')
      case 'order_voided':
        return apiError('This order was voided by an admin', 409, 'ORDER_VOIDED')
      case 'wrong_event':
        return apiError('Access denied — not a runner for this event', 403, 'FORBIDDEN')
      case 'not_your_delivery':
        return apiError('This delivery is assigned to another runner', 403, 'NOT_YOUR_DELIVERY')
      case 'already_collected':
        return apiError('You have already collected this order — request a return instead', 409, 'ALREADY_COLLECTED')
      case 'not_releasable':
        return apiError(`Cannot release an order in ${r.status}`, 409, 'INVALID_STATE')
    }
  } catch (err) {
    return handleApiError(err)
  }
}
