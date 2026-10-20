/**
 * ORDER MAP CENTRE GUARD (readiness 1.5) — the order page's map shows a real place or no map.
 *
 * The bug: getMapEmbedUrl sent Google free text ("Fair grounds", "<vendor> booth 12", or a
 * street with no state). Google can't place those, so the embedded map opened on a vague match
 * or the whole globe.
 *
 *   [1] centre: stored delivery coordinates → that point; otherwise the fair's coordinates;
 *       otherwise none.
 *   [2] url: always `q=<lat>,<lng>` (numbers, never text), zoom 15; null when there's no centre.
 *   [3] wiring: the order API returns the fair's coordinates, the page renders no map without a
 *       centre, and no free-text query remains.
 *
 * Pure + source scans. Run:  npx tsx scripts/order-map-center-guard.ts
 */

import { readFileSync } from 'node:fs'
import { stripComments } from './_strip-comments'
import { orderMapCenter, getMapEmbedUrl } from '../components/order/helpers'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const FAIR = { eventLat: 38.6703, eventLng: -89.9845 }
const base = { fulfillmentType: 'HOME_DELIVERY', deliveryStreet: '125 W Main St', deliveryCity: 'Collinsville', deliveryZip: '62234', vendor: { id: 'v', name: 'Booth', boothNumber: '12' } }
const o = (x: Record<string, unknown>) => ({ ...base, ...x }) as never

console.log('[1] centre')
assert(JSON.stringify(orderMapCenter(o({ deliveryLat: 38.671, deliveryLng: -89.98, event: FAIR }))) === JSON.stringify({ lat: 38.671, lng: -89.98, source: 'delivery' }),
  'delivery order with stored coordinates → the delivery point')
assert(JSON.stringify(orderMapCenter(o({ deliveryLat: null, deliveryLng: null, event: FAIR }))) === JSON.stringify({ lat: FAIR.eventLat, lng: FAIR.eventLng, source: 'fair' }),
  'delivery order from before coordinates were stored → the fair')
assert(orderMapCenter(o({ fulfillmentType: 'PICKUP', deliveryLat: 1, deliveryLng: 1, event: FAIR }))?.source === 'fair',
  'pickup order → the fair (never a stale delivery point)')
assert(orderMapCenter(o({ deliveryLat: null, deliveryLng: null, event: { eventLat: null, eventLng: null } })) === null, 'no coordinates anywhere → no centre')
assert(orderMapCenter(o({ deliveryLat: null, deliveryLng: null })) === null, 'no fair on the payload → no centre')
assert(orderMapCenter(o({ deliveryLat: 38.6, deliveryLng: null, event: FAIR }))?.source === 'fair', 'half a delivery coordinate → falls back to the fair')
assert(orderMapCenter(o({ deliveryLat: 0, deliveryLng: 0, event: FAIR }))?.source === 'fair', '0,0 (Null Island) is treated as missing, not a place')

console.log('[2] url')
const url = getMapEmbedUrl(o({ deliveryLat: 38.671, deliveryLng: -89.98, event: FAIR }))
const q = url ? new URL(url).searchParams : null
assert(q?.get('q') === '38.671,-89.98' && q?.get('z') === '15' && q?.get('output') === 'embed', `embed is a numeric point at zoom 15 (got ${url})`)
assert(getMapEmbedUrl(o({ deliveryLat: null, deliveryLng: null, event: { eventLat: null, eventLng: null } })) === null, 'no centre → null (the page shows no map)')
for (const x of [o({ event: FAIR }), o({ fulfillmentType: 'PICKUP', event: FAIR })]) {
  const s = new URL(getMapEmbedUrl(x)!).searchParams.get('q') ?? ''
  assert(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(s), `query is coordinates, never text (got "${s}")`)
}

console.log('[3] wiring')
const helpers = stripComments(readFileSync('components/order/helpers.ts', 'utf8'))
assert(!/Fair grounds|booth \$\{|deliveryStreet\}/.test(helpers), 'no free-text map query remains ("Fair grounds", booth, street)')
const route = stripComments(readFileSync('app/api/orders/[id]/route.ts', 'utf8'))
assert(/event:\s*\{\s*select:\s*\{\s*eventLat:\s*true,\s*eventLng:\s*true\s*\}\s*\}/.test(route), 'the order API returns the fair\'s coordinates')
const page = stripComments(readFileSync('components/order/SingleOrderTracking.tsx', 'utf8'))
assert(/mapSrc\s*&&/.test(page) && /getMapEmbedUrl\(order\)/.test(page), 'the page renders the map only when there is a centre')
const types = readFileSync('components/order/types.ts', 'utf8')
assert(/deliveryLat\?: number \| null/.test(types) && /eventLat: number \| null/.test(types), 'the Order type carries both coordinate pairs')

console.log(`\n${fail === 0 ? '✅' : '❌'} order-map-center: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
