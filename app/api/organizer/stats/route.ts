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

// GET /api/organizer/stats
// Returns aggregate stats across all fairs for the authenticated organizer
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

    const [totalOrders, totalVendors, revenueResult] = await Promise.all([
      db.order.count({ where: { eventId: { in: eventIds }, status: { in: PAID_STATUSES } } }),
      db.vendor.count({ where: { eventId: { in: eventIds } } }),
      db.order.aggregate({
        where: { eventId: { in: eventIds }, status: { in: ['COMPLETED', 'DELIVERED'] } },
        _sum: { vendorPayout: true },
      }),
    ])

    return success({
      activeFairs,
      totalOrders,
      totalRevenue: parseFloat((revenueResult._sum.vendorPayout ?? 0).toFixed(2)),
      totalVendors,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
