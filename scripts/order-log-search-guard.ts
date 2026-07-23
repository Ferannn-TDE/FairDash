/**
 * ORDER-LOG SEARCH GUARD — the admin order log searches and filters the WHOLE event on the
 * server, never a capped client-side page, and its empty state tells "no such order" apart from
 * "not loaded yet".
 *
 * The risk this pins: the log caps at 100 rows. A client-side filter over those 100 would return
 * empty for a code a customer reads aloud from two days ago — and render it as "no order found",
 * which during a fair is a lie that sends someone away. Search MUST hit the DB.
 *
 *   [0] POSITIVE CONTROLS (first) — the scanner flags a planted client-side filter-over-fetched
 *       pattern and a planted "no results" empty state that can't tell apart not-loaded.
 *   [1] LIB — getFairOrders searches id + customerName + vendor.name on the server, returns a
 *       real `total` via count(), and derives tab counts from the single TAB_STATUSES map. There
 *       is no status-based "refunded" tab (REFUNDED is not a master OrderStatus).
 *   [2] CLIENT — the page builds a server query from every filter (q, vendorId, type, tab, sort),
 *       debounces search, and does NOT filter/search the loaded array (no matchesTab, no
 *       client-side search filter). Vendor options come from a whole-event fetch, not the page.
 *   [3] EMPTY STATE — branches on the search term / active filter, so "No order matches …" (a
 *       real whole-event answer) is distinct from an unfiltered "No orders yet".
 *
 * Pure file-reader + pure-function. Run:  npx tsx scripts/order-log-search-guard.ts
 */

import { readFileSync } from 'node:fs'
import { TAB_STATUSES } from '../lib/fair-orders'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const lib  = readFileSync('lib/fair-orders.ts', 'utf8')
const page = readFileSync('app/admin/[eventSlug]/orders/page.tsx', 'utf8')

// A client-side search filter over the fetched array — the anti-pattern.
const CLIENT_SEARCH = /orders\s*\.filter\([^)]*\.(?:includes|toLowerCase)\(/
// An empty state that can't distinguish no-results from not-loaded (a bare "no orders found"
// with no branch on the search term).
const BLIND_EMPTY = /No orders found/

console.log('[0] positive controls')
assert(CLIENT_SEARCH.test('const list = orders.filter(o => o.id.toLowerCase().includes(q))'),
  'scanner flags a planted client-side search-over-fetched-array')
assert(!CLIENT_SEARCH.test('for (const o of orders) { out.push(o) }'),
  'scanner does NOT flag a presentational loop over orders (day grouping)')
assert(BLIND_EMPTY.test('<p>No orders found</p>'), 'scanner flags a planted blind empty state')

console.log('\n[1] lib: search + total + tab counts are server-side, one mapping')
assert(/opts\.search/.test(lib) && /customerName:\s*\{\s*contains/.test(lib) && /vendor:\s*\{\s*name:\s*\{\s*contains/.test(lib),
  'getFairOrders searches id + customerName + vendor.name on the server')
assert(/id:\s*\{\s*contains:\s*q\.toLowerCase\(\)/.test(lib), 'the short code (lowercased id tail) is part of the search')
assert(/db\.order\.count\(\{\s*where:\s*ordersWhere/.test(lib), 'a real total comes from count() over the same where')
assert(/export const TAB_STATUSES/.test(lib) && /tabCounts/.test(lib), 'tab counts derive from the single TAB_STATUSES map')
assert(!Object.keys(TAB_STATUSES).includes('refunded'), 'no "refunded" status tab (REFUNDED is not a master OrderStatus)')
assert(TAB_STATUSES.issues.includes('CANCELLED') && TAB_STATUSES.completed.includes('DELIVERED'), 'the tab map covers the real statuses')

console.log('\n[2] client: server-driven, debounced, no client-side filtering')
assert(!CLIENT_SEARCH.test(page), 'the page does NOT filter/search the loaded array')
assert(!/function matchesTab/.test(page), 'the client-side matchesTab is gone (status filtering is server-side)')
assert(/qp\.set\('q'|q:\s*urlSearch/.test(page) && /vendorId/.test(page) && /qp\.set\('cursor'/.test(page),
  'the fetch URL carries q, vendorId, and cursor — the server does the work')
assert(/setTimeout\(\s*\(\)\s*=>\s*setParam\(\{\s*q:/.test(page), 'the search input is debounced before it becomes a server query')
assert(/events\/\$\{params\.eventSlug\}\/vendors/.test(page), 'vendor options come from a whole-event fetch, not the loaded page')
assert(/Showing \$\{orders\.length\} of \$\{total\}/.test(page), 'the header reads "Showing X of N", not a capped count')
assert(/Load older orders/.test(page) && /nextCursor/.test(page), 'a "Load older" control pages through nextCursor')

console.log('\n[3] empty state distinguishes no-results from not-loaded')
assert(!BLIND_EMPTY.test(page), 'the blind "No orders found" empty state is gone')
assert(/No order matches/.test(page) && /urlSearch \?/.test(page), 'a searched empty state names the term (a real whole-event answer)')
assert(/No orders yet/.test(page), 'an UNfiltered empty state says "no orders yet" — not the same as a failed search')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} order-log-search-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
