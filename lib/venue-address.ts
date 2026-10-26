// A FAIR'S VENUE ADDRESS — required before a fair can be published or go live.
//
// Customers need to know where the fair is, and Google's event results require a location
// (lib/seo.ts leaves `location` out rather than guess one). So no real fair may exist without
// a full street address: street, city, state and ZIP.
//
// Enforced at every door a fair passes on its way to customers:
//   • organizer create (POST /api/organizer/fairs), unless saved as a DRAFT;
//   • draft publish (PATCH /api/organizer/fairs/drafts/[fairSlug] with publish: true);
//   • the admin Go Live checklist (lib/go-live-checklist, `hasVenueAddress`).
// A draft may be incomplete; it is hidden everywhere until published.
//
// Pure, no imports: the create-fair wizard runs the same check before it submits.

export type VenueAddressInput = {
  venueAddress?: unknown
  venueCity?: unknown
  venueState?: unknown
  venueZip?: unknown
}

export type VenueAddress = { venueAddress: string; venueCity: string; venueState: string; venueZip: string }

/** The 50 states, DC and the inhabited territories. */
export const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
  'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'GU', 'VI', 'AS', 'MP',
])

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/**
 * PURE. The four fields cleaned (whitespace collapsed, state upper-cased), or the list of what is
 * missing or malformed with one message the organizer can act on.
 */
export function parseVenueAddress(input: VenueAddressInput):
  | { ok: true; value: VenueAddress }
  | { ok: false; problems: string[]; message: string } {
  const venueAddress = text(input.venueAddress)
  const venueCity = text(input.venueCity)
  const venueState = text(input.venueState).toUpperCase()
  const venueZip = text(input.venueZip)

  const problems: string[] = []
  if (!venueAddress) problems.push('street address')
  if (!venueCity) problems.push('city')
  if (!venueState) problems.push('state')
  else if (!US_STATE_CODES.has(venueState)) problems.push('state (2-letter code, e.g. IL)')
  if (!venueZip) problems.push('ZIP')
  else if (!/^\d{5}(-\d{4})?$/.test(venueZip)) problems.push('ZIP (5 digits)')

  if (problems.length) {
    return { ok: false, problems, message: `The fair's venue address needs: ${problems.join(', ')}.` }
  }
  return { ok: true, value: { venueAddress, venueCity, venueState, venueZip } }
}

/** For the Go Live checklist: does this fair have a complete, valid venue address? */
export function hasVenueAddress(event: VenueAddressInput): boolean {
  return parseVenueAddress(event).ok
}
