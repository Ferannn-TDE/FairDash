import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/organizer/stats
// Aggregate stats across all fairs for the authenticated organizer.
// Revenue = sum of OrderItem unit prices (not vendorPayout) so multi-vendor
// orders split correctly and cancelled items are excluded.
export async function GET(_req: NextRequest) {
  try {
    const clerkId = await requireAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const orgMember = await db.orgMember.findFirst({ where: { userId: dbUser.id } })
    if (!orgMember) return apiError('Not an organizer', 403, 'FORBIDDEN')

    const events = await db.event.findMany({
      where: { organizerId: orgMember.organizerId },
      select: { id: true, status: true },
    })

    const eventIds = events.map(e => e.id)
    const activeFairs = events.filter(e => e.status === 'ACTIVE').length

    if (eventIds.length === 0) {
      return success({ activeFairs: 0, totalOrders: 0, totalRevenue: 0, totalVendors: 0 })
    }

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const orderWhere = {
      eventId: { in: eventIds },
      status: { notIn: ['PENDING_PAYMENT' as const] },
    }

    const [totalVendors, orderRows, ordersToday] = await Promise.all([
      db.vendor.count({ where: { eventId: { in: eventIds } } }),
      db.order.findMany({
        where: orderWhere,
        select: { id: true, status: true, subtotal: true },
      }),
      db.order.count({
        where: { ...orderWhere, createdAt: { gte: todayStart } },
      }),
    ])

    // Include CANCELLED in counts (they happened, they count for history)
    const countableOrders = orderRows
    const totalOrders = countableOrders.length
    const totalRevenue = parseFloat(
      countableOrders
        .filter(o => o.status !== 'CANCELLED')
        .reduce((s, o) => s + o.subtotal, 0)
        .toFixed(2)
    )

    return success({ activeFairs, totalOrders, ordersToday, totalRevenue, totalVendors })
  } catch (err) {
    return handleApiError(err)
  }
}
