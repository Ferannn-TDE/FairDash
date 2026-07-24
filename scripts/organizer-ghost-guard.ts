/**
 * ORGANIZER-GHOST GUARD — every order aggregate an ORGANIZER reads excludes voided orders.
 *
 * The defect, on its sixth surface: a voided order (`Order.voidedAt`) is out of model but keeps
 * its status and total, so any aggregate that forgets to exclude it counts struck test rows as
 * real work and real money. Measured on the live fair BEFORE this landed — on the dashboard a
 * PAYING CUSTOMER reads:
 *
 *     orders today   377 → 152        live orders      92 → 4
 *     completed      215 → 136        revenue     $12,748.13 → $8,946.35
 *
 * ~30% of the organizer's headline revenue was deleted test orders.
 *
 * WHY A SCANNER AND NOT SIX ASSERTIONS: these six routes share no query helper — 22 separate
 * `db.order` calls — so the risk isn't "someone removes the clause", it's "someone adds a
 * 23rd query and forgets". This walks EVERY db.order aggregate in those files and requires the
 * shared IN_MODEL_ORDERS fragment inside its own where block, so a new query fails by default.
 * Matching the SHAPE of the call, not a filename or an identifier list, is deliberate: guards
 * keyed on locations have broken twice in this codebase when code moved or got aliased.
 *
 *   [0] POSITIVE CONTROLS (first) — the scanner flags a planted unguarded aggregate and does
 *       NOT flag a guarded one, so a broken parser cannot pass this suite vacuously.
 *   [1] EVERY organizer order aggregate carries the fragment.
 *   [2] The fragment means what it says (voidedAt: null) and is defined once.
 *
 * Pure file-reader. Run:  npx tsx scripts/organizer-ghost-guard.ts
 */

import { readFileSync } from 'node:fs'
import { IN_MODEL_ORDERS } from '../lib/order-scope'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const SURFACES = [
  'app/api/organizer/fairs/[fairSlug]/dashboard/route.ts',
  'app/api/organizer/fairs/[fairSlug]/analytics/route.ts',
  'app/api/organizer/fairs/[fairSlug]/analytics/revenue/route.ts',
  'app/api/organizer/stats/route.ts',
  'app/api/organizer/orders/route.ts',
  'app/api/organizer/vendors/route.ts',
  // A SEVENTH surface the sweep turned up: organizer vendor-detail, which sums vendorPayout.
  // Left unfiltered it would contradict the now-correct dashboard — worse than either alone.
  'app/api/organizer/vendors/[id]/route.ts',
]

/**
 * Find each `db.order.<agg>({ … })` call and return its source slice, by brace-matching from the
 * opening `{` so a nested where/select can't truncate the span.
 */
function orderAggregates(src: string): { start: number; body: string }[] {
  const out: { start: number; body: string }[] = []
  const re = /db\.order\.(count|aggregate|groupBy|findMany|findFirst)\(\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 1
    let i = m.index + m[0].length
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    out.push({ start: m.index, body: src.slice(m.index, i) })
  }
  return out
}

/** Guarded = the shared fragment appears in the call, or the call's where is a named base that carries it. */
const isGuarded = (body: string, src: string) => {
  if (/IN_MODEL_ORDERS/.test(body)) return true
  // `where: baseWhere` / `where: { ...baseWhere, … }` — follow the named base one level.
  const named = body.match(/where:\s*\{?\s*\.\.\.?([A-Za-z_][A-Za-z0-9_]*)/)?.[1]
                ?? body.match(/where:\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/)?.[1]
  if (!named) return false
  const decl = src.match(new RegExp(`const ${named}\\s*[:=][\\s\\S]{0,400}?\\n\\s*\\}`))?.[0] ?? ''
  return /IN_MODEL_ORDERS/.test(decl)
}

console.log('[0] positive controls')
const PLANTED_BAD  = 'db.order.count({ where: { eventId, status: { in: LIVE } } })'
const PLANTED_GOOD = 'db.order.count({ where: { ...IN_MODEL_ORDERS, eventId } })'
assert(orderAggregates(PLANTED_BAD).length === 1, 'the scanner finds an aggregate at all')
assert(!isGuarded(orderAggregates(PLANTED_BAD)[0].body, PLANTED_BAD), 'a planted UNGUARDED aggregate is flagged')
assert(isGuarded(orderAggregates(PLANTED_GOOD)[0].body, PLANTED_GOOD), 'a planted GUARDED aggregate is NOT flagged')
const PLANTED_BASE = 'const baseWhere = {\n  ...IN_MODEL_ORDERS,\n  eventId,\n}\ndb.order.count({ where: baseWhere })'
assert(isGuarded(orderAggregates(PLANTED_BASE)[0].body, PLANTED_BASE), 'a named base carrying the fragment counts as guarded')

console.log('\n[1] every organizer order aggregate excludes ghosts')
let total = 0
for (const f of SURFACES) {
  const src = readFileSync(f, 'utf8')
  const aggs = orderAggregates(src)
  const bad = aggs.filter(a => !isGuarded(a.body, src))
  total += aggs.length
  bad.forEach(b => console.log(`     ✗ ${f} @ char ${b.start}: ${b.body.slice(0, 90).replace(/\s+/g, ' ')}…`))
  assert(aggs.length > 0, `${f.split('/').slice(-2).join('/')} — found ${aggs.length} order aggregate(s) to check`)
  assert(bad.length === 0, `${f.split('/').slice(-2).join('/')} — all ${aggs.length} carry IN_MODEL_ORDERS`)
}
assert(total >= 20, `scanned the whole set (${total} aggregates — not an empty walk)`)

console.log('\n[2] the fragment is one definition and means what it says')
assert(JSON.stringify(IN_MODEL_ORDERS) === '{"voidedAt":null}', 'IN_MODEL_ORDERS is exactly { voidedAt: null }')
// Code only — the module's own comment explains why there is no opt-in here, and a scanner that
// can't tell code from its rationale would force that explanation to be deleted to stay green.
const lib = readFileSync('lib/order-scope.ts', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
assert(/export const IN_MODEL_ORDERS/.test(lib), 'defined once, in lib/order-scope')
assert(!/includeVoided/.test(lib),
  'no opt-in on the organizer side — an organizer never needs revenue including struck orders (that opt-in lives on the admin log)')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} organizer-ghost-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
