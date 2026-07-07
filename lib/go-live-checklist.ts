import { db } from './db'
import { VendorStatus } from '@prisma/client'

export interface GoLiveChecklist {
  hasActiveVendor:    boolean
  hasStripeVendor:    boolean
  hasFulfillmentMode: boolean
  hasCoords:          boolean
  canGoLive:          boolean
}

// The ordered checklist keys, so the gate and the UI iterate the same set.
export const GO_LIVE_KEYS = ['hasActiveVendor', 'hasStripeVendor', 'hasFulfillmentMode', 'hasCoords'] as const

/**
 * Authorization-agnostic core: a fair's go-live readiness. SINGLE source of truth
 * shared by the status route (the GATE that enforces UPCOMING→ACTIVE) and the
 * dashboard endpoint (the DISPLAY) — so the checklist an admin SEES is exactly the
 * one the Go-Live action ENFORCES. Keyed by an already-resolved eventId + coords;
 * never resolves the Event, never authorizes.
 */
export async function getGoLiveChecklist(
  eventId: string,
  coords: { eventLat: number | null; eventLng: number | null }
): Promise<GoLiveChecklist> {
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

  return {
    hasActiveVendor,
    hasStripeVendor,
    hasFulfillmentMode,
    hasCoords,
    canGoLive: hasActiveVendor && hasStripeVendor && hasFulfillmentMode && hasCoords,
  }
}
