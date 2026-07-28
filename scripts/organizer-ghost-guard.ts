/**
 * ORGANIZER-GHOST GUARD — every order aggregate a MONEY-FACING surface reads excludes voided orders.
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
 * WHY A SCANNER AND NOT N ASSERTIONS: these surfaces share no query helper — dozens of separate
 * `db.order` calls — so the risk isn't "someone removes the clause", it's "someone adds one more
 * and forgets". Matching the SHAPE of the call, not a filename or an identifier list, is
 * deliberate: guards keyed on locations have broken twice in this codebase when code moved.
 *
 * ── WHAT CHANGED: A FIXED LIST BECAME A WALK ─────────────────────────────────────────────────
 * This used to scan ten hand-listed files. A hand-listed surface cannot see the surface nobody
 * remembered to add, and it did not: the walk found THREE live violations on its first run, all
 * organizer/vendor-facing revenue (see the fixes in this commit). The walk is the point — the
 * machinery below exists only to make a walk over the whole repo survivable.
 *
 * EVERY order aggregate found must fall in EXACTLY ONE bucket, or the suite fails:
 *
 *   1. GUARDED         — carries IN_MODEL_ORDERS (or a named base that does). The target state.
 *   2. MUST_NOT_FILTER — must NEVER carry the filter; money/audit paths that have to see voided
 *                        rows. Named + reasoned, because the obvious "fix" here loses money.
 *   3. GRANDFATHERED   — semantically correct but spelled `voidedAt: null` by hand instead of the
 *                        shared constant. Declared DEBT, not absolution. Passes; expected to shrink.
 *   4. PENDING_DISPOSITION — surfaced by the walk, disposition NOT yet decided. Parked visibly so
 *                        the decision is owed by a human, not silently made by whoever wrote this.
 *
 * A new aggregate in none of the four FAILS. That is the whole mechanism: declared passes,
 * silent fails — the same shape as scripts/invariant-guard-refs.ts.
 *
 * WHY GRANDFATHER RATHER THAN REFACTOR: loosening the guard to accept a literal `voidedAt: null`
 * would abandon the single-source property PROJECT_INVARIANTS.md:44 asserts (lib/order-scope is
 * THE definition of in-model). Refactoring ~20 call sites would roughly double a commit that is
 * otherwise mechanical, days before a live fair. The set preserves the invariant and keeps the
 * change reviewable.
 *
 *   [0] POSITIVE CONTROLS (first) — the scanner flags a planted unguarded aggregate and does
 *       NOT flag a guarded one, so a broken parser cannot pass this suite vacuously.
 *   [1] THE WALK — every aggregate in the tree lands in exactly one bucket.
 *   [1b] MUST_NOT_FILTER really doesn't filter (a regression alarm, not a style rule).
 *   [1c] GRANDFATHERED really still filters — by hand. This is what makes the set load-bearing
 *        rather than decorative: delete the literal and the entry stops being true.
 *   [1d] the lists are alive — no entry naming a file with nothing to check.
 *   [2] the fragment means what it says (voidedAt: null) and is defined once.
 *
 * Pure file-reader. Run:  npx tsx scripts/organizer-ghost-guard.ts
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { IN_MODEL_ORDERS } from '../lib/order-scope'
import { stripComments } from './_strip-comments'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

// ── THE WALK SURFACE ──────────────────────────────────────────────────────────────────────────
// Roots that contain production reads. NOT scripts/ — a guard that reads its own source finds the
// planted positive controls below and reports itself as a violation.
const ROOTS = ['lib', 'app']
const SKIP_DIRS = new Set([
  'node_modules',  // dependencies
  '.next',         // build output — compiled copies of the same code, scanned twice otherwise
  'mock',          // lib/mock/* — fixtures, no db access
  '__tests__', '__mocks__', // fixtures
])

/**
 * THE DELIBERATE EXCLUSIONS — queries that MUST NOT carry the ghost filter, named with the reason.
 *
 * This list is the point of the section. Without it the exclusion is invisible, and the obvious
 * "fix" the next time one of these surfaces a failure is to add IN_MODEL_ORDERS — which on the
 * Stripe webhook means a payment for an order that was later voided can no longer be found, so it
 * never reconciles. That is real money lost to a well-meaning edit. Naming them turns the omission
 * into a recorded decision.
 *
 * If you are here because one of these is "missing" the filter: it is not missing. Read the reason.
 */
