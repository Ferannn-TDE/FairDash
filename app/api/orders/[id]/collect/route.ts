import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireRunnerAuth } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/ratelimit'
import { collectOrder } from '@/lib/collect-order'
import { logger } from '@/lib/logger'

// POST /api/orders/:id/collect  — Commit 2, U1
//
// The REAL "collect from vendor" action: the runner physically takes the bag. Delegates to
// lib/collectOrder — a single atomic + idempotent conditional update whose collectedAt stamp
// and `collected` custody event commit in ONE transaction. Keyed on collectedAt (a COLUMN),
// orthogonal to master status (the order stays RUNNER_COLLECTED). A double-tap or a retry
// after a lost-but-succeeded response is BENIGN (already_collected) — no second event.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const userId = await requireRunnerAuth()

    const { allowed, headers: rlHeaders } = await enforceRateLimit(`collect:${userId}`, 'vendorStatus')
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests — slow down.' }, { status: 429, headers: rlHeaders })
    }

    const dbUser = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } })
    if (!dbUser) return apiError('Forbidden — runner access required', 403, 'FORBIDDEN')
    const runner = await db.runner.findUnique({ where: { userId: dbUser.id }, select: { id: true, eventId: true } })
    if (!runner) return apiError('Forbidden — runner access required', 403, 'FORBIDDEN')

    const r = await collectOrder({ orderId: id, runnerId: runner.id, eventId: runner.eventId, actorId: userId })

    switch (r.outcome) {
      case 'collected':
        logger.info('[Collect] runner collected from vendor', { orderId: id, runnerId: runner.id })
        return success({ orderId: id, collected: true, alreadyCollected: false, collectedAt: r.collectedAt })
      case 'already_collected':
        return success({ orderId: id, collected: true, alreadyCollected: true, collectedAt: r.collectedAt })
      case 'not_found':
        return apiError('Order not found', 404, 'ORDER_NOT_FOUND')
      case 'wrong_event':
        return apiError('Access denied — not a runner for this event', 403, 'FORBIDDEN')
      case 'not_runner_order':
        return apiError('BOOTH_PICKUP orders are not collected by a runner', 409, 'INVALID_STATE')
      case 'not_your_delivery':
        return apiError('This delivery is assigned to another runner', 403, 'NOT_YOUR_DELIVERY')
      case 'not_collectable':
        return apiError(`Cannot collect an order in ${r.status}`, 409, 'INVALID_STATE')
    }
  } catch (err) {
    return handleApiError(err)
  }
}
