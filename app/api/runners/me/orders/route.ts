import { NextRequest } from 'next/server'
import { OrderStatus, FulfillmentType } from '@prisma/client'
import { db } from '@/lib/db'
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
      // Single order detail for the delivery page
      const order = await db.order.findFirst({
        where: {
          id: orderId,
          eventId: runner.eventId,
          fulfillmentType: { in: [FulfillmentType.HOME_DELIVERY, FulfillmentType.CURBSIDE] },
        },
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

    // List: READY (unassigned or this runner) + RUNNER_COLLECTED (this runner)
    const orders = await db.order.findMany({
      where: {
        eventId: runner.eventId,
        fulfillmentType: { in: [FulfillmentType.HOME_DELIVERY, FulfillmentType.CURBSIDE] },
        OR: [
          {
            status: OrderStatus.READY,
            OR: [{ runnerId: null }, { runnerId: runner.id }],
          },
          {
            status: OrderStatus.RUNNER_COLLECTED,
            runnerId: runner.id,
          },
        ],
      },
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
