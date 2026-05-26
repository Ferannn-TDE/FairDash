import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'
import { getRealtimeDb } from '@/lib/firebase-admin'
import { OrderStatus } from '@prisma/client'

// GET /api/admin/events/[id]/dashboard
// Returns live event stats + vendor grid for the admin dashboard.
// Aggregate stats cached 30s per event — vendor heartbeats fetched live every request.

async function getEventStats(eventId: string, todayStart: Date) {
  const [todayOrders, liveOrders, totalRevenue, platformFee] = await Promise.all([
    db.order.count({
      where: { eventId, placedAt: { gte: todayStart } },
    }),
    db.order.count({
      where: {
        eventId,
        status: { in: [OrderStatus.PLACED, OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY] },
      },
    }),
    db.order.aggregate({
      where: { eventId, placedAt: { gte: todayStart }, status: { not: OrderStatus.CANCELLED } },
      _sum: { total: true },
    }),
    db.order.aggregate({
      where: { eventId, placedAt: { gte: todayStart }, status: { not: OrderStatus.CANCELLED } },
      _sum: { fairSynqFee: true },
    }),
  ])
  return { todayOrders, liveOrders, totalRevenue, platformFee }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminAuth()

    const { id } = await params

    const event = await db.event.findFirst({
      where: { OR: [{ id }, { urlSlug: id }] },
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

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    // Cache stats aggregates 30s — live orders and revenue don't need sub-second freshness
    const todayKey = todayStart.toISOString().slice(0, 10)
    const getCachedStats = unstable_cache(
      () => getEventStats(event.id, todayStart),
      [`event-dashboard-stats-${event.id}-${todayKey}`],
      { revalidate: 30, tags: [`event-stats-${event.id}`] }
    )
    const { todayOrders, liveOrders, totalRevenue, platformFee } = await getCachedStats()

    // Firebase heartbeats — always fetched live (sub-second latency matters here)
    const rtdb = getRealtimeDb()
    const heartbeats: Record<string, number> = {}
    if (rtdb) {
      try {
        const snap = await rtdb.ref(`fairs/${event.id}/heartbeats`).get()
        if (snap.exists()) Object.assign(heartbeats, snap.val() as Record<string, number>)
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
    const activeRunners = await db.runner.count({ where: { eventId: event.id, status: 'ACTIVE' } })

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
