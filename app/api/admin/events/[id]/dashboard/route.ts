import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'
import { getRealtimeDb } from '@/lib/firebase-admin'
import { OrderStatus } from '@prisma/client'

// GET /api/admin/events/[id]/dashboard
// Returns live event stats + vendor grid for the admin dashboard.
// Requires admin or event_operator role.

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdminAuth()

    // Accept both UUID and urlSlug so admin/organizer pages can pass either
    const event = await db.event.findFirst({
      where: { OR: [{ id: params.id }, { urlSlug: params.id }] },
      select: {
        id: true, name: true, urlSlug: true, status: true, isPaused: true,
        eventLat: true, eventLng: true, startDate: true, endDate: true,
        vendors: {
          select: {
            id: true, name: true, cuisineType: true, boothNumber: true,
            status: true, isOffline: true, isBusy: true,
            stripeVerified: true, lastHeartbeatAt: true,
          },
        },
      },
    })

    if (!event) throw new ApiError('Event not found', 404, 'EVENT_NOT_FOUND')

    // Aggregate today's orders
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [todayOrders, liveOrders, totalRevenue, platformFee] = await Promise.all([
      db.order.count({
        where: { eventId: params.id, placedAt: { gte: todayStart } },
      }),
      db.order.count({
        where: {
          eventId: params.id,
          status: { in: [OrderStatus.PLACED, OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY] },
        },
      }),
      db.order.aggregate({
        where: { eventId: params.id, placedAt: { gte: todayStart }, status: { not: OrderStatus.CANCELLED } },
        _sum: { total: true },
      }),
      db.order.aggregate({
        where: { eventId: params.id, placedAt: { gte: todayStart }, status: { not: OrderStatus.CANCELLED } },
        _sum: { fairSynqFee: true },
      }),
    ])

    // Firebase heartbeats — check which vendors are truly connected
    const rtdb = getRealtimeDb()
    const heartbeats: Record<string, number> = {}

    if (rtdb) {
      try {
        const snap = await rtdb.ref(`fairs/${params.id}/heartbeats`).get()
        if (snap.exists()) {
          const data = snap.val() as Record<string, number>
          Object.assign(heartbeats, data)
        }
      } catch {
        // Firebase unavailable — heartbeats default to disconnected
      }
    }

    const now = Date.now()
    const vendorGrid = event.vendors.map(v => {
      const lastHeartbeat = heartbeats[v.id] ?? (v.lastHeartbeatAt ? v.lastHeartbeatAt.getTime() : 0)
      const connected = now - lastHeartbeat < 60_000
      const liveStatus = v.isOffline ? 'OFFLINE' : v.isBusy ? 'BUSY' : v.status
      return { ...v, lastHeartbeat, connectionStatus: connected ? 'CONNECTED' : 'DISCONNECTED', liveStatus }
    })

    const activeVendors = event.vendors.filter(v => v.status === 'ACTIVE' && !v.isOffline).length
    const activeRunners = await db.runner.count({
      where: { eventId: params.id, status: 'ACTIVE' },
    })

    return success({
      event: {
        id: event.id,
        name: event.name,
        urlSlug: event.urlSlug,
        status: event.status,
        isPaused: event.isPaused,
        startDate: event.startDate,
        endDate: event.endDate,
      },
      stats: {
        liveOrders,
        ordersToday: todayOrders,
        revenueToday: totalRevenue._sum.total ?? 0,
        platformFeeToday: platformFee._sum.fairSynqFee ?? 0,
        activeVendors,
        totalVendors: event.vendors.length,
        activeRunners,
      },
      vendorGrid,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