const MUST_NOT_FILTER: { file: string; why: string }[] = [
  { file: 'app/api/webhooks/stripe/route.ts',
    why: 'must find ANY order to reconcile a payment — a voided order still has a real charge' },
  { file: 'lib/process-chargeback.ts',
    why: 'settlement: a chargeback on an order voided after payment must still claw back' },
  { file: 'lib/resolve-order.ts',
    why: 'resolves an identifier to a row; the CALLER decides what is in model' },
  { file: 'app/api/runners/me/location/route.ts',
    why: 'operational lookup for a runner already holding the order, not an aggregate' },
  // ── Added by the walk (were invisible to the fixed list) ──
  { file: 'app/api/organizer/fairs/[fairSlug]/chargebacks/[chargebackId]/route.ts',
    why: 'settlement: the at-fault-vendor check must find items on an order voided after the dispute' },
  { file: 'lib/stuck-payouts.ts',
    why: 'the stuck-payout READER — a failed payout on a later-voided order is still money that did not move; hiding it would erase the very rows an admin must resolve (same stance as the money/audit paths above)' },
  { file: 'app/account/orders/[orderId]/page.tsx',
    why: "a customer's OWN order detail — a voided order must still render for its buyer, not 404 (same stance as resolve-order)" },
]

/**
 * DECLARED DEBT — correct behaviour, wrong spelling. Each filters by hand (`voidedAt: null`)
 * instead of the shared IN_MODEL_ORDERS. Passing here is a decision to defer the refactor, not a
 * claim that nothing is owed. [1c] proves each one STILL filters, so the entry cannot rot into a
 * blanket exemption.
 *
 * `proofIn` names where the literal actually lives when the filter arrives through a shared
 * predicate — without it, a route that correctly composes an imported scope would look unfiltered.
 */
const GRANDFATHERED: { file: string; why: string; proofIn?: string }[] = [
  { file: 'lib/reconciler.ts',
    why: 'MIXED BY DESIGN — repair patterns must see voided rows, reporting patterns filter. File-level is the wrong granularity here; the least confident entry in this list' },
  { file: 'lib/fair-orders.ts',
    why: 'filters through baseWhere with a documented includeVoided OPT-IN (:104) — the admin audit path needs voided rows by name' },
  { file: 'lib/fair-vendors.ts',      why: "literal voidedAt: null on each of the three vendor-card aggregates" },
  { file: 'lib/admin-fair-reports.ts', why: 'literal voidedAt: null on the report aggregate (:79)' },
  { file: 'lib/strand-escalation.ts', why: 'literal voidedAt: null on both strand scans' },
  { file: 'lib/tip-refund.ts',        why: 'literal voidedAt: null on the owed-back tip scan' },
  { file: 'lib/runner-completion.ts', why: 'filters through the local orderScope const (:104)' },
  { file: 'lib/vendor-order-history.ts', why: 'filters through vendorOrderScope() (:66) — a shared predicate, exported' },
  { file: 'app/api/admin/events/[id]/dashboard/route.ts', why: 'literal voidedAt: null on all four admin aggregates' },
  { file: 'app/api/admin/events/[id]/money/route.ts',     why: 'literal voidedAt: null on the pre-accrual estimate' },
  { file: 'app/api/admin/events/[id]/revenue/route.ts',   why: 'literal voidedAt: null on the revenue chart' },
  { file: 'app/api/runners/me/orders/route.ts',
    why: 'composes runnerFeedWhere / runnerOrderDetailWhere, which carry the filter', proofIn: 'lib/runner-feed.ts' },
  { file: 'app/api/vendors/[id]/orders/active/route.ts',
    why: 'composes vendorOrderScope, which carries the filter', proofIn: 'lib/vendor-order-history.ts' },
]

