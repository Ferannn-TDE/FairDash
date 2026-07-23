/**
 * Delivery address — the ONE definition of what a deliverable address is, and the ONE way to
 * render it. Both the checkout form and POST /api/orders validate through `validateDeliveryAddress`;
 * every surface that shows an address renders through `formatDeliveryAddress`.
 *
 * Why this module exists (2026-07-23): the address write path had BOTH halves of the
 * through-line class at once.
 *
 *   1. FABRICATED DEFAULTS. The form invented values to satisfy a validator it couldn't see:
 *      `deliveryCity: form.deliveryCity || form.deliveryStreet` produced "417 Cougar Village,
 *      417 Cougar Village", and `deliveryZip: form.deliveryZip || '00000'` produced a zip that
 *      does not exist. Killing the first one (commit d2c8e76) without killing the second left
 *      the class alive one field over — and turned the missing city into a 400 the customer
 *      could not clear, because there was no city input on the form at all.
 *   2. FIVE COPIES OF ONE DERIVATION. "Format an address for display" was hand-rolled at five
 *      call sites (runner delivery page, organizer orders, account orders, vendor dashboard,
 *      vendor orders), each with its own separator and field list — so a new field (the unit
 *      line a dorm delivery needs) would have reached some surfaces and not others.
 *
 * The validation contract is deliberately CLIENT ⊇ SERVER-identical: the same function decides,
 * so the form can never build a payload the route will reject (the dead-end that shipped) and
 * the route can never accept one the form would have refused. `state` and `unit` are OPTIONAL —
 * `state` because tightening the required set would 400 any browser still holding the previous
 * bundle mid-deploy, `unit` because most addresses don't have one and a runner is better served
 * by an empty line than a required guess.
 */

export interface DeliveryAddressInput {
  street?: string | null
  unit?: string | null   // apartment / suite / room — Places NEVER supplies this
  city?: string | null
  state?: string | null
  zip?: string | null
}

/**
 * Adapter from an Order-shaped row (the `delivery*`-prefixed columns) to the input shape.
 * Every display surface goes through this, so adding a field to the address means touching
 * the columns and this file — not five call sites that would each be updated separately, or
 * more likely, not.
 */
export function toDeliveryAddress(o: {
  deliveryStreet?: string | null
  deliveryUnit?: string | null
  deliveryCity?: string | null
  deliveryState?: string | null
  deliveryZip?: string | null
}): DeliveryAddressInput {
  return {
    street: o.deliveryStreet, unit: o.deliveryUnit, city: o.deliveryCity,
    state: o.deliveryState, zip: o.deliveryZip,
  }
}

/** Field-named failures, so a form can attach each message to its own input. */
export interface DeliveryAddressError {
  field: 'street' | 'unit' | 'city' | 'state' | 'zip'
  message: string
}

/** The required set. Both callers read THIS — a new required field lands on both at once. */
export const REQUIRED_DELIVERY_FIELDS = ['street', 'city', 'zip'] as const

const US_ZIP = /^\d{5}(-\d{4})?$/
const US_STATE = /^[A-Za-z]{2}$/

/**
 * The single validation rule. Returns [] for a deliverable address.
 *
 * NOTE ON '00000': it is not special-cased. It was never a real zip — it was a fabricated one,
 * and the fabrication is gone from the write path. Legacy rows keep it (see the completedAt
 * precedent: an invented value is worse than an honest gap, and re-inventing it here to make
 * old rows re-validate would be the same mistake a third time).
 */
export function validateDeliveryAddress(addr: DeliveryAddressInput): DeliveryAddressError[] {
  const errors: DeliveryAddressError[] = []
  const street = addr.street?.trim() ?? ''
  const city = addr.city?.trim() ?? ''
  const zip = addr.zip?.trim() ?? ''
  const state = addr.state?.trim() ?? ''

  if (!street) errors.push({ field: 'street', message: 'Enter your delivery address' })
  if (!city) errors.push({ field: 'city', message: 'Enter the city' })
  if (!zip) errors.push({ field: 'zip', message: 'Enter the ZIP code' })
  else if (!US_ZIP.test(zip)) errors.push({ field: 'zip', message: 'Enter a 5-digit ZIP code' })
  // Optional, but if given it must be a real 2-letter code — a half-typed state is worse than none.
  if (state && !US_STATE.test(state)) errors.push({ field: 'state', message: 'Use the 2-letter state code (e.g. IL)' })

  return errors
}

/**
 * One-line address for cards and lists: "417 Cougar Village, Room 214, Edwardsville, IL 62026".
 * Absent parts are dropped — never padded with a placeholder. The unit rides directly behind the
 * street because that is how a runner reads it (building, then door).
 */
export function formatDeliveryAddress(addr: DeliveryAddressInput): string | null {
  const street = addr.street?.trim()
  if (!street) return null
  const unit = addr.unit?.trim()
  const city = addr.city?.trim()
  const state = addr.state?.trim()
  const zip = addr.zip?.trim()
  // "City, ST 62026" — the state/zip tail is space-joined, everything else comma-joined.
  const tail = [city, [state, zip].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ')
  return [street, unit, tail].filter(Boolean).join(', ')
}

/**
 * Two-line form for detail panels: the street+unit a runner walks to, then the locality.
 * Returns null for line2 when there is nothing below the street.
 */
export function formatDeliveryAddressLines(addr: DeliveryAddressInput): { line1: string; line2: string | null } | null {
  const street = addr.street?.trim()
  if (!street) return null
  const unit = addr.unit?.trim()
  const line2 = [addr.city?.trim(), [addr.state?.trim(), addr.zip?.trim()].filter(Boolean).join(' ').trim()]
    .filter(Boolean).join(', ')
  return { line1: [street, unit].filter(Boolean).join(', '), line2: line2 || null }
}

/**
 * Maps query — the unit is deliberately EXCLUDED. "Room 214" is not a map feature; sending it
 * degrades geocoding to a fuzzier match. The runner reads the unit off the card and the map
 * takes them to the building.
 */
export function deliveryMapsQuery(addr: DeliveryAddressInput): string | null {
  const street = addr.street?.trim()
  if (!street) return null
  return [street, addr.city?.trim(), [addr.state?.trim(), addr.zip?.trim()].filter(Boolean).join(' ').trim()]
    .filter(Boolean).join(', ')
}
