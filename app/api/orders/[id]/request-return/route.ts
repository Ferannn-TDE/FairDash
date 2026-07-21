import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireRunnerAuth } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/ratelimit'
import { requestReturn } from '@/lib/request-return'
import { logger } from '@/lib/logger'

// POST /api/orders/:id/request-return  — Commit 2, U3 (runner side)
//
// A runner who has COLLECTED the food but can't deliver asks to hand it back to the vendor.
// Stamps returnRequestedAt (the "return in progress" flag) — does NOT move the order; the
// runner still has the bag until the VENDOR confirms (POST /confirm-return). Idempotent: a
// second tap is a benign already_requested. Pre-collection orders are refused (use /release).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const userId = await requireRunnerAuth()

    const { allowed, headers: rlHeaders } = await enforceRateLimit(`request-return:${userId}`, 'vendorStatus')
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests — slow down.' }, { status: 429, headers: rlHeaders })
    }

    const dbUser = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } })
    if (!dbUser) return apiError('Forbidden — runner access required', 403, 'FORBIDDEN')
    const runner = await db.runner.findUnique({ where: { userId: dbUser.id }, select: { id: true, eventId: true } })
    if (!runner) return apiError('Forbidden — runner access required', 403, 'FORBIDDEN')

    const r = await requestReturn({ orderId: id, runnerId: runner.id, eventId: runner.eventId, actorId: userId })

    switch (r.outcome) {
      case 'return_requested':
        logger.info('[RequestReturn] runner requested a post-collection return', { orderId: id, runnerId: runner.id })
        return success({ orderId: id, returnRequested: true, alreadyRequested: false, returnRequestedAt: r.returnRequestedAt })
      case 'already_requested':
        return success({ orderId: id, returnRequested: true, alreadyRequested: true, returnRequestedAt: r.returnRequestedAt })
      case 'not_found':
        return apiError('Order not found', 404, 'ORDER_NOT_FOUND')
      case 'wrong_event':
        return apiError('Access denied — not a runner for this event', 403, 'FORBIDDEN')
      case 'not_your_delivery':
        return apiError('This delivery is assigned to another runner', 403, 'NOT_YOUR_DELIVERY')
      case 'not_collected':
        return apiError('You have not collected this order — release it back to the pool instead', 409, 'NOT_COLLECTED')
      case 'not_returnable':
        return apiError(`Cannot request a return for an order in ${r.status}`, 409, 'INVALID_STATE')
    }
  } catch (err) {
    return handleApiError(err)
  }
}