/**
 * DECIDED IN PRINCIPLE, UNIMPLEMENTED IN FACT — not "nobody has thought about this".
 *
 * The rule is already written down at CURRENT_STATE.md:395-398: do NOT just filter, because a
 * voided order the customer PAID FOR vanishing looks like it never existed. The disposition keys
 * on WHETHER MONEY MOVED — visible (marked voided, with refund state) if there was a charge,
 * hidden if not. Neither bucket above expresses that: it is a product change, not a where-clause.
 *
 * So these sites are correct to be unfiltered TODAY, and adding IN_MODEL_ORDERS here would be a
 * regression against a recorded decision. They print ⏳ every run so the gap stays visible
 * without being mistaken for an open question. NOT pre-fair work: a customer seeing a stale order
 * in their own history is cosmetic; the organizer/vendor revenue inflation this guard fixed was
 * money.
 */
const PENDING_DISPOSITION: { file: string; rule: string }[] = [
  { file: 'app/api/orders/history/route.ts',
    rule: 'CURRENT_STATE.md:395 — show-if-charged / hide-if-not; do NOT blanket-filter (a paid order must not vanish)' },
  { file: 'app/api/orders/recent/route.ts',
    rule: 'CURRENT_STATE.md:395 — same rule, on the 30-day recent-orders list' },
]

// ── SCANNER ───────────────────────────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * Find each `db.order.<agg>({ … })` call and return its source slice, by brace-matching from the
 * opening `{` so a nested where/select can't truncate the span.
 *
 * Operates on COMMENT-STRIPPED source. Widening made this mandatory: a commented-out
 * `db.order.count({…})` anywhere in the tree would otherwise be scanned as a live aggregate and
 * reported as a violation, which pressures the next person to delete the explanation to stay
 * green (guards-scan-code-not-prose, PROJECT_INVARIANTS.md:245). The stripper is
 * position-preserving, so the `@ char N` coordinates below still point at the real file.
 */
