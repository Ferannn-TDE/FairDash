import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { getGoLiveChecklist } from '@/lib/go-live-checklist'
import { getRealtimeDb } from '@/lib/firebase-admin'
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

    // Firebase heartbeats — live, but STRICTLY BOUNDED. This is the one unbounded external
    // call in the request, and the request runs under a ~10s serverless ceiling. On a cold
    // serverless start, establishing a fresh authenticated RTDB connection can HANG (not
    // error — a hang isn't caught by try/catch), which hangs the whole request → 504. So we
    // race it against a short timeout: if the realtime read doesn't answer fast, we fall
    // back to the DB's lastHeartbeatAt (already the fallback in vendorGrid below). Live
    // heartbeats are a nicety; they must never be able to time out the dashboard.
    const rtdb = getRealtimeDb()
    const heartbeats: Record<string, number> = {}
    if (rtdb) {
      try {
        const HEARTBEAT_TIMEOUT_MS = 2500
        const snap = await Promise.race([
          rtdb.ref(`fairs/${event.id}/heartbeats`).get(),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('heartbeat read timed out')), HEARTBEAT_TIMEOUT_MS)),
        ])
        if (snap && snap.exists()) Object.assign(heartbeats, snap.val() as Record<string, number>)
      } catch {
        // Firebase unavailable OR too slow — degrade to DB lastHeartbeatAt, never hang.
      }
    }

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
