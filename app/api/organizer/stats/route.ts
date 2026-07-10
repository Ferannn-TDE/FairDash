import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { ACTIVE_VENDOR_WHERE } from '@/lib/vendor-queries'

async function computeOrganizerStats(organizerId: string) {
  const events = await db.event.findMany({
    where: { organizerId, archivedAt: null },
    select: { id: true, status: true },
  })

  const eventIds = events.map(e => e.id)
  const activeFairs = events.filter(e => e.status === 'ACTIVE').length

  if (eventIds.length === 0) {
    return { activeFairs: 0, totalOrders: 0, ordersToday: 0, totalRevenue: 0, totalVendors: 0 }
  }

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const baseWhere = {
    eventId: { in: eventIds },
    status: { notIn: ['PENDING_PAYMENT' as const] },
  }

  const [totalVendors, totalOrderCount, revenueAgg, ordersToday] = await Promise.all([
    db.vendor.count({ where: { eventId: { in: eventIds }, ...ACTIVE_VENDOR_WHERE } }),
    db.order.count({ where: baseWhere }),
    db.order.aggregate({
      where: { ...baseWhere, status: { notIn: ['PENDING_PAYMENT' as const, 'CANCELLED' as const] } },
      _sum: { subtotal: true },
    }),
    db.order.count({ where: { ...baseWhere, createdAt: { gte: todayStart } } }),
  ])

  const totalRevenue = parseFloat((revenueAgg._sum.subtotal ?? 0).toFixed(2))

  return { activeFairs, totalOrders: totalOrderCount, ordersToday, totalRevenue, totalVendors }
}

// GET /api/organizer/stats
// Aggregate stats across all fairs for the authenticated organizer.
// Cached 30s per organizer — all revenue via SQL aggregate, no JS reduction.
export async function GET(_req: NextRequest) {
  try {
    const { organizerId } = await requireOrganizerAuth()

    const cached = unstable_cache(
      () => computeOrganizerStats(organizerId),
      [`organizer-stats-${organizerId}`],
      { revalidate: 30, tags: [`organizer-stats-${organizerId}`] }
    )

    return success(await cached())
  } catch (err) {
    return handleApiError(err)
  }
}
