import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { runnerFeedWhere, runnerOrderDetailWhere } from '@/lib/runner-feed'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/runners/me/orders
// Returns delivery-eligible orders for the authenticated runner's event.
// Includes:
//   - READY orders (HOME_DELIVERY or CURBSIDE) with no runner assigned, or assigned to this runner
//   - RUNNER_COLLECTED orders assigned to this runner (active delivery)
// Query params:
//   ?orderId=<id>  — fetch a single order by ID (must belong to this runner's event)

export async function GET(req: NextRequest) {
  try {
    const clerkId = await requireAuth()
    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    const runner = await db.runner.findUnique({ where: { userId: dbUser.id } })
    if (!runner) return apiError('No runner record found', 404, 'RUNNER_NOT_FOUND')

    const { searchParams } = new URL(req.url)
    const orderId = searchParams.get('orderId')

    if (orderId) {
      // Single order detail for the delivery page. Scoped to THIS runner: their own
      // order (any status), or a still-claimable unassigned READY one they may preview
      // before claiming. This mirrors the list scoping below — without it, any runner in
      // the fair could read another runner's active-delivery detail (customer name,
      // phone, address) by passing its orderId. (Proven by scripts/runner-boundary-proof.ts.)
      // The WHERE lives in lib/runner-feed (voidedAt: null included) — the ghost guard
      // binds to that predicate, so this route and the guard cannot diverge.
      const order = await db.order.findFirst({
        where: runnerOrderDetailWhere(orderId, runner.eventId, runner.id),
        include: {
          vendor: { select: { name: true, boothNumber: true } },
          orderItems: {
            include: { menuItem: { select: { name: true, imageUrl: true } } },
          },
        },
      })

      if (!order) return apiError('Order not found', 404, 'ORDER_NOT_FOUND')
      return success({ order })
    }

    // List: READY (unassigned or this runner) + RUNNER_COLLECTED (this runner).
    // Shared predicate from lib/runner-feed — includes voidedAt: null (ghost fix).
    const orders = await db.order.findMany({
      where: runnerFeedWhere(runner.eventId, runner.id),
      orderBy: { readyAt: 'asc' },
      include: {
        vendor: { select: { name: true, boothNumber: true } },
        orderItems: {
          include: { menuItem: { select: { name: true } } },
        },
      },
    })

    return success({ orders, runnerId: runner.id })
  } catch (err) {
    return handleApiError(err)
  }
}
