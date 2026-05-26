import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'

// GET /api/organizer/fairs/[fairSlug]/vendors
// Returns vendors for a specific fair (organizer must own this fair).
// Revenue and order counts computed via SQL groupBy — no per-vendor JS reduce.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    const event = await db.event.findFirst({
      where: { urlSlug: fairSlug, organizerId },
      select: { id: true },
    })
    if (!event) return apiError('Fair not found or access denied', 404, 'NOT_FOUND')

    const vendors = await db.vendor.findMany({
      where: { eventId: event.id },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        status: true,
        cuisineType: true,
        boothNumber: true,
        createdAt: true,
      },
    })

    if (vendors.length === 0) return success({ vendors: [] })

    const vendorIds = vendors.map(v => v.id)

    // SQL aggregation: revenue (completed/delivered only) + total order count
    const [revenueGroups, countGroups] = await Promise.all([
      db.order.groupBy({
        by: ['vendorId'],
        where: {
          vendorId: { in: vendorIds },
          status: { in: ['COMPLETED', 'DELIVERED'] },
        },
        _sum: { vendorPayout: true },
      }),
      db.order.groupBy({
        by: ['vendorId'],
        where: {
          vendorId: { in: vendorIds },
          status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] },
        },
        _count: { id: true },
      }),
    ])

    const revenueMap = Object.fromEntries(revenueGroups.map(g => [g.vendorId, g._sum.vendorPayout ?? 0]))
    const countMap   = Object.fromEntries(countGroups.map(g => [g.vendorId, g._count.id]))

    const result = vendors.map(v => ({
      id: v.id,
      name: v.name,
      status: v.status,
      category: v.cuisineType,
      boothNumber: v.boothNumber,
      joinedAt: v.createdAt,
      orderCount: countMap[v.id] ?? 0,
      revenue: parseFloat((revenueMap[v.id] ?? 0).toFixed(2)),
    }))

    return success({ vendors: result })
  } catch (err) {
    return handleApiError(err)
  }
}
