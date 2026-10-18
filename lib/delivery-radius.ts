/**
 * Delivery radius — the ONE decision on whether a home-delivery address is inside a fair's
 * delivery area, made on the SERVER before any PaymentIntent exists.
 *
 * WHAT WAS WRONG (2026-10-18). `FulfillmentConfig.homeDeliveryRadiusKm` was stored and editable
 * but nothing read it at order time, and orders carried no destination coordinates at all — so
 * a Springfield fair with a 10 km radius accepted (and charged for) a delivery to Edwardsville,
 * ~113 km away.
 *
 * THE RULES.
 *   - Coordinates come from the server's geocode of the SAME street/city/state/ZIP stored on the
 *     order — never from the browser (spoofable), and not from a Places place_id (checkout keeps
 *     every field editable, and many dorm addresses are typed, so a place_id is often missing or
 *     describes the address BEFORE the customer corrected it).
 *   - The geocode is pinned to the customer's ZIP (`components=postal_code:…|country:US`), so a
 *     vague match cannot land in another town.
 *   - Distance is STRAIGHT-LINE (haversine) from the fair's coordinates, and every message says so.
 *   - FAIL CLOSED: no fair coordinates, no radius, or no fulfillment config → no home delivery.
 *     A geocoder that is down or slow → the order is refused with a retry/pickup message. Nothing
 *     here can return `ok` without a real point inside the radius.
 *   - Precision is kept: GEOMETRIC_CENTER / APPROXIMATE results still decide the radius, but the
 *     order is marked so the runner view warns the pin may be off.
 *
 * Pure decision + an injectable geocoder, so scripts/delivery-radius-guard.ts proves every branch
 * without a network or a key.
 */

import { isApproximate, type GeoPrecision } from './geo-precision'

export { isApproximate, type GeoPrecision }

export interface GeoPoint { lat: number; lng: number; precision: GeoPrecision }

export interface AddressToGeocode {
  street: string
  city: string
  state?: string | null
  zip: string
}

/** A geocode outcome. `unavailable` covers timeouts, network errors, quota and key problems. */
export type GeocodeResult =
  | { kind: 'found'; point: GeoPoint }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; reason: string }

export type Geocoder = (addr: AddressToGeocode) => Promise<GeocodeResult>

export type RadiusDecision =
  | { ok: true; point: GeoPoint; distanceKm: number; radiusKm: number; approximate: boolean }
  | { ok: false; code: 'DELIVERY_NOT_CONFIGURED' | 'ADDRESS_NOT_FOUND' | 'GEOCODER_UNAVAILABLE' | 'OUT_OF_DELIVERY_RANGE'; message: string; status: number; distanceKm?: number; radiusKm?: number
      /** Operator-facing cause (e.g. "status REQUEST_DENIED", "key not set") — for logs, NEVER for the customer. */
      reason?: string }

export interface FairDeliveryArea {
  eventLat: number | null
  eventLng: number | null
  /** null when the fair has no fulfillment config at all. */
  homeDeliveryRadiusKm: number | null | undefined
}

const EARTH_RADIUS_KM = 6371.0088

/** Great-circle (straight-line) distance in km. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Does this fair have everything home delivery needs? The one predicate — the admin route uses it too. */
export function deliveryAreaConfigured(area: FairDeliveryArea): boolean {
  return (
    Number.isFinite(area.eventLat) && Number.isFinite(area.eventLng) &&
    typeof area.homeDeliveryRadiusKm === 'number' && area.homeDeliveryRadiusKm > 0
  )
}

const fmtKm = (km: number) => (km < 10 ? km.toFixed(1) : Math.round(km).toString())

/**
 * THE decision. Geocodes only when the fair is configured; never returns ok without a point
 * inside the radius.
 */
export async function decideDeliveryRadius(
  area: FairDeliveryArea,
  address: AddressToGeocode,
  geocode: Geocoder,
): Promise<RadiusDecision> {
  if (!deliveryAreaConfigured(area)) {
    return {
      ok: false, code: 'DELIVERY_NOT_CONFIGURED', status: 409,
      message: 'Home delivery isn’t available for this fair. Please choose pickup.',
    }
  }
  const radiusKm = area.homeDeliveryRadiusKm as number

  let result: GeocodeResult
  try {
    result = await geocode(address)
  } catch (err) {
    result = { kind: 'unavailable', reason: err instanceof Error ? err.message : String(err) }
  }

  if (result.kind === 'unavailable') {
    return {
      ok: false, code: 'GEOCODER_UNAVAILABLE', status: 503, reason: result.reason,
      message: 'We can’t verify your address right now. Please try again, or choose pickup.',
    }
  }
  if (result.kind === 'not_found') {
    return {
      ok: false, code: 'ADDRESS_NOT_FOUND', status: 400,
      message: 'We couldn’t find that address. Please check the street and ZIP code.',
    }
  }

  const { point } = result
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return {
      ok: false, code: 'GEOCODER_UNAVAILABLE', status: 503,
      message: 'We can’t verify your address right now. Please try again, or choose pickup.',
    }
  }

  const distanceKm = haversineKm(area.eventLat as number, area.eventLng as number, point.lat, point.lng)
  if (distanceKm > radiusKm) {
    return {
      ok: false, code: 'OUT_OF_DELIVERY_RANGE', status: 422, distanceKm, radiusKm,
      message:
        `This address is about ${fmtKm(distanceKm)} km from the fair. ` +
        `Delivery covers addresses within ${fmtKm(radiusKm)} km of the fair (straight-line distance).`,
    }
  }
  return { ok: true, point, distanceKm, radiusKm, approximate: isApproximate(point.precision) }
}

// ─── The real geocoder (Google Geocoding API) ────────────────────────────────

export const GEOCODE_TIMEOUT_MS = 5000

const PRECISIONS = new Set<GeoPrecision>(['ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER', 'APPROXIMATE'])

/**
 * Server-only. Reads GOOGLE_GEOCODING_API_KEY (restricted to the Geocoding API, no referrer
 * restriction) — never a NEXT_PUBLIC key. Bounded by GEOCODE_TIMEOUT_MS; every failure mode
 * becomes `unavailable`, which the decision turns into a refusal.
 */
export const googleGeocoder: Geocoder = async (addr) => {
  const key = process.env.GOOGLE_GEOCODING_API_KEY
  if (!key) return { kind: 'unavailable', reason: 'GOOGLE_GEOCODING_API_KEY not set' }

  const zip = addr.zip.trim()
  const params = new URLSearchParams({
    address: [addr.street, addr.city, addr.state, zip].filter(Boolean).join(', '),
    components: `postal_code:${zip}|country:US`,
    key,
  })
  let body: { status?: string; results?: Array<{ geometry?: { location?: { lat: number; lng: number }; location_type?: string } }> }
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) return { kind: 'unavailable', reason: `HTTP ${res.status}` }
    body = await res.json()
  } catch (err) {
    return { kind: 'unavailable', reason: err instanceof Error ? err.name : 'fetch failed' }
  }

  if (body.status === 'ZERO_RESULTS') return { kind: 'not_found' }
  if (body.status !== 'OK') return { kind: 'unavailable', reason: `status ${body.status ?? 'missing'}` }

  const geom = body.results?.[0]?.geometry
  const loc = geom?.location
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return { kind: 'not_found' }
  const precision = PRECISIONS.has(geom?.location_type as GeoPrecision)
    ? (geom!.location_type as GeoPrecision)
    : 'APPROXIMATE'
  return { kind: 'found', point: { lat: loc.lat, lng: loc.lng, precision } }
}
