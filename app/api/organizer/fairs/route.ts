import { NextRequest } from 'next/server'
import { unstable_cache, revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { parseVenueAddress, type VenueAddressInput } from '@/lib/venue-address'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { ACTIVE_VENDOR_WHERE } from '@/lib/vendor-queries'
import { IN_MODEL_ORDERS } from '@/lib/order-scope'
import { organizerFairScope } from '@/lib/organizer-fair-context'
import { isDeliveryEnabled, DELIVERY_OFF_MESSAGE, DELIVERY_OFF_PLATFORM } from '@/lib/delivery'
// The Event write (slug rule, DRAFT/UPCOMING, FulfillmentConfig) lives in lib/create-fair.ts, shared
// with the organizer sign-up form's draft (sign-up-fixes commit 4). Moved there unchanged.
import { createFairRecord } from '@/lib/create-fair'

const ACTIVE_STATUSES = new Set(['PLACED', 'ACCEPTED', 'PREPARING', 'READY'])

async function fetchOrganizerFairs(organizerId: string) {
  const events = await db.event.findMany({
    // My Fairs list: archived fairs vanish, and DRAFT fairs are not fairs yet. Both exclusions
    // come from ONE fragment — see organizerFairScope for why this must not be typed inline.
    where: organizerFairScope(organizerId),
    orderBy: { startDate: 'desc' },
    select: {
      id: true,
      name: true,
      urlSlug: true,
      status: true,
      listing: true,
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
    // IN_MODEL_ORDERS — this feeds orderCount / revenue / pending on the organizer's FAIR LIST,
    // the first numbers they see on login. Without it, voided test orders inflate all three by
    // exactly the ~30% class this guard exists for. Found by the ghost-guard walk.
    db.order.groupBy({
      by: ['eventId', 'status'],
      where: { ...IN_MODEL_ORDERS, eventId: { in: eventIds }, status: { notIn: ['PENDING_PAYMENT'] } },
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
    listing: event.listing,
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

// POST /api/organizer/fairs
// Creates a fair owned by the authenticated organizer (from the create-fair wizard).
//
// TWO OUTCOMES, ONE ROUTE. `asDraft: true` (the wizard's "Save Draft") creates a DRAFT — a real
// row, hidden from every list/count/public surface until published. Anything else creates an
// UPCOMING fair exactly as before. Previously BOTH buttons created UPCOMING, which is why
// "Save Draft" produced permanent, publicly-eligible fairs and left abandoned half-built rows
// behind; that is the bug this closes.
//
// STILL NO PARTIAL ROWS. Both paths require name + startDate + endDate, so a DRAFT satisfies
// every NOT NULL column like any other Event. Mid-wizard resume (persisted step + partial payload,
// which WOULD need nullable dates) is deliberately out of scope.
export async function POST(req: NextRequest) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const body = await req.json()
    const {
      name, slug, description, startDate, endDate,
      venueAddress, venueCity, venueState, venueZip,
      openTime, closeTime, timezone, accentColor,
      maxVendors, deliveryEnabled, pickupEnabled, admissionFree,
      asDraft,
    } = body

    if (!name || !String(name).trim()) return apiError('Fair name is required', 400, 'VALIDATION_ERROR')
    if (!startDate || !endDate)          return apiError('Start and end dates are required', 400, 'VALIDATION_ERROR')
    // Platform delivery switch (item 6): a new fair can't start with delivery on while it's off
    // for the whole platform (a new fair has no existing flag to keep).
    if (deliveryEnabled === true && !(await isDeliveryEnabled())) {
      return apiError(DELIVERY_OFF_MESSAGE, 409, DELIVERY_OFF_PLATFORM)
    }
    // Publishing needs the full venue address (lib/venue-address); a draft may be incomplete.
    let venue: VenueAddressInput = { venueAddress, venueCity, venueState, venueZip }
    if (asDraft !== true) {
      const parsed = parseVenueAddress(venue)
      if (!parsed.ok) return apiError(parsed.message, 400, 'VALIDATION_ERROR')
      venue = parsed.value
    }

    const event = await createFairRecord(db, organizerId, {
      name, slug, description, startDate, endDate, timezone, accentColor,
      venueAddress: (venue.venueAddress as string | undefined) ?? null,
      venueCity:    (venue.venueCity as string | undefined) ?? null,
      venueState:   (venue.venueState as string | undefined) ?? null,
      venueZip:     (venue.venueZip as string | undefined) ?? null,
      openTime, closeTime, maxVendors, admissionFree, pickupEnabled, deliveryEnabled,
    }, { asDraft: asDraft === true })

    // Refresh the organizer's fair-list cache (this endpoint's own GET tag) so the new fair shows
    // immediately, plus the public discovery cache.
    //
    // (The previous note here claimed getAllFairsCached "includes UPCOMING". It does not — it
    // filters status: ACTIVE (lib/fairs.ts), so neither an UPCOMING fair nor a DRAFT one is
    // publicly discoverable at creation. Corrected rather than left as stale prose on the exact
    // line someone would read to answer "can a draft leak to the public site?". It cannot.)
    revalidateTag(`organizer-fairs-${organizerId}`, 'default')
    revalidateTag('fair', 'default')

    return success(event, 201)
  } catch (err) {
    return handleApiError(err)
  }
}
