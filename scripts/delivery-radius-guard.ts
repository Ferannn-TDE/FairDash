/**
 * DELIVERY-RADIUS GUARD — a home-delivery order outside the fair's radius is refused BEFORE any
 * PaymentIntent exists, from server-side coordinates, failing closed on missing config or an
 * unreachable geocoder.
 *
 * The bug (2026-10-18): homeDeliveryRadiusKm was stored but never read at order time, and orders
 * had no destination coordinates — a Springfield fair with a 10 km radius accepted a delivery to
 * Edwardsville (~111 km).
 *
 *   [0] STEP-0 BASELINE + POSITIVE CONTROL — haversine matches a known distance, and an
 *       in-radius stub is ACCEPTED, so every refusal below is a decision, not a broken probe.
 *   [1] out of range (the real Springfield → Edwardsville case)
 *   [2] boundary
 *   [3] address not found
 *   [4] geocoder down / slow / throwing / garbage → refused, never ok
 *   [5] fair not configured → refused, geocoder NOT called (no spend)
 *   [5b] approximate result → accepted and flagged
 *   [6] route: decision sits in the HOME_DELIVERY branch, before paymentIntents.create; stored
 *       coordinates come from the decision, never the body (scanner positive-controlled)
 *   [7] route: non-delivery orders never reach the geocoder
 *   [8] admin fulfillment route can't switch home delivery on without an area
 *   [9] the geocoding key is server-only (scanner positive-controlled)
 *   [10] delivery-check endpoint: signed-in, rate-limited fail-closed, no coordinates returned
 *   [11] the real Google adapter: ZIP-pinned request, status mapping, timeout → unavailable
 *
 * Pure functions + stubbed fetch + source scans. No network, no key, no database.
 * Run:  npx tsx scripts/delivery-radius-guard.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from './_strip-comments'
import {
  decideDeliveryRadius, deliveryAreaConfigured, haversineKm, googleGeocoder,
  type Geocoder, type FairDeliveryArea, type AddressToGeocode,
} from '../lib/delivery-radius'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

// Springfield IL fair, 10 km radius. Edwardsville IL delivery.
const SPRINGFIELD = { lat: 39.7817, lng: -89.6501 }
const EDWARDSVILLE = { lat: 38.8114, lng: -89.9532 }
const FAIR: FairDeliveryArea = { eventLat: SPRINGFIELD.lat, eventLng: SPRINGFIELD.lng, homeDeliveryRadiusKm: 10 }
const ADDR: AddressToGeocode = { street: '1 Hairpin Dr', city: 'Edwardsville', state: 'IL', zip: '62026' }
const KM_PER_DEG_LAT = 111.19508 // 2πR/360 with R = 6371.0088 km
const north = (km: number) => ({ lat: SPRINGFIELD.lat + km / KM_PER_DEG_LAT, lng: SPRINGFIELD.lng })

function stub(result: Awaited<ReturnType<Geocoder>>): Geocoder & { calls: number } {
  const g = (async () => { g.calls++; return result }) as unknown as Geocoder & { calls: number }
  g.calls = 0
  return g
}
const found = (p: { lat: number; lng: number }, precision: 'ROOFTOP' | 'APPROXIMATE' | 'GEOMETRIC_CENTER' = 'ROOFTOP') =>
  stub({ kind: 'found', point: { ...p, precision } })

async function main() {
  console.log('\n════ DELIVERY-RADIUS GUARD ════')

  console.log('\n[0] STEP-0 BASELINE + POSITIVE CONTROL')
  const oneDeg = haversineKm(0, 0, 1, 0)
  assert(Math.abs(oneDeg - KM_PER_DEG_LAT) < 0.001, `haversine: 1° of latitude = ${oneDeg.toFixed(3)} km (expected ${KM_PER_DEG_LAT})`)
  const se = haversineKm(SPRINGFIELD.lat, SPRINGFIELD.lng, EDWARDSVILLE.lat, EDWARDSVILLE.lng)
  assert(se > 109 && se < 113, `Springfield → Edwardsville = ${se.toFixed(1)} km (independent flat estimate ≈ 111)`)
  const inside = found(north(3))
  const ok = await decideDeliveryRadius(FAIR, ADDR, inside)
  assert(ok.ok === true, 'POSITIVE CONTROL: an address 3 km from the fair is ACCEPTED')
  assert(ok.ok === true && ok.point.lat === north(3).lat && !ok.approximate, 'POSITIVE CONTROL: the accepted point is the geocoded one, not approximate')
  assert(inside.calls === 1, 'POSITIVE CONTROL: the geocoder was called exactly once')

  console.log('\n[1] OUT OF RANGE — the real case')
  const out = await decideDeliveryRadius(FAIR, ADDR, found(EDWARDSVILLE))
  assert(!out.ok && out.code === 'OUT_OF_DELIVERY_RANGE', 'Edwardsville from a Springfield fair (10 km) → OUT_OF_DELIVERY_RANGE')
  assert(!out.ok && /about 111 km/.test(out.message) && /10\.0 km|10 km/.test(out.message) && /straight-line/.test(out.message),
    `message names the distance, the radius and "straight-line": "${!out.ok ? out.message : ''}"`)
  assert(!out.ok && out.status === 422, 'refused with 422')

  console.log('\n[2] BOUNDARY')
  const at = await decideDeliveryRadius(FAIR, ADDR, found(north(9.9999)))
  const over = await decideDeliveryRadius(FAIR, ADDR, found(north(10.001)))
  assert(at.ok === true, '9.9999 km (on the edge) → accepted')
  assert(!over.ok && over.code === 'OUT_OF_DELIVERY_RANGE', '10.001 km → refused')

  console.log('\n[3] ADDRESS NOT FOUND')
  const nf = await decideDeliveryRadius(FAIR, ADDR, stub({ kind: 'not_found' }))
  assert(!nf.ok && nf.code === 'ADDRESS_NOT_FOUND' && nf.status === 400, 'no geocode result → ADDRESS_NOT_FOUND (400)')

  console.log('\n[4] GEOCODER DOWN — fail closed, never ok')
  const down = await decideDeliveryRadius(FAIR, ADDR, stub({ kind: 'unavailable', reason: 'timeout' }))
  assert(!down.ok && down.code === 'GEOCODER_UNAVAILABLE' && down.status === 503, 'unavailable → GEOCODER_UNAVAILABLE (503)')
  assert(!down.ok && /try again/i.test(down.message) && /pickup/i.test(down.message), 'message offers retry or pickup')
  const throwing: Geocoder = async () => { throw new Error('socket hang up') }
  const thrown = await decideDeliveryRadius(FAIR, ADDR, throwing)
  assert(!thrown.ok && thrown.code === 'GEOCODER_UNAVAILABLE', 'a THROWING geocoder → GEOCODER_UNAVAILABLE, not an unhandled error and not ok')
  const garbage = await decideDeliveryRadius(FAIR, ADDR, stub({ kind: 'found', point: { lat: NaN, lng: 1, precision: 'ROOFTOP' } }))
  assert(!garbage.ok && garbage.code === 'GEOCODER_UNAVAILABLE', 'a NaN coordinate → refused (NaN > radius is false; it must not slip through as ok)')

  console.log('\n[5] NOT CONFIGURED — refused, and no geocode spent')
  for (const [label, area] of [
    ['no fair coordinates', { ...FAIR, eventLat: null, eventLng: null }],
    ['no radius', { ...FAIR, homeDeliveryRadiusKm: null }],
    ['no fulfillment config', { ...FAIR, homeDeliveryRadiusKm: undefined }],
    ['zero radius', { ...FAIR, homeDeliveryRadiusKm: 0 }],
  ] as const) {
    const g = found(north(1))
    const d = await decideDeliveryRadius(area, ADDR, g)
    assert(!d.ok && d.code === 'DELIVERY_NOT_CONFIGURED' && g.calls === 0, `${label} → DELIVERY_NOT_CONFIGURED, geocoder not called`)
    assert(!deliveryAreaConfigured(area), `deliveryAreaConfigured is false for ${label}`)
  }
  assert(deliveryAreaConfigured(FAIR), 'deliveryAreaConfigured is true for a complete fair (control)')

  console.log('\n[5b] APPROXIMATE RESULT — accepted, flagged')
  const approx = await decideDeliveryRadius(FAIR, ADDR, found(north(4), 'APPROXIMATE'))
  assert(approx.ok === true && approx.approximate, 'APPROXIMATE inside the radius → accepted with approximate=true')
  const center = await decideDeliveryRadius(FAIR, ADDR, found(north(4), 'GEOMETRIC_CENTER'))
  assert(center.ok === true && center.approximate, 'GEOMETRIC_CENTER → approximate=true')
  const approxOut = await decideDeliveryRadius(FAIR, ADDR, found(EDWARDSVILLE, 'APPROXIMATE'))
  assert(!approxOut.ok && approxOut.code === 'OUT_OF_DELIVERY_RANGE', 'APPROXIMATE outside the radius → still refused')
  const runnerPage = readFileSync('app/runner/[fairSlug]/delivery/[orderId]/page.tsx', 'utf8')
  assert(/isApproximate\(order\.deliveryGeoPrecision\)/.test(runnerPage) && /Location approximate/.test(runnerPage),
    'runner delivery page warns when the stored precision is approximate')

  console.log('\n[6] ROUTE — before the PaymentIntent, coordinates from the decision')
  const route = stripComments(readFileSync('app/api/orders/route.ts', 'utf8'))
  const order = (src: string) => {
    const decide = src.indexOf('decideDeliveryRadius(')
    const pi = src.indexOf('stripe.paymentIntents.create(')
    return decide > 0 && pi > 0 && decide < pi
  }
  assert(!order('const pi = await stripe.paymentIntents.create(p)\nconst r = await decideDeliveryRadius(a, b, g)'),
    'control: the scanner flags a decision placed AFTER the PaymentIntent')
  assert(order(route), 'decideDeliveryRadius runs before stripe.paymentIntents.create')
  assert(/throw new ApiError\(radius\.message, radius\.status, radius\.code\)/.test(route), 'a refusal throws the decision’s code (no PaymentIntent is reached)')
  assert(/deliveryLat:\s*deliveryGeo\?\.lat/.test(route) && /deliveryLng:\s*deliveryGeo\?\.lng/.test(route) && /deliveryGeoPrecision:\s*deliveryGeo\?\.precision/.test(route),
    'stored coordinates + precision come from the decision')
  assert(!/body\.delivery(Lat|Lng)|deliveryLat,|deliveryLng,/.test(route.slice(0, route.indexOf('// ── 2. DB validation'))),
    'the request body is never read for coordinates')
  assert(/googleGeocoder/.test(route) && !/https:\/\/maps\.googleapis/.test(route), 'the route uses the shared geocoder, not its own fetch')

  console.log('\n[7] ROUTE — only home delivery geocodes')
  const call = route.indexOf('decideDeliveryRadius(')
  const before = route.slice(Math.max(0, call - 300), call)
  assert(/if \(fulfillmentType === FulfillmentType\.HOME_DELIVERY\) \{/.test(before), 'the decision is inside the HOME_DELIVERY branch')
  assert((route.match(/decideDeliveryRadius\(/g) ?? []).length === 1, 'exactly one decision call in the route')

  console.log('\n[8] ADMIN — home delivery can’t be switched on without an area')
  const admin = stripComments(readFileSync('app/api/admin/events/[id]/fulfillment/route.ts', 'utf8'))
  const gate = admin.indexOf('deliveryAreaConfigured(')
  assert(gate > 0 && /DELIVERY_AREA_INCOMPLETE/.test(admin), 'admin fulfillment route checks deliveryAreaConfigured and refuses with DELIVERY_AREA_INCOMPLETE')
  assert(gate > 0 && gate < admin.indexOf('fulfillmentConfig.upsert('), 'the check runs before the config is written')
  assert(/homeDeliveryEnabled \?\? existing\?\.homeDeliveryEnabled/.test(admin), 'judged on the MERGED resulting state (body ?? existing)')
  const goLive = stripComments(readFileSync('lib/go-live-checklist.ts', 'utf8'))
  assert(/deliveryAreaConfigured\(/.test(goLive) && /canGoLive:[^\n]*hasDeliveryArea/.test(goLive),
    'go-live checklist shows the delivery area (same predicate) and requires it to go live')

  console.log('\n[9] KEY — server-only')
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(dir)) {
      if (n === 'node_modules' || n.startsWith('.')) continue
      const p = join(dir, n)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(n)) out.push(p)
    }
    return out
  }
  const KEY = 'GOOGLE_GEOCODING' + '_API_KEY'
  const leaks = (path: string, src: string) =>
    src.includes('NEXT_PUBLIC_' + KEY) ||
    (/^\s*['"]use client['"]/m.test(src) && (src.includes(KEY) || /lib\/delivery-radius['"]/.test(src)))
  assert(leaks('x.tsx', `'use client'\nconst k = process.env.${KEY}`), 'control: scanner flags the key in a client file')
  assert(leaks('x.tsx', `'use client'\nimport { googleGeocoder } from '@/lib/delivery-radius'`), 'control: scanner flags a client import of the geocoder module')
  const files = ['app', 'components', 'lib'].flatMap(d => walk(d))
  const offenders = files.filter(f => leaks(f, readFileSync(f, 'utf8')))
  assert(offenders.length === 0, offenders.length ? `key/geocoder reachable from client code: ${offenders.join(', ')}` : 'no client file reads the key or imports the geocoder')
  const readers = files.filter(f => readFileSync(f, 'utf8').includes(KEY))
  assert(readers.length === 1 && readers[0] === join('lib', 'delivery-radius.ts'), `only lib/delivery-radius.ts reads the key (found: ${readers.join(', ')})`)

  console.log('\n[10] DELIVERY-CHECK ENDPOINT — signed in, throttled, no coordinates out')
  const check = stripComments(readFileSync('app/api/orders/delivery-check/route.ts', 'utf8'))
  const iAuth = check.indexOf('requireAuth()'), iRl = check.indexOf('enforceRateLimit('), iDec = check.indexOf('decideDeliveryRadius(')
  assert(iAuth > 0 && iAuth < iRl && iRl < iDec, 'requireAuth → rate limit → decision, in that order (no anonymous geocode)')
  assert(/enforceRateLimit\(clerkId, 'deliveryCheck', \{ failClosed: true \}\)/.test(check), 'rate limit keyed on the user, fail-closed')
  assert(/deliveryCheck:/.test(readFileSync('lib/ratelimit.ts', 'utf8')), 'deliveryCheck is a named rate-limit policy')
  const ret = check.slice(check.indexOf('return success('))
  assert(!/point|\blat\b|\blng\b/.test(ret.slice(0, ret.indexOf('\n'))), 'the success response carries no coordinates')
  assert(/throw new ApiError\(radius\.message, radius\.status, radius\.code\)/.test(check), 'refusals use the same decision codes as the order route')

  console.log('\n[11] GOOGLE ADAPTER — stubbed fetch')
  const realFetch = globalThis.fetch
  const realKey = process.env.GOOGLE_GEOCODING_API_KEY
  let lastUrl = ''
  const respond = (body: unknown, status = 200) => {
    globalThis.fetch = (async (url: string) => { lastUrl = String(url); return new Response(JSON.stringify(body), { status }) }) as typeof fetch
  }
  try {
    delete process.env.GOOGLE_GEOCODING_API_KEY
    let fetched = false
    globalThis.fetch = (async () => { fetched = true; return new Response('{}') }) as typeof fetch
    const noKey = await googleGeocoder(ADDR)
    assert(noKey.kind === 'unavailable' && !fetched, 'no key → unavailable, and no request is made')

    process.env.GOOGLE_GEOCODING_API_KEY = 'test-key'
    respond({ status: 'OK', results: [{ geometry: { location: EDWARDSVILLE, location_type: 'RANGE_INTERPOLATED' } }] })
    const ok2 = await googleGeocoder(ADDR)
    assert(ok2.kind === 'found' && ok2.point.lat === EDWARDSVILLE.lat && ok2.point.precision === 'RANGE_INTERPOLATED', 'OK → found with the location_type')
    const q = new URL(lastUrl).searchParams
    assert(q.get('components') === 'postal_code:62026|country:US', `request is pinned to the ZIP: components=${q.get('components')}`)
    assert((q.get('address') ?? '').includes('Edwardsville') && (q.get('address') ?? '').includes('1 Hairpin Dr'), 'request geocodes the stored street + city')

    respond({ status: 'OK', results: [{ geometry: { location: EDWARDSVILLE, location_type: 'SOMETHING_NEW' } }] })
    const unk = await googleGeocoder(ADDR)
    assert(unk.kind === 'found' && unk.point.precision === 'APPROXIMATE', 'an unknown location_type is treated as APPROXIMATE (never upgraded)')

    respond({ status: 'ZERO_RESULTS', results: [] })
    assert((await googleGeocoder(ADDR)).kind === 'not_found', 'ZERO_RESULTS → not_found')
    for (const status of ['OVER_QUERY_LIMIT', 'REQUEST_DENIED', 'INVALID_REQUEST', 'UNKNOWN_ERROR']) {
      respond({ status })
      assert((await googleGeocoder(ADDR)).kind === 'unavailable', `${status} → unavailable`)
    }
    respond({ error: 'bad gateway' }, 502)
    assert((await googleGeocoder(ADDR)).kind === 'unavailable', 'HTTP 502 → unavailable')

    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      assert(init?.signal instanceof AbortSignal, 'the request carries an abort signal (bounded)')
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    }) as typeof fetch
    assert((await googleGeocoder(ADDR)).kind === 'unavailable', 'a timeout → unavailable')

    // [12] ZIP FALLBACK (1.1 follow-up, 2026-10-20). 62026 is SIUE's campus ZIP: pinned to it,
    // Google finds nothing — not even SIUE's own address — and campus students were told their
    // address doesn't exist. When the pinned search finds nothing, search again unpinned and
    // accept the top result only if it lies in the typed ZIP or the typed city (and the typed
    // state, when given). A fallback point is ALWAYS approximate, so the runner view warns.
    console.log('\n[12] ZIP FALLBACK — pinned search empty → unpinned, same ZIP or city, approximate')
    const COUGAR = { lat: 38.7925, lng: -89.9930 }
    const comp = (types: string[], short_name: string) => ({ long_name: short_name, short_name, types })
    const place = (loc: { lat: number; lng: number }, o: { zip?: string; city: string; state?: string; type?: string }) => ({
      geometry: { location: loc, location_type: o.type ?? 'ROOFTOP' },
      address_components: [
        comp(['locality', 'political'], o.city),
        comp(['administrative_area_level_1', 'political'], o.state ?? 'IL'),
        ...(o.zip ? [comp(['postal_code'], o.zip)] : []),
      ],
    })
    const urls: string[] = []
    const byPin = (pinned: unknown, unpinned: unknown) => {
      globalThis.fetch = (async (url: string) => {
        urls.push(String(url))
        const pin = (new URL(String(url)).searchParams.get('components') ?? '').includes('postal_code:')
        return new Response(JSON.stringify(pin ? pinned : unpinned))
      }) as typeof fetch
    }
    const EMPTY = { status: 'ZERO_RESULTS', results: [] }
    const CV62026: AddressToGeocode = { street: 'Cougar Village', city: 'Edwardsville', state: 'IL', zip: '62026' }

    urls.length = 0
    byPin(EMPTY, { status: 'OK', results: [place(COUGAR, { zip: '62025', city: 'Edwardsville', type: 'ROOFTOP' })] })
    const cv = await googleGeocoder(CV62026)
    assert(cv.kind === 'found' && cv.point.lat === COUGAR.lat, 'Cougar Village, 62026 → found via the fallback (same city, ZIP 62025)')
    assert(cv.kind === 'found' && cv.point.precision === 'APPROXIMATE', `fallback result is APPROXIMATE even when Google says ROOFTOP (got ${cv.kind === 'found' ? cv.point.precision : cv.kind})`)
    const second = new URL(urls[1] ?? 'http://x').searchParams
    assert(urls.length === 2 && second.get('components') === 'country:US' && (second.get('address') ?? '').includes('62026'),
      `second request is unpinned (components=${second.get('components')}) and still carries the typed address`)

    byPin(EMPTY, { status: 'OK', results: [place(EDWARDSVILLE, { zip: '62026', city: 'Edwardsville' })] })
    const hp = await googleGeocoder(ADDR)
    assert(hp.kind === 'found' && hp.point.precision === 'APPROXIMATE', '1 Hairpin Dr, Edwardsville 62026 → found via the fallback, approximate')

    byPin(EMPTY, { status: 'OK', results: [place({ lat: 38.7814, lng: -89.9532 }, { zip: '62034', city: 'Glen Carbon' })] })
    assert((await googleGeocoder(CV62026)).kind === 'not_found', 'fallback lands in another city and ZIP (Glen Carbon 62034) → rejected, not_found')

    byPin(EMPTY, { status: 'OK', results: [place({ lat: 39.0, lng: -94.5 }, { zip: '64101', city: 'Edwardsville', state: 'KS' })] })
    assert((await googleGeocoder(CV62026)).kind === 'not_found', 'same city name in another state (Edwardsville, KS) → rejected')

    byPin(EMPTY, { status: 'OK', results: [place(COUGAR, { zip: '62026', city: 'SIUE' })] })
    assert((await googleGeocoder(CV62026)).kind === 'found', 'fallback in the typed ZIP but a different locality name → accepted')

    byPin(EMPTY, { status: 'OK', results: [{ geometry: { location: COUGAR, location_type: 'ROOFTOP' } }] })
    assert((await googleGeocoder(CV62026)).kind === 'not_found', 'fallback result with no address components → rejected (cannot prove where it is)')

    byPin(EMPTY, EMPTY)
    assert((await googleGeocoder(CV62026)).kind === 'not_found', 'both searches empty → not_found')
    byPin(EMPTY, { status: 'OVER_QUERY_LIMIT' })
    assert((await googleGeocoder(CV62026)).kind === 'unavailable', 'fallback search errors → unavailable (fail closed)')

    urls.length = 0
    byPin({ status: 'OK', results: [place(EDWARDSVILLE, { zip: '62026', city: 'Edwardsville', type: 'RANGE_INTERPOLATED' })] }, { status: 'OK', results: [] })
    const pinnedHit = await googleGeocoder(ADDR)
    assert(urls.length === 1 && pinnedHit.kind === 'found' && pinnedHit.point.precision === 'RANGE_INTERPOLATED',
      'pinned search finds it → one request, precision kept (no fallback, no downgrade)')

    // Through the decision: the Collinsville test fair (10 km) — Cougar Village is ~15 km out.
    const COLLINSVILLE: FairDeliveryArea = { eventLat: 38.6703, eventLng: -89.9845, homeDeliveryRadiusKm: 20 }
    byPin(EMPTY, { status: 'OK', results: [place(COUGAR, { zip: '62025', city: 'Edwardsville' })] })
    const d = await decideDeliveryRadius(COLLINSVILLE, CV62026, googleGeocoder)
    assert(d.ok === true && d.approximate === true, 'decision on a fallback point → ok and flagged approximate (runner sees "check the written address")')

    // The typed address is what the order stores; the geocoder returns a point, never text.
    const orderSrc = stripComments(readFileSync('app/api/orders/route.ts', 'utf8'))
    assert(/deliveryStreet:\s*deliveryStreet\?\.trim\(\)/.test(orderSrc) && /deliveryCity:\s*deliveryCity\?\.trim\(\)/.test(orderSrc) && /deliveryZip:\s*deliveryZip\?\.trim\(\)/.test(orderSrc),
      'order stores street, city and ZIP exactly as typed (trimmed)')
    assert(!/formatted_address|address_components/.test(orderSrc), 'order route never reads Google’s formatted address or components')
    assert(cv.kind === 'found' && Object.keys(cv.point).sort().join() === 'lat,lng,precision', 'a found result carries only lat, lng, precision — no address text to overwrite with')
  } finally {
    globalThis.fetch = realFetch
    if (realKey === undefined) delete process.env.GOOGLE_GEOCODING_API_KEY
    else process.env.GOOGLE_GEOCODING_API_KEY = realKey
  }

  console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} delivery-radius-guard: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
