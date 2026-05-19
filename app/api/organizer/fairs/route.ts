import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { OrderStatus } from '@prisma/client'

const PAID_STATUSES: OrderStatus[] = [
  'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED',
  'COMPLETED', 'DELIVERED', 'CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE',
]
const ACTIVE_STATUSES: OrderStatus[] = ['PLACED', 'ACCEPTED', 'PREPARING']

// GET /api/organizer/fairs
// Returns all fairs for the authenticated organizer with per-fair stats
export async function GET(_req: NextRequest) {
  try {
    const clerkId = await requireAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const orgMember = await db.orgMember.findFirst({ where: { userId: dbUser.id } })
    if (!orgMember) return apiError('Not an organizer', 403, 'FORBIDDEN')

    const events = await db.event.findMany({
      where: { organizerId: orgMember.organizerId },
      orderBy: { startDate: 'desc' },
    })

    const fairs = await Promise.all(
      events.map(async (event) => {
        const [vendorCount, orderCount, pendingOrders, revenueResult] = await Promise.all([
          db.vendor.count({ where: { eventId: event.id } }),
          db.order.count({ where: { eventId: event.id, status: { in: PAID_STATUSES } } }),
          db.order.count({ where: { eventId: event.id, status: { in: ACTIVE_STATUSES } } }),
          db.order.aggregate({
            where: { eventId: event.id, status: { in: ['COMPLETED', 'DELIVERED'] } },
            _sum: { vendorPayout: true },
          }),
        ])

        return {
          id: event.id,
          name: event.name,
          slug: event.urlSlug,
          status: event.status,
          startDate: event.startDate,
          endDate: event.endDate,
          vendorCount,
          orderCount,
          totalRevenue: parseFloat((revenueResult._sum.vendorPayout ?? 0).toFixed(2)),
          pendingOrders,
        }
      })
    )

    return success({ fairs })
  } catch (err) {
    return handleApiError(err)
  }
}
