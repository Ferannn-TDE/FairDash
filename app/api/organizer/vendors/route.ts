import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { IN_MODEL_ORDERS } from '@/lib/order-scope'

// GET /api/organizer/vendors
// Returns all vendors across all events for the authenticated organizer,
// with per-vendor order count and revenue via SQL groupBy.
export async function GET(_req: NextRequest) {
  try {
    const { organizerId } = await requireOrganizerAuth()

    const events = await db.event.findMany({
      where: { organizerId, archivedAt: null },
      select: { id: true, name: true },
    })
    const eventIds = events.map(e => e.id)
    const eventNameMap = Object.fromEntries(events.map(e => [e.id, e.name]))

    if (eventIds.length === 0) return success([])

    const vendors = await db.vendor.findMany({
      where: { eventId: { in: eventIds } },
      select: {
        id: true,
        name: true,
        cuisineType: true,
        boothNumber: true,
        isOffline: true,
        status: true,
        eventId: true,
      },
      orderBy: { name: 'asc' },
    })

    if (vendors.length === 0) return success([])

    const vendorIds = vendors.map(v => v.id)

    // SQL aggregation via groupBy — no full OrderItem scan in JS
    const [revenueGroups, countGroups] = await Promise.all([
      db.order.groupBy({
        by: ['vendorId'],
        where: {
          ...IN_MODEL_ORDERS,
          vendorId: { in: vendorIds },
          status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] },
        },
        _sum: { subtotal: true },
      }),
      db.order.groupBy({
        by: ['vendorId'],
        where: {
          ...IN_MODEL_ORDERS,
          vendorId: { in: vendorIds },
          status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] },
        },
        _count: { id: true },
      }),
    ])

    const revenueMap = Object.fromEntries(revenueGroups.map(g => [g.vendorId, g._sum.subtotal ?? 0]))
    const countMap   = Object.fromEntries(countGroups.map(g => [g.vendorId, g._count.id]))

    const data = vendors.map(v => ({
      id: v.id,
      name: v.name,
      cuisineType: v.cuisineType,
      boothNumber: v.boothNumber,
      isOffline: v.isOffline,
      status: v.status,
      fairName: eventNameMap[v.eventId] ?? '',
      orderCount: countMap[v.id] ?? 0,
      revenue: parseFloat((revenueMap[v.id] ?? 0).toFixed(2)),
    }))

    return success(data)
  } catch (err) {
    return handleApiError(err)
  }
}
