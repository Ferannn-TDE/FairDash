import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { getGoLiveChecklist } from '@/lib/go-live-checklist'
import { boundedHeartbeatRead } from '@/lib/heartbeat-read'
import { OrderStatus } from '@prisma/client'

// GET /api/admin/events/[id]/dashboard
// Returns live event stats + vendor grid for the admin dashboard.
// Aggregate stats cached 30s per event — vendor heartbeats fetched live every request.

async function getEventStats(eventId: string, todayStart: Date) {
  // voidedAt: null on every aggregate — voided orders (test junk) must not inflate
  // live counts or revenue. Mirrors the reconciler/payout filters.
  const [todayOrders, liveOrders, totalRevenue, platformFee] = await Promise.all([
    db.order.count({
      where: { eventId, voidedAt: null, placedAt: { gte: todayStart } },
    }),
    db.order.count({
      where: {
        eventId,
        voidedAt: null,
        status: { in: [OrderStatus.PLACED, OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY] },
      },
    }),
    db.order.aggregate({
      where: { eventId, voidedAt: null, placedAt: { gte: todayStart }, status: { not: OrderStatus.CANCELLED } },
      _sum: { total: true },
    }),
    db.order.aggregate({
      where: { eventId, voidedAt: null, placedAt: { gte: todayStart }, status: { not: OrderStatus.CANCELLED } },
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
    const { id } = await params
    const { event } = await requireAdminFairContext(id)

    // Vendors + organizer sourced via their own models (keyed by the resolved
    // ids), NOT by re-resolving Event — the chokepoint owns the single Event
    // resolution. Organizer carries the A6 suspension state for the kill-switch UI.
    const [vendors, organizer, checklist] = await Promise.all([
      db.vendor.findMany({
        where: { eventId: event.id },
        select: {
          id: true, name: true, cuisineType: true, boothNumber: true,
          status: true, isOffline: true, isBusy: true,
          stripeVerified: true, lastHeartbeatAt: true,
        },
      }),
      event.organizerId
        ? db.fairOrganizer.findUnique({
            where: { id: event.organizerId },
            select: { id: true, name: true, suspendedAt: true, suspendedReason: true },
          })
        : Promise.resolve(null),
      // Same shared core the status route GATES on — display == enforcement.
      getGoLiveChecklist(event.id, { eventLat: event.eventLat, eventLng: event.eventLng }),
    ])

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

    // Firebase heartbeats — live, but STRICTLY BOUNDED. This route pioneered the wrap (it 504'd
    // in prod for exactly this reason); the bound now lives in boundedHeartbeatRead so the two
    // organizer routes cannot miss it the way they did the first time. Same 2500ms, same
    // degrade-to-lastHeartbeatAt fallback in vendorGrid below.
    const heartbeats = await boundedHeartbeatRead(event.id)

    const now = Date.now()
    const vendorGrid = vendors.map(v => {
      const lastHeartbeat = heartbeats[v.id] ?? (v.lastHeartbeatAt ? v.lastHeartbeatAt.getTime() : 0)
      const connected = now - lastHeartbeat < 60_000
      const liveStatus = v.isOffline ? 'OFFLINE' : v.isBusy ? 'BUSY' : v.status
      return { ...v, lastHeartbeat, connectionStatus: connected ? 'CONNECTED' : 'DISCONNECTED', liveStatus }
    })

    const activeVendors = vendors.filter(v => v.status === 'ACTIVE' && !v.isOffline).length
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
        totalVendors: vendors.length,
        activeRunners,
      },
      vendorGrid,
      organizer: organizer && {
        id: organizer.id,
        name: organizer.name,
        suspended: !!organizer.suspendedAt,
        suspendedAt: organizer.suspendedAt,
        suspendedReason: organizer.suspendedReason,
      },
      checklist,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
