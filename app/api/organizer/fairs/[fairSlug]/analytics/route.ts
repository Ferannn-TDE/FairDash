import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { getRealtimeDb } from '@/lib/firebase-admin'
import { OrderStatus } from '@prisma/client'

// ── Cached sub-queries ───────────────────────────────────────────────────────

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

// ── GET /api/organizer/fairs/[fairSlug]/analytics ────────────────────────────
// Live stats + vendor grid for the organizer analytics overview tab.
// All-time summary metrics are 60s cached; heartbeats always live.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    const event = await db.event.findFirst({
      where: { urlSlug: fairSlug, organizerId },
      select: {
        id: true, name: true, urlSlug: true, status: true, isPaused: true,
        startDate: true, endDate: true,
        vendors: {
          select: {
            id: true, name: true, cuisineType: true, boothNumber: true,
            status: true, isOffline: true, isBusy: true, lastHeartbeatAt: true,
          },
        },
      },
    })
    if (!event) return apiError('Fair not found or access denied', 404, 'NOT_FOUND')

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const todayKey = todayStart.toISOString().slice(0, 10)
    const getCachedStats = unstable_cache(
      () => getEventStats(event.id, todayStart),
      [`organizer-analytics-${event.id}-${todayKey}`],
      { revalidate: 30, tags: [`event-stats-${event.id}`] }
    )

    // All-time summary (cached 60s)
    const getCachedSummary = unstable_cache(
      async () => {
        const [allTime, statusBreakdown, vendorRevenue] = await Promise.all([
          db.order.aggregate({
            where: {
              eventId: event.id,
              status: { in: [OrderStatus.COMPLETED, OrderStatus.DELIVERED] },
            },
            _sum: { subtotal: true },
            _count: { id: true },
          }),
          db.order.groupBy({
            by: ['status'],
            where: { eventId: event.id },
            _count: { id: true },
          }),
          db.order.groupBy({
            by: ['vendorId'],
            where: {
              eventId: event.id,
              status: { in: [OrderStatus.COMPLETED, OrderStatus.DELIVERED] },
            },
            _sum: { subtotal: true },
            _count: { id: true },
          }),
        ])
        return { allTime, statusBreakdown, vendorRevenue }
      },
      [`fair-analytics-summary-${event.id}`],
      { revalidate: 60, tags: [`fair-analytics-${event.id}`] }
    )

    const [
      { todayOrders, liveOrders, totalRevenue, platformFee },
      { allTime, statusBreakdown, vendorRevenue },
    ] = await Promise.all([getCachedStats(), getCachedSummary()])

    // Per-vendor today metrics (not cached — needed for grid freshness)
    const [vendorOrderCounts, vendorRevenueToday] = await Promise.all([
      db.order.groupBy({
        by: ['vendorId'],
        where: {
          eventId: event.id,
          placedAt: { gte: todayStart },
          status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] },
        },
        _count: { id: true },
      }),
      db.order.groupBy({
        by: ['vendorId'],
        where: {
          eventId: event.id,
          placedAt: { gte: todayStart },
          status: { in: [OrderStatus.COMPLETED, OrderStatus.DELIVERED] },
        },
        _sum: { subtotal: true },
      }),
    ])

    const orderCountMap  = Object.fromEntries(vendorOrderCounts.map(g => [g.vendorId, g._count.id]))
    const revTodayMap    = Object.fromEntries(vendorRevenueToday.map(g => [g.vendorId, g._sum.subtotal ?? 0]))
    const allTimeRevMap  = Object.fromEntries(vendorRevenue.map(g => [g.vendorId, { rev: g._sum.subtotal ?? 0, count: g._count.id }]))

    // Firebase heartbeats
    const rtdb = getRealtimeDb()
    const heartbeats: Record<string, number> = {}
    if (rtdb) {
      try {
        const snap = await rtdb.ref(`fairs/${event.id}/heartbeats`).get()
        if (snap.exists()) Object.assign(heartbeats, snap.val() as Record<string, number>)
      } catch { /* Firebase unavailable */ }
    }

    const now = Date.now()
    const vendorGrid = event.vendors.map(v => {
      const lastHeartbeat = heartbeats[v.id] ?? (v.lastHeartbeatAt ? v.lastHeartbeatAt.getTime() : 0)
      return {
        id: v.id,
        name: v.name,
        cuisineType: v.cuisineType,
        boothNumber: v.boothNumber,
        status: v.status,
        isOffline: v.isOffline,
        isBusy: v.isBusy,
        connectionStatus: now - lastHeartbeat < 60_000 ? 'CONNECTED' : 'DISCONNECTED',
        ordersToday:  orderCountMap[v.id] ?? 0,
        revenueToday: parseFloat((revTodayMap[v.id] ?? 0).toFixed(2)),
        allTimeRevenue: parseFloat((allTimeRevMap[v.id]?.rev ?? 0).toFixed(2)),
        allTimeOrders:   allTimeRevMap[v.id]?.count ?? 0,
      }
    })

    // Completion rate from status breakdown
    const statusMap = Object.fromEntries(statusBreakdown.map(g => [g.status, g._count.id]))
    const completedCount = (statusMap.COMPLETED ?? 0) + (statusMap.DELIVERED ?? 0)
    const totalAttempted = Object.values(statusMap).reduce((s, c) => s + c, 0) - (statusMap.PENDING_PAYMENT ?? 0)
    const completionRate = totalAttempted > 0 ? (completedCount / totalAttempted) * 100 : 0

    const totalOrders  = allTime._count.id
    const totalRev     = allTime._sum.subtotal ?? 0
    const avgOrderValue = totalOrders > 0 ? totalRev / totalOrders : 0

    return success({
      stats: {
        liveOrders,
        ordersToday: todayOrders,
        revenueToday: parseFloat((totalRevenue._sum.total ?? 0).toFixed(2)),
        platformFeeToday: parseFloat((platformFee._sum.fairSynqFee ?? 0).toFixed(2)),
        activeVendors: event.vendors.filter(v => v.status === 'ACTIVE' && !v.isOffline).length,
        totalVendors: event.vendors.length,
        // All-time
        totalRevenue: parseFloat(totalRev.toFixed(2)),
        totalOrders,
        avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
        completionRate: parseFloat(completionRate.toFixed(1)),
      },
      vendorGrid,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
