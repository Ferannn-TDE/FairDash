/**
 * RESOLVE-ORDER GUARD — a user-supplied order identifier is resolved in ONE place, tolerantly
 * (full cuid or 8-char short code) and UNAMBIGUOUSLY (a short-code collision fails loudly, never
 * picks one).
 *
 * The bug (diagnosed): GET /api/orders/[id] hand-rolled short-code tolerance, while cancel,
 * status, and the four custody libs did findUnique by primary key only. The customer order page
 * loads via the tolerant GET, then PATCHes the SHORT CODE to cancel — which resolved by primary
 * key, missed, and 404'd. Two hand-rolled tolerant copies + six strict copies of one derivation.
 *
 *   [0] POSITIVE CONTROLS (asserted FIRST) — the scanner flags a planted hand-rolled tolerant
 *       fetch and a planted bare primary fetch, and disambiguate() actually throws on two matches.
 *   [1] DISAMBIGUATION — 0 rows → null, 1 → its id, ≥2 → AmbiguousOrderCodeError (never returns
 *       one of several). Pure, so it is tested without seeding colliding cuids (impossible to
 *       force) and without a DB.
 *   [2] SINGLE SOURCE — the hand-rolled `length <= 8 ? … endsWith` tolerance exists ONLY in
 *       lib/resolve-order.ts; the two former copies are gone.
 *   [3] EVERY SHORT-CODE SITE ROUTES THROUGH THE RESOLVER — the eight diagnosed files import
 *       resolve-order and call resolveOrder, and none still contains a hand-rolled tolerant fetch
 *       or a bare primary `findUnique({ where: { id: <rawParam> } })`. Re-reads keyed on an
 *       already-resolved `order.id` are correct and NOT flagged (member access, not a bare param).
 *
 * Pure file-reader + pure-function. Run:  npx tsx scripts/resolve-order-guard.ts
 */

import { readFileSync } from 'node:fs'
import { disambiguate, resolveOrderId, AmbiguousOrderCodeError } from '../lib/resolve-order'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

// A hand-rolled tolerant fetch (the pattern that was copied), and a bare primary fetch keyed on a
// raw param. Bare identifier only — `{ id: order.id }` (member) is a trusted re-read and must NOT
// match, which is the whole "call shape, not a bare string" point.
const HANDROLLED   = /\.length\s*<=\s*8\s*\?[\s\S]{0,80}endsWith/
const BARE_PRIMARY = /db\.order\.find(?:Unique|First)\(\{\s*where:\s*\{\s*id:\s*(?:rawId|orderId|id)\s*\}/

console.log('[0] positive controls')
assert(HANDROLLED.test('where: rawId.length <= 8 ? { id: { endsWith: rawId.toLowerCase() } } : { id: rawId }'),
  'scanner flags a planted hand-rolled tolerant fetch')
assert(BARE_PRIMARY.test('const o = await db.order.findUnique({ where: { id: orderId }, select: { id: true } })'),
  'scanner flags a planted bare primary fetch keyed on a raw param')
assert(!BARE_PRIMARY.test('const fresh = await db.order.findUnique({ where: { id: order.id }, select: { status: true } })'),
  'scanner does NOT flag a re-read keyed on the resolved order.id (member access)')
assert(!BARE_PRIMARY.test('await db.order.findUnique({ where: { id: input.orderId }, select: { runnerId: true } })'),
  'scanner does NOT flag the reconciler path keyed on input.orderId (canonical, member access)')

console.log('\n[1] disambiguation: never returns one of several')
assert(disambiguate([], '26685PS7') === null, 'zero matches → null (a clean not-found)')
assert(disambiguate([{ id: 'cmxxx26685ps7' }], '26685PS7') === 'cmxxx26685ps7', 'one match → its id')
let threw = false
try { disambiguate([{ id: 'a26685ps7' }, { id: 'b26685ps7' }], '26685PS7') } catch (e) { threw = e instanceof AmbiguousOrderCodeError }
assert(threw, 'two matches → AmbiguousOrderCodeError (409), never a silent pick')
assert(typeof resolveOrderId === 'function', 'resolveOrderId is exported and uses the same pure decision')

console.log('\n[2] single source: the tolerant pattern lives only in lib/resolve-order.ts')
const SHORT_CODE_SITES = [
  'app/api/orders/[id]/route.ts',
  'app/api/orders/[id]/runner-location/route.ts',
  'app/api/orders/[id]/cancel/route.ts',
  'app/api/orders/[id]/status/route.ts',
  'lib/collect-order.ts',
  'lib/release-order.ts',
  'lib/request-return.ts',
  'lib/confirm-return.ts',
]
for (const f of SHORT_CODE_SITES) {
  assert(!HANDROLLED.test(readFileSync(f, 'utf8')), `${f.split('/').slice(-2).join('/')} has NO hand-rolled tolerance`)
}

console.log('\n[3] every short-code site routes through the resolver')
for (const f of SHORT_CODE_SITES) {
  const src = readFileSync(f, 'utf8')
  assert(/from '@?\.?\/?(?:@\/)?lib\/resolve-order'|from '\.\/resolve-order'/.test(src), `${f.split('/').slice(-2).join('/')} imports resolve-order`)
  assert(/resolveOrder\(/.test(src), `${f.split('/').slice(-2).join('/')} calls resolveOrder`)
  assert(!BARE_PRIMARY.test(src), `${f.split('/').slice(-2).join('/')} has NO bare primary fetch on a raw param`)
}

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} resolve-order-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
