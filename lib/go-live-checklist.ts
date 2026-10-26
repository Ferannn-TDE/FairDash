import { db } from './db'
import { VendorStatus } from '@prisma/client'
import { deliveryAreaConfigured } from './delivery-radius'
import { hasVenueAddress } from './venue-address'

export interface GoLiveChecklist {
  hasActiveVendor:    boolean
  hasStripeVendor:    boolean
  hasFulfillmentMode: boolean
  hasCoords:          boolean
  /** True when home delivery is off, or on with fair coordinates + a radius (lib/delivery-radius). */
  hasDeliveryArea:    boolean
  /** Street, city, state and ZIP all set and valid (lib/venue-address). */
  hasVenueAddress:    boolean
  canGoLive:          boolean
}

// The ordered checklist keys, so the gate and the UI iterate the same set.
export const GO_LIVE_KEYS = ['hasActiveVendor', 'hasStripeVendor', 'hasFulfillmentMode', 'hasCoords', 'hasDeliveryArea', 'hasVenueAddress'] as const

/**
 * Authorization-agnostic core: a fair's go-live readiness. SINGLE source of truth
 * shared by the status route (the GATE that enforces UPCOMING→ACTIVE) and the
 * dashboard endpoint (the DISPLAY) — so the checklist an admin SEES is exactly the
 * one the Go-Live action ENFORCES. Keyed by an already-resolved eventId + the fair's
 * coords and venue; never resolves the Event, never authorizes.
 */
export async function getGoLiveChecklist(
  eventId: string,
  fair: {
    eventLat: number | null; eventLng: number | null
    venueAddress: string | null; venueCity: string | null; venueState: string | null; venueZip: string | null
  }
): Promise<GoLiveChecklist> {
  const coords = fair
  const [activeVendors, fulfillmentConfig] = await Promise.all([
    db.vendor.findMany({
      where: { eventId, status: VendorStatus.ACTIVE },
      select: { stripeVerified: true },
    }),
    db.fulfillmentConfig.findUnique({ where: { eventId } }),
  ])

  const hasActiveVendor = activeVendors.length > 0
  const hasStripeVendor = activeVendors.some(v => v.stripeVerified)
  const hasFulfillmentMode = fulfillmentConfig
    ? fulfillmentConfig.boothPickupEnabled || fulfillmentConfig.curbsideEnabled || fulfillmentConfig.homeDeliveryEnabled
    : false
  const hasCoords = coords.eventLat !== null && coords.eventLng !== null
  // Home delivery switched on before the area gate existed would otherwise refuse every order
  // silently — surface it here, with the same predicate the order route uses.
  const hasDeliveryArea = !fulfillmentConfig?.homeDeliveryEnabled || deliveryAreaConfigured({
    eventLat: coords.eventLat, eventLng: coords.eventLng, homeDeliveryRadiusKm: fulfillmentConfig.homeDeliveryRadiusKm,
  })

  // No real fair goes live without a full address: customers and Google's event results need it.
  const venueOk = hasVenueAddress(fair)

  return {
    hasActiveVendor,
    hasStripeVendor,
    hasFulfillmentMode,
    hasCoords,
    hasDeliveryArea,
    hasVenueAddress: venueOk,
    canGoLive: hasActiveVendor && hasStripeVendor && hasFulfillmentMode && hasCoords && hasDeliveryArea && venueOk,
  }
}
