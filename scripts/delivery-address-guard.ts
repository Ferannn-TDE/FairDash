/**
 * DELIVERY-ADDRESS GUARD — the checkout write path never fabricates a value to satisfy a
 * validator, and the form can never build a payload the server rejects.
 *
 * The arc this pins (both halves of the through-line class, in the write-path variant):
 *
 *   THE FABRICATION. `deliveryCity: city || street` copied the street into the city whenever
 *   Places didn't fire — "417 Cougar Village, 417 Cougar Village" on every vendor card. Commit
 *   d2c8e76 removed it, and left its twin standing one field over: `deliveryZip: zip || '00000'`,
 *   a zip code that does not exist, on all 10 legacy rows. A write path inventing a
 *   plausible-looking value to pass a check is the class; killing one instance is not killing it.
 *
 *   THE DEAD END. Removing the city fabrication exposed what it had been hiding: the route
 *   REQUIRED a city (route.ts), the form had NO city input, and client validate() checked only
 *   the street — so a customer who typed an address without picking a suggestion submitted a
 *   form that could not pass, and had nowhere to supply what was missing. The 400 read "failed
 *   to create order". Two validators, one rule, no shared definition: the same two-copies class.
 *
 *   [0] POSITIVE CONTROLS — the fabrication scanner flags planted `|| '00000'` / `|| street`
 *       fixtures, and does NOT flag a legitimate `|| null`; the [0] baseline is asserted BEFORE
 *       the real scan, so a broken regex cannot pass this suite vacuously.
 *   [1] NO FABRICATED DEFAULTS on any customer-supplied address field in the write path.
 *   [2] ONE VALIDATION RULE — the form and the route both call validateDeliveryAddress; neither
 *       hand-rolls a required-field check, so the dead end is structurally impossible.
 *   [3] THE RULE ITSELF (pure-function) — required = street/city/zip, each failure names its
 *       own field, zip format is checked, state/unit are optional, and '00000' is NOT
 *       special-cased (it was never real; it is simply no longer produced).
 *   [4] THE FORM COLLECTS WHAT THE RULE REQUIRES — an input exists for every required field
 *       (the missing city input is what turned a validation miss into a dead end), plus the
 *       unit line Places can never supply.
 *   [5] ONE FORMATTER — no surface hand-joins address parts, so a new field reaches every
 *       surface at once (five hand-rolled joins existed before this).
 *
 * Pure file-reader + pure-function. No DB, no worker. Run:
 *   npx tsx scripts/delivery-address-guard.ts
 */

import { readFileSync } from 'node:fs'
import { validateDeliveryAddress, formatDeliveryAddress, REQUIRED_DELIVERY_FIELDS } from '../lib/delivery-address'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const checkout = readFileSync(new URL('../app/fair/[fairSlug]/checkout/page.tsx', import.meta.url), 'utf8')
const route = readFileSync(new URL('../app/api/orders/route.ts', import.meta.url), 'utf8')

/**
 * Strip `//` line comments before scanning. This guard is about what the code DOES; the files
 * it scans document the fabrications they no longer perform (naming '00000' to explain why it
 * is gone), and a scanner that cannot tell code from its own history forces the prose to be
 * deleted to stay green — which is how the reasoning gets lost. Block comments are left alone:
 * none of the scanned patterns appear in one.
 */
const codeOnly = (src: string) => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
const checkoutCode = codeOnly(checkout)
const routeCode = codeOnly(route)

// The scan rule: a delivery* field assigned a non-null literal fallback — `|| '00000'`,
// `|| 'N/A'` — or a fallback to ANOTHER form field (the street→city copy). Deliberately NOT a
// bare `||` scan: `|| null` is the correct shape and must not trip, and unrelated defaults
// (an env fallback, a toast message) are none of this guard's business.
const FABRICATED = /delivery[A-Za-z]*:\s*[^,\n]*\|\|\s*(?:'(?!')[^']+'|"[^"]+"|form\.delivery[A-Za-z]+)/

console.log('[0] positive controls: the fabrication scanner works before we trust it')
assert(FABRICATED.test("deliveryZip: form.deliveryZip.trim() || '00000',"),
  "flags a planted `deliveryZip: … || '00000'` (the fabrication that shipped)")
assert(FABRICATED.test('deliveryCity: form.deliveryCity.trim() || form.deliveryStreet.trim(),'),
  'flags a planted street→city copy (the fabrication before it)')
assert(!FABRICATED.test('deliveryCity: form.deliveryCity.trim() || null,'),
  'baseline: `|| null` is NOT flagged — an honest gap is the correct shape')
assert(codeOnly("// deliveryZip: x || '00000' — historical note").trim() === ''
  && codeOnly("deliveryZip: x || '00000'").includes('00000'),
  'the comment stripper drops documentation and keeps code (so prose about a dead bug stays legal)')

console.log('\n[1] no fabricated default on any customer-supplied address field')
const offenders = checkoutCode.split('\n')
  .map((l, i) => ({ l: l.trim(), n: i + 1 }))
  .filter(x => FABRICATED.test(x.l))
