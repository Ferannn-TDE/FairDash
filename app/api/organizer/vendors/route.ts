import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/organizer/vendors
// Returns all vendors across all events for the authenticated organizer,
// with per-vendor order count and revenue derived from OrderItem rows.
export async function GET(_req: NextRequest) {
  try {
    const clerkId = await requireAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('Forbidden', 403, 'FORBIDDEN')

    const orgMember = await db.orgMember.findFirst({ where: { userId: dbUser.id } })
    if (!orgMember) return apiError('Forbidden', 403, 'FORBIDDEN')

    const events = await db.event.findMany({
      where: { organizerId: orgMember.organizerId },
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

    const vendorIds = vendors.map(v => v.id)

    // Revenue: sum OrderItem rows for these vendors, excluding cancelled orders
    const items = await db.orderItem.findMany({
      where: {
        vendorId: { in: vendorIds },
        order: { status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] } },
      },
      select: { vendorId: true, unitPrice: true, quantity: true, orderId: true },
    })

    // Aggregate per vendor: unique order count + revenue
    const statsMap: Record<string, { orderIds: Set<string>; revenue: number }> = {}
    for (const item of items) {
      if (!statsMap[item.vendorId]) statsMap[item.vendorId] = { orderIds: new Set(), revenue: 0 }
      statsMap[item.vendorId].orderIds.add(item.orderId)
      statsMap[item.vendorId].revenue += item.unitPrice * item.quantity
    }

    const data = vendors.map(v => ({
      id: v.id,
      name: v.name,
      cuisineType: v.cuisineType,
      boothNumber: v.boothNumber,
      isOffline: v.isOffline,
      status: v.status,
      fairName: eventNameMap[v.eventId] ?? '',
      orderCount: statsMap[v.id]?.orderIds.size ?? 0,
      revenue: parseFloat((statsMap[v.id]?.revenue ?? 0).toFixed(2)),
    }))

    return success(data)
  } catch (err) {
    return handleApiError(err)
  }
}