function orderAggregates(src: string): { start: number; body: string }[] {
  const out: { start: number; body: string }[] = []
  const re = /db\.(?:order|orderItem)\.(count|aggregate|groupBy|findMany|findFirst)\(\s*\{/g
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

/**
 * Guarded = the shared fragment appears in the call, or the call's where is a named base that
 * carries it. STRICT on purpose: a hand-written `voidedAt: null` does NOT count. That is what
 * keeps lib/order-scope the single source; the sites that spell it by hand are declared debt
 * in GRANDFATHERED, not quietly accepted here.
 */
const isGuarded = (body: string, src: string) => {
  if (/IN_MODEL_ORDERS/.test(body)) return true
  // `where: baseWhere` / `where: { ...baseWhere, … }` — follow the named base one level.
  const named = body.match(/where:\s*\{?\s*\.\.\.?([A-Za-z_][A-Za-z0-9_]*)/)?.[1]
                ?? body.match(/where:\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/)?.[1]
  if (!named) return false
  const decl = src.match(new RegExp(`const ${named}\\s*[:=][\\s\\S]{0,400}?\\n\\s*\\}`))?.[0] ?? ''
  return /IN_MODEL_ORDERS/.test(decl)
}

const lineOf = (src: string, at: number) => src.slice(0, at).split('\n').length
const short = (f: string) => f.split('/').slice(-2).join('/')

// ── [0] POSITIVE CONTROLS ─────────────────────────────────────────────────────────────────────
console.log('[0] positive controls')
const PLANTED_BAD  = 'db.order.count({ where: { eventId, status: { in: LIVE } } })'
const PLANTED_GOOD = 'db.order.count({ where: { ...IN_MODEL_ORDERS, eventId } })'
assert(orderAggregates(PLANTED_BAD).length === 1, 'the scanner finds an aggregate at all')
assert(!isGuarded(orderAggregates(PLANTED_BAD)[0].body, PLANTED_BAD), 'a planted UNGUARDED aggregate is flagged')
assert(isGuarded(orderAggregates(PLANTED_GOOD)[0].body, PLANTED_GOOD), 'a planted GUARDED aggregate is NOT flagged')
const PLANTED_BASE = 'const baseWhere = {\n  ...IN_MODEL_ORDERS,\n  eventId,\n}\ndb.order.count({ where: baseWhere })'
assert(isGuarded(orderAggregates(PLANTED_BASE)[0].body, PLANTED_BASE), 'a named base carrying the fragment counts as guarded')
// STRICTNESS is itself load-bearing — if a hand-written literal counted as guarded, the whole
// grandfather mechanism would be pointless and the single-source property would be unenforced.
const PLANTED_LITERAL = 'db.order.count({ where: { voidedAt: null, eventId } })'
assert(!isGuarded(orderAggregates(PLANTED_LITERAL)[0].body, PLANTED_LITERAL),
  'a hand-written `voidedAt: null` does NOT count as guarded (strict — that is what GRANDFATHERED is for)')
// The stripper must actually hide commented-out code from the walk.
const PLANTED_COMMENT = '// db.order.count({ where: { eventId } })\nconst x = 1'
assert(orderAggregates(stripComments(PLANTED_COMMENT)).length === 0,
  'a COMMENTED-OUT aggregate is invisible to the walk (comments are stripped)')

// ── [1] THE WALK ──────────────────────────────────────────────────────────────────────────────
console.log('\n[1] every order aggregate in lib/ + app/ lands in exactly one declared bucket')
const mustNot = new Map(MUST_NOT_FILTER.map(e => [e.file, e]))
const grand   = new Map(GRANDFATHERED.map(e => [e.file, e]))
const pending = new Map(PENDING_DISPOSITION.map(e => [e.file, e]))

assert([...grand.keys()].every(f => !mustNot.has(f)),
  'no file is in BOTH must-not-filter and grandfathered (the buckets are exclusive)')
assert([...pending.keys()].every(f => !mustNot.has(f) && !grand.has(f)),
  'no file is pending AND already bucketed')

const files = ROOTS.flatMap(r => walk(r))
const withAggs: string[] = []
let totalAggs = 0, guardedFiles = 0
const violations: string[] = []

for (const f of files) {
  const src = stripComments(readFileSync(f, 'utf8'))
  const aggs = orderAggregates(src)
  if (aggs.length === 0) continue
  withAggs.push(f)
  totalAggs += aggs.length
  if (mustNot.has(f) || grand.has(f) || pending.has(f)) continue // checked in [1b]/[1c]/[1d]
  guardedFiles++
  for (const a of aggs) {
    if (!isGuarded(a.body, src)) {
      violations.push(`${f}:${lineOf(src, a.start)} — ${a.body.slice(0, 80).replace(/\s+/g, ' ')}…`)
    }
  }
}

violations.forEach(v => console.log(`     ✗ ${v}`))
assert(violations.length === 0,
  `every aggregate on an undeclared surface carries IN_MODEL_ORDERS (${guardedFiles} files checked strictly)`)
// Anti-vacuity: a walk that found nothing would pass the line above trivially.
assert(totalAggs >= 60, `the walk actually walked (${totalAggs} aggregates across ${withAggs.length} files)`)
assert(withAggs.length >= 25, `and reached the whole tree (${withAggs.length} files with order aggregates)`)

console.log('\n[1b] the deliberate exclusions are still excluded (and still named)')
for (const { file, why } of MUST_NOT_FILTER) {
  const src = stripComments(readFileSync(file, 'utf8'))
  // Not a style rule — a REGRESSION alarm. If one of these grows the filter, money stops
  // reconciling, so it fails here with the reason attached rather than in production.
  assert(!/IN_MODEL_ORDERS/.test(src), `${short(file)} must NOT filter ghosts — ${why}`)
}

console.log('\n[1c] the grandfathered set is DEBT, not absolution — each one still filters by hand')
for (const { file, why, proofIn } of GRANDFATHERED) {
  const proof = stripComments(readFileSync(proofIn ?? file, 'utf8'))
  // THE LOAD-BEARING ASSERTION. Without it, "grandfathered" would decay into "exempt": delete the
  // literal filter and the file would still pass merely by being on the list. This is what makes
  // removing a name from the list a real failure rather than a formality.
  assert(/voidedAt:\s*null/.test(proof),
    `${short(file)} still filters by hand${proofIn ? ` (via ${short(proofIn)})` : ''} — ${why}`)
}

console.log('\n[1d] the lists are alive — every entry names a file that exists and has something to check')
for (const { file } of [...MUST_NOT_FILTER, ...GRANDFATHERED, ...PENDING_DISPOSITION]) {
  assert(existsSync(file), `${short(file)} exists (a stale entry is a silent hole)`)
}
const stale = [...mustNot.keys(), ...grand.keys(), ...pending.keys()].filter(f => !withAggs.includes(f))
stale.forEach(f => console.log(`     ✗ ${f} is declared but has NO order aggregate — dead entry`))
assert(stale.length === 0, 'no declared entry is dead weight (each still has an aggregate to excuse)')
PENDING_DISPOSITION.forEach(p => console.log(`     ⏳ DEFERRED (rule exists, unimplemented) — ${p.file}\n        ${p.rule}`))

// ── [1e] NAMED SINGLE-SITE ASSERTIONS — beyond the scanner's reach, still guarded ─────────────
// The scanner keys on `db.order` / `db.orderItem`. Some sites in the same defect class use a
// different model and are therefore invisible to it. Widening the regex to a new model would pull
// a whole aggregate class repo-wide into scope, whose noise floor is unknown — not a thing to
// discover during fair prep. So the reach gap is closed one NAMED site at a time instead: cheap,
// no new class, and the specific fix that was just made cannot silently regress.
console.log('\n[1e] named single-site assertions (same defect class, outside the scanner\'s model reach)')
const NAMED_SITES: { file: string; needle: RegExp; why: string }[] = [
  {
    file: 'app/api/orders/[id]/vendor-status/route.ts',
    // `db.vendorOrderStatus.count` — a different model, so orderAggregates() cannot see it.
    needle: /db\.vendorOrderStatus\.count\(\{[\s\S]{0,300}?order:\s*\{\s*\.\.\.IN_MODEL_ORDERS/,
    why: 'todayOrders feeds the SAME Firebase tile as todayRevenue (:281, which the walk does cover). '
       + 'Filtering one and not the other makes the vendor\'s live dashboard internally inconsistent — '
       + 'which reads as a bug somewhere else entirely, and costs more to chase than being wrong outright',
  },
]
for (const { file, needle, why } of NAMED_SITES) {
  const src = stripComments(readFileSync(file, 'utf8'))
  assert(needle.test(src), `${short(file)} — vendorOrderStatus count carries IN_MODEL_ORDERS. ${why}`)
}

console.log('\n[2] the fragment is one definition and means what it says')
assert(JSON.stringify(IN_MODEL_ORDERS) === '{"voidedAt":null}', 'IN_MODEL_ORDERS is exactly { voidedAt: null }')
// Code only — the module's own comment explains why there is no opt-in here, and a scanner that
// can't tell code from its rationale would force that explanation to be deleted to stay green.
const lib = stripComments(readFileSync('lib/order-scope.ts', 'utf8'))
assert(/export const IN_MODEL_ORDERS/.test(lib), 'defined once, in lib/order-scope')
assert(!/includeVoided/.test(lib),
  'no opt-in on the organizer side — an organizer never needs revenue including struck orders (that opt-in lives on the admin log)')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} organizer-ghost-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