offenders.forEach(o => console.log(`     ✗ checkout/page.tsx:${o.n}: ${o.l}`))
assert(offenders.length === 0, 'checkout write path fabricates NOTHING (city and zip both gone)')
assert(!/'00000'/.test(checkoutCode) && !/'00000'/.test(routeCode),
  "the '00000' zip appears in NO code path — form or route (comments explaining its removal are fine)")

console.log('\n[2] one validation rule, shared by form and route')
assert(/validateDeliveryAddress/.test(checkout) && /from '@\/lib\/delivery-address'/.test(checkout),
  'the checkout form validates through the shared rule')
assert(/validateDeliveryAddress/.test(route) && /from '@\/lib\/delivery-address'/.test(route),
  'the order route validates through the SAME shared rule')
assert(!/if\s*\(!deliveryStreet\s*\|\|\s*!deliveryCity\s*\|\|\s*!deliveryZip\)/.test(routeCode),
  'the route no longer hand-rolls its own required-field check (the copy that drifted from the form)')

console.log('\n[3] the rule itself')
assert(validateDeliveryAddress({ street: '417 Cougar Village', city: 'Edwardsville', state: 'IL', zip: '62026' }).length === 0,
  'a complete address passes')
const missing = validateDeliveryAddress({ street: '417 Cougar Village' })
assert(missing.length === 2 && missing.every(e => ['city', 'zip'].includes(e.field)),
  'street-only (the exact manual-entry payload that 400d) fails on city AND zip — each naming its field')
assert(missing.every(e => e.message.length > 0 && !/failed/i.test(e.message)),
  'every failure carries an actionable message, never a generic "failed to create order"')
assert(validateDeliveryAddress({ street: 's', city: 'c', zip: '1234' }).some(e => e.field === 'zip'),
  'a malformed zip is rejected (4 digits)')
assert(validateDeliveryAddress({ street: 's', city: 'c', zip: '00000' }).length === 0,
  "'00000' is NOT special-cased — it was never real, it is simply no longer produced (legacy rows still validate)")
assert(validateDeliveryAddress({ street: 's', city: 'c', zip: '62026', unit: '', state: '' }).length === 0,
  'unit and state are OPTIONAL — a missing unit never blocks an order')
assert(validateDeliveryAddress({ street: 's', city: 'c', zip: '62026', state: 'Illinois' }).some(e => e.field === 'state'),
  'a state that is given must be the 2-letter code')
assert([...REQUIRED_DELIVERY_FIELDS].sort().join(',') === 'city,street,zip',
  'the required set is exactly street/city/zip — one list, read by both callers')

console.log('\n[4] the form collects every field the rule requires')
for (const field of REQUIRED_DELIVERY_FIELDS) {
  const input = field === 'street' ? 'AddressAutocomplete' : `name="delivery${field[0].toUpperCase()}${field.slice(1)}"`
  assert(checkout.includes(input), `there is an input for the required field "${field}" (a required field with no input is the dead end)`)
}
assert(/name="deliveryUnit"/.test(checkout),
  'the unit line exists — Places has no unit component, so a dorm/apartment door can ONLY come from the customer')
assert(/deliveryState:\s*short\('administrative_area_level_1'\)/.test(checkout),
  'autocomplete fills the state when it fires')
assert(/fieldErrors\.deliveryCity/.test(checkout) && /fieldErrors\.deliveryZip/.test(checkout),
  'per-field errors render next to their own inputs')

console.log('\n[5] one formatter — no surface hand-joins address parts')
assert(formatDeliveryAddress({ street: '417 Cougar Village', unit: 'Room 214', city: 'Edwardsville', state: 'IL', zip: '62026' })
  === '417 Cougar Village, Room 214, Edwardsville, IL 62026', 'the formatter composes the full address')
assert(formatDeliveryAddress({ street: '417 Cougar Village' }) === '417 Cougar Village',
  'absent parts are DROPPED, never padded with a placeholder')
assert(formatDeliveryAddress({ city: 'Edwardsville' }) === null, 'no street → no address (honest null, not a bare city)')
const SURFACES = [
  '../app/runner/[fairSlug]/delivery/[orderId]/page.tsx',
  '../app/organizer/fairs/[fairSlug]/orders/page.tsx',
  '../app/account/orders/[orderId]/page.tsx',
  '../app/vendor/[fairSlug]/orders/page.tsx',
  '../app/vendor/[fairSlug]/dashboard/page.tsx',
]
// A hand-join = two delivery fields rendered adjacently with a literal separator, the shape all
// five surfaces used before ({order.deliveryStreet}, {order.deliveryCity}).
const HAND_JOIN = /\{[^}]*delivery(Street|City|Zip)[^}]*\}[,\s]+\{[^}]*delivery(Street|City|Zip)[^}]*\}|\[order\.deliveryStreet,\s*order\.delivery/
assert(HAND_JOIN.test('{order.deliveryStreet}, {order.deliveryCity}'),
  '[0] positive control: the hand-join scanner flags the exact shape that was there')
for (const s of SURFACES) {
  const src = readFileSync(new URL(s, import.meta.url), 'utf8')
  const name = s.split('/').slice(-3).join('/')
  assert(!HAND_JOIN.test(src), `${name} renders through the shared formatter, not a hand-join`)
}

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} delivery-address-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
