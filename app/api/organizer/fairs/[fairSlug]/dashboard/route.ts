import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { getRealtimeDb } from '@/lib/firebase-admin'
import { OrderStatus } from '@prisma/client'
import { IN_MODEL_ORDERS } from '@/lib/order-scope'

const LIVE_STATUSES: OrderStatus[] = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY']

async function getEventStats(eventId: string, todayStart: Date) {
  const [todayOrders, liveOrders, revenueAgg, feeAgg] = await Promise.all([
    db.order.count({
      where: { ...IN_MODEL_ORDERS, eventId, placedAt: { gte: todayStart } },
    }),
    db.order.count({
      where: { ...IN_MODEL_ORDERS, eventId, status: { in: LIVE_STATUSES } },
    }),
    db.order.aggregate({
      where: { ...IN_MODEL_ORDERS, eventId, placedAt: { gte: todayStart }, status: { not: OrderStatus.CANCELLED } },
      _sum: { total: true },
    }),
    db.order.aggregate({
      where: { ...IN_MODEL_ORDERS, eventId, placedAt: { gte: todayStart }, status: { not: OrderStatus.CANCELLED } },
      _sum: { fairSynqFee: true },
    }),
  ])
  return {
    ordersToday: todayOrders,
    liveOrders,
    revenueToday: parseFloat((revenueAgg._sum.total    ?? 0).toFixed(2)),
    platformFee:  parseFloat((feeAgg._sum.fairSynqFee  ?? 0).toFixed(2)),
  }
}

// GET /api/organizer/fairs/[fairSlug]/dashboard
// Returns live stats + vendor grid for the fair dashboard.
// Stats cached 30s; vendor heartbeats always fetched live from Firebase.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    const event = await db.event.findFirst({
      // Relation-heavy read (pulls vendors) → inline archivedAt rather than resolveOwnedFair.
      where: { urlSlug: fairSlug, organizerId, archivedAt: null },
      select: {
        id: true, name: true, urlSlug: true, status: true, isPaused: true,
        startDate: true, endDate: true,
        vendors: {
          orderBy: { name: 'asc' },
          select: {
            id: true, name: true, slug: true, cuisineType: true, boothNumber: true,
            status: true, isOffline: true, isBusy: true,
            stripeVerified: true, lastHeartbeatAt: true,
          },
        },
      },
    })
    if (!event) return apiError('Fair not found or access denied', 404, 'NOT_FOUND')

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayKey = todayStart.toISOString().slice(0, 10)

    // Cache stats aggregates 30s per fair-day
    const getCachedStats = unstable_cache(
      () => getEventStats(event.id, todayStart),
      [`org-dashboard-stats-${event.id}-${todayKey}`],
      { revalidate: 30, tags: [`event-stats-${event.id}`] }
    )
    const { ordersToday, liveOrders, revenueToday, platformFee } = await getCachedStats()

    // Per-vendor order count today via SQL groupBy — no JS reduce over all orders
    const vendorOrderGroups = await db.order.groupBy({
      by: ['vendorId'],
      where: {
        ...IN_MODEL_ORDERS,
        eventId: event.id,
        placedAt: { gte: todayStart },
        status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] },
      },
      _count: { id: true },
    })
    const vendorOrderCountMap: Record<string, number> = {}
    for (const g of vendorOrderGroups) {
      vendorOrderCountMap[g.vendorId] = g._count.id
    }

    // Firebase heartbeats — always live, skip cache
    const rtdb = getRealtimeDb()
    const heartbeats: Record<string, number> = {}
    if (rtdb) {
      try {
        const snap = await rtdb.ref(`fairs/${event.id}/heartbeats`).get()
        if (snap.exists()) Object.assign(heartbeats, snap.val() as Record<string, number>)
      } catch {
        // Firebase unavailable — heartbeats default to zero (disconnected)
      }
    }

    const now = Date.now()
    const vendorGrid = event.vendors.map(v => {
      const lastHeartbeat = heartbeats[v.id] ?? (v.lastHeartbeatAt ? v.lastHeartbeatAt.getTime() : 0)
      const connected = now - lastHeartbeat < 60_000
      return {
        id: v.id,
        name: v.name,
        slug: v.slug,
        cuisineType: v.cuisineType,
        boothNumber: v.boothNumber,
        status: v.status,
        isOffline: v.isOffline,
        isBusy: v.isBusy,
        stripeVerified: v.stripeVerified,
        connected,
        ordersToday: vendorOrderCountMap[v.id] ?? 0,
      }
    })

    const activeVendors = vendorGrid.filter(v => v.status === 'ACTIVE' && !v.isOffline).length

    // Recent orders (last 10, all vendors)
    const recentOrders = await db.order.findMany({
      where: { ...IN_MODEL_ORDERS, eventId: event.id, status: { notIn: ['PENDING_PAYMENT'] } },
      orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: {
        id: true, status: true, total: true, placedAt: true,
        customerName: true,
        vendor: { select: { id: true, name: true } },
        orderItems: {
          take: 3,
          select: { quantity: true, itemName: true },
        },
      },
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
        ordersToday,
        revenueToday,
        platformFee,
        activeVendors,
        totalVendors: event.vendors.length,
      },
      vendorGrid,
      recentOrders: recentOrders.map(o => ({
        id: o.id,
        status: o.status,
        total: o.total,
        placedAt: o.placedAt,
        customerName: o.customerName,
        vendorId: o.vendor.id,
        vendorName: o.vendor.name,
        itemSummary: o.orderItems.map(i => `${i.quantity}× ${i.itemName}`).join(', '),
      })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
