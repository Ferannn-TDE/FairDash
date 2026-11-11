import type { Prisma } from '@prisma/client'

/**
 * The Event columns GET /api/events/[slug] returns to anyone, signed in or not (audit M6).
 *
 * That route has no auth: everything selected here goes out verbatim to a stranger who knows a
 * live fair's slug or id. It used `include` with no select, so every Event and FulfillmentConfig
 * column left the server: the operator's Stripe account id, the organizer id, GPS boundaries,
 * staging-zone and curbside-zone coordinates, the runner fee split and the listing mode.
 *
 * These are exactly the fields the client reads (app/_contexts/FairContext.tsx normalizeEvent),
 * and the same ones the server-rendered page selects (lib/fairs.ts getFairBySlugCached) minus the
 * featured-vendor fields, which normalizeEvent does not read. The vendor-count `_count` is added
 * in the route, because its readiness filter is read from the environment per request.
 *
 * Do not add a column without asking whether a stranger may have it.
 * scripts/public-event-select-guard.ts fails on any change to this list.
 */
export const PUBLIC_EVENT_SELECT = {
  id: true,
  name: true,
  urlSlug: true,
  description: true,
  status: true,
  primaryColor: true,
  startDate: true,
  endDate: true,
  serviceChargeEnabled: true,
  serviceChargeAmount: true,
  admissionFree: true,
  openTime: true,
  closeTime: true,
  fulfillmentConfig: {
    select: {
      boothPickupEnabled: true,
      curbsideEnabled: true,
      homeDeliveryEnabled: true,
      homeDeliveryFee: true,
      curbsideFee: true,
      curbsideZoneDescription: true,
    },
  },
} as const satisfies Prisma.EventSelect
