import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

async function fetchOrganizerFairs(organizerId: string) {
  const events = await db.event.findMany({
    where: { organizerId },
    orderBy: { startDate: 'desc' },
    include: { fulfillmentConfig: true },
  })

  const eventIds = events.map(e => e.id)
  if (eventIds.length === 0) return { fairs: [] }

  const [vendors, orders] = await Promise.all([
    db.vendor.findMany({
      where: { eventId: { in: eventIds } },
      select: { id: true, eventId: true },
    }),
    db.order.findMany({
      where: { eventId: { in: eventIds }, status: { notIn: ['PENDING_PAYMENT'] } },
      select: { id: true, eventId: true, status: true, subtotal: true },
    }),
  ])

  const vendorCountByEvent: Record<string, number> = {}
  for (const v of vendors) {
    vendorCountByEvent[v.eventId] = (vendorCountByEvent[v.eventId] ?? 0) + 1
  }

  const orderCountByEvent: Record<string, number> = {}
  const revenueByEvent: Record<string, number> = {}
  const pendingByEvent: Record<string, number> = {}
  const ACTIVE_STATUSES = new Set(['PLACED', 'ACCEPTED', 'PREPARING', 'READY'])

  for (const o of orders) {
    if (o.status === 'CANCELLED') continue
    orderCountByEvent[o.eventId] = (orderCountByEvent[o.eventId] ?? 0) + 1
    revenueByEvent[o.eventId] = (revenueByEvent[o.eventId] ?? 0) + o.subtotal
    if (ACTIVE_STATUSES.has(o.status)) {
      pendingByEvent[o.eventId] = (pendingByEvent[o.eventId] ?? 0) + 1
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
// Revenue = sum of Order.subtotal for non-cancelled orders (not vendorPayout).
// Result is cached 60s per organizer — busted when a fair is created or settings updated.
export async function GET(_req: NextRequest) {
  try {
    const clerkId = await requireAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('Forbidden', 403, 'FORBIDDEN')

    const orgMember = await db.orgMember.findFirst({ where: { userId: dbUser.id } })
    if (!orgMember) return apiError('Forbidden', 403, 'FORBIDDEN')

    const cached = unstable_cache(
      () => fetchOrganizerFairs(orgMember.organizerId),
      [`organizer-fairs-${orgMember.organizerId}`],
      { revalidate: 60, tags: [`organizer-fairs-${orgMember.organizerId}`] }
    )

    const data = await cached()
    return success(data)
  } catch (err) {
    return handleApiError(err)
  }
}
