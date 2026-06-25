import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { ACTIVE_VENDOR_WHERE } from '@/lib/vendor-queries'

const ACTIVE_STATUSES = new Set(['PLACED', 'ACCEPTED', 'PREPARING', 'READY'])

async function fetchOrganizerFairs(organizerId: string) {
  const events = await db.event.findMany({
    where: { organizerId },
    orderBy: { startDate: 'desc' },
    select: {
      id: true,
      name: true,
      urlSlug: true,
      status: true,
      startDate: true,
      endDate: true,
      fulfillmentConfig: {
        select: {
          boothPickupEnabled: true,
          curbsideEnabled: true,
          homeDeliveryEnabled: true,
        },
      },
    },
  })

  const eventIds = events.map(e => e.id)
  if (eventIds.length === 0) return { fairs: [] }

  // SQL aggregation — no full-row scans, no JS reduce
  const [vendorGroups, orderGroups] = await Promise.all([
    db.vendor.groupBy({
      by: ['eventId'],
      where: { eventId: { in: eventIds }, ...ACTIVE_VENDOR_WHERE },
      _count: { id: true },
    }),
    db.order.groupBy({
      by: ['eventId', 'status'],
      where: { eventId: { in: eventIds }, status: { notIn: ['PENDING_PAYMENT'] } },
      _count: { id: true },
      _sum: { subtotal: true },
    }),
  ])

  // Build lookup maps from grouped results
  const vendorCountByEvent: Record<string, number> = {}
  for (const g of vendorGroups) {
    vendorCountByEvent[g.eventId] = g._count.id
  }

  const orderCountByEvent: Record<string, number> = {}
  const revenueByEvent: Record<string, number> = {}
  const pendingByEvent: Record<string, number> = {}

  for (const g of orderGroups) {
    if (g.status === 'CANCELLED') continue
    orderCountByEvent[g.eventId] = (orderCountByEvent[g.eventId] ?? 0) + g._count.id
    revenueByEvent[g.eventId] = (revenueByEvent[g.eventId] ?? 0) + (g._sum.subtotal ?? 0)
    if (ACTIVE_STATUSES.has(g.status)) {
      pendingByEvent[g.eventId] = (pendingByEvent[g.eventId] ?? 0) + g._count.id
    }
  }

  const fairs = events.map(event => ({
    id: event.id,
    name: event.name,
    slug: event.urlSlug,
    status: event.status,
    startDate: event.startDate,
    endDate: event.endDate,
    vendorCount:   vendorCountByEvent[event.id] ?? 0,
    orderCount:    orderCountByEvent[event.id]  ?? 0,
    totalRevenue:  parseFloat((revenueByEvent[event.id] ?? 0).toFixed(2)),
    pendingOrders: pendingByEvent[event.id]     ?? 0,
    enableBoothPickup:  event.fulfillmentConfig?.boothPickupEnabled  ?? true,
    enableCurbside:     event.fulfillmentConfig?.curbsideEnabled     ?? false,
    enableHomeDelivery: event.fulfillmentConfig?.homeDeliveryEnabled ?? false,
  }))

  return { fairs }
}

// GET /api/organizer/fairs
// Returns all events for the authenticated organizer with per-fair stats.
// Per-event counts and revenue computed via SQL groupBy — no full-row order scans.
// Result cached 60s per organizer.
export async function GET(_req: NextRequest) {
  try {
    const { organizerId } = await requireOrganizerAuth()

    const cached = unstable_cache(
      () => fetchOrganizerFairs(organizerId),
      [`organizer-fairs-${organizerId}`],
      { revalidate: 60, tags: [`organizer-fairs-${organizerId}`] }
    )

    return success(await cached())
  } catch (err) {
    return handleApiError(err)
  }
}
