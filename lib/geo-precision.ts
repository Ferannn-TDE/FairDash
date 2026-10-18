/**
 * Geocode precision — Google's location_type, as stored on Order.deliveryGeoPrecision.
 * Client-safe (no env, no fetch), so runner and customer views share the ONE rule with
 * lib/delivery-radius instead of restating it.
 */
export type GeoPrecision = 'ROOFTOP' | 'RANGE_INTERPOLATED' | 'GEOMETRIC_CENTER' | 'APPROXIMATE'

/** True when the pin may be off the door (a dorm, a new building): show the written address first. */
export function isApproximate(p: string | null | undefined): boolean {
  return p === 'GEOMETRIC_CENTER' || p === 'APPROXIMATE'
}
