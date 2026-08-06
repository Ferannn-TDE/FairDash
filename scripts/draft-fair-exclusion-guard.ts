/**
 * DRAFT FAIRS NEVER LEAK, AND CAN NEVER ACQUIRE A VENDOR OR RUNNER.
 *
 * TWO INVARIANTS, both structural, both the reason draft support is safe:
 *
 *   1. EXCLUSION. Every organizer event-LIST read goes through organizerFairScope(), which carries
 *      `archivedAt: null` AND `status: { not: DRAFT }`. The four sites that leaked before this
 *      change each hand-wrote `{ organizerId, archivedAt: null }` — four copies of one predicate
 *      with no shared source, which is precisely why a new status value leaked into all four at
 *      once. Adding `status: { not: 'DRAFT' }` inline per route would relocate that trap, not
 *      close it, and the NEXT status would leak the same way. So the rule is: no route may write
 *      the raw clause; they call the fragment.
 *
 *   2. ACQUISITION. Hard-deleting a draft is only defensible while a draft cannot hold a Vendor or
 *      Runner — both CASCADE on Event delete, so a person's record would vanish silently. Order is
 *      RESTRICT and protects money for free, but nothing protects those two except the gate.
 *
 * WHAT THIS CANNOT SEE: whether a query returns the right rows at runtime. It proves no reader
 * spells the exclusion itself and no attach path skips the gate — the two regressions that would
 * reintroduce the bug.
 *
 * Run: npx tsx scripts/draft-fair-exclusion-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EventStatus } from '@prisma/client'
import {
  organizerFairScope,
  organizerDraftScope,
} from '../lib/organizer-fair-context'
import { assertFairAcceptsJoins, fairAcceptsJoins, FAIR_NOT_JOINABLE } from '../lib/fair-join-gate'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/**
 * The RAW clause no reader may spell for itself. Shape-keyed: it matches the predicate, not a
 * filename, so a NEW route that copies the old pattern is caught the day it is written.
 */
const RAW_ORGANIZER_CLAUSE = /organizerId\s*,\s*archivedAt:\s*null/

/**
 * Named, reasoned exemptions. Anything not here must use the fragment. Each entry states WHY,
 * because an allowlist without reasons becomes a place to hide leaks.
 */
const ALLOWLIST: Record<string, string> = {
  'lib/organizer-fair-context.ts':
    'defines the fragment (and resolveOwnedFair, the singular resolver) — the one place the clause lives',
  'app/api/admin/fairs/route.ts':
    'admin fair list: unscoped BY DESIGN, a platform admin sees every fair including drafts',
  'app/api/events/route.ts':
    'super-admin events list: unscoped BY DESIGN',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

/** Strip comments — a doc block QUOTING the retired clause is not a reader spelling it.
 *  This codebase has been bitten by grepping prose four times; see test-probe-positive-control. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function main() {
  const files = [...walk('app'), ...walk('lib')].map(f => f.replace(/\\/g, '/'))

  // ── [0] PROBE BASELINE ──────────────────────────────────────────────────────
  console.log('\n[0] the detectors work at all (baseline — not a feature test)')
  assert(RAW_ORGANIZER_CLAUSE.test('where: { organizerId, archivedAt: null },'),
    'detects the raw hand-written clause that leaked')
  assert(!RAW_ORGANIZER_CLAUSE.test('where: organizerFairScope(organizerId),'),
    'does NOT fire on the fragment call — otherwise every fixed route would look broken')
  assert(files.length > 50, `the walker found source files (${files.length})`)

  // ── [1] THE FRAGMENT ACTUALLY EXCLUDES ──────────────────────────────────────
  console.log('\n[1] organizerFairScope excludes drafts AND archived fairs')
  const scope = organizerFairScope('org_1') as Record<string, unknown>
  assert(scope.organizerId === 'org_1', 'scopes to the owning organizer')
  assert(scope.archivedAt === null, 'still hides archived fairs (the exclusion it already carried)')
  assert(JSON.stringify(scope.status) === JSON.stringify({ not: EventStatus.DRAFT }),
    `excludes DRAFT (got ${JSON.stringify(scope.status)})`)
  const draftScope = organizerDraftScope('org_1') as Record<string, unknown>
  assert(draftScope.status === EventStatus.DRAFT, 'the drafts scope is its exact inverse — DRAFT only')
  assert(draftScope.archivedAt === null, 'the drafts scope still hides archived rows')

  // ── [2] ⛔ NO READER SPELLS THE CLAUSE ITSELF ───────────────────────────────
  console.log('\n[2] ⛔ every organizer event read uses the fragment, not a hand-written clause')
  const offenders: string[] = []
  for (const f of files) {
    if (ALLOWLIST[f]) continue
    const src = code(readFileSync(f, 'utf8'))
    src.split('\n').forEach((line, i) => {
      if (RAW_ORGANIZER_CLAUSE.test(line)) offenders.push(`${f}:${i + 1}`)
    })
  }
  assert(offenders.length === 0,
    offenders.length
      ? `HAND-WRITTEN SCOPE — use organizerFairScope(): ${offenders.join(', ')}`
      : 'no route hand-writes { organizerId, archivedAt: null }')

  // The four sites that leaked must each be provably ON the fragment now.
  const FORMERLY_LEAKING = [
    'app/api/organizer/fairs/route.ts',
    'app/api/organizer/stats/route.ts',
    'app/api/organizer/orders/route.ts',
    'app/api/organizer/vendors/route.ts',
  ]
  for (const f of FORMERLY_LEAKING) {
    assert(/organizerFairScope\(/.test(code(readFileSync(f, 'utf8'))),
      `${f.split('/').slice(-2).join('/')} reads through the fragment`)
  }

  // ── [3] includeDraft IS NOT SET BY ANYTHING BUT THE DRAFT ROUTES ────────────
  console.log('\n[3] only the drafts routes opt into seeing drafts')
  const DRAFT_OPT_IN_ALLOWED = /app\/api\/organizer\/fairs\/drafts\//
  const optIns = files.filter(f =>
    f !== 'lib/organizer-fair-context.ts' && /includeDraft:\s*true/.test(code(readFileSync(f, 'utf8'))))
  const badOptIns = optIns.filter(f => !DRAFT_OPT_IN_ALLOWED.test(f))
  assert(badOptIns.length === 0,
    badOptIns.length
      ? `includeDraft set outside the drafts routes: ${badOptIns.join(', ')}`
      : 'includeDraft is set only under app/api/organizer/fairs/drafts/')
  assert(optIns.length > 0, 'positive control: something DOES set includeDraft — the check is not vacuous')

  // ── [4] THE ACQUISITION GATE ────────────────────────────────────────────────
  console.log('\n[4] ⛔ a DRAFT fair cannot acquire a Vendor or a Runner')
  let threw: unknown = null
  try { assertFairAcceptsJoins(EventStatus.DRAFT, 'Test Fair') } catch (e) { threw = e }
  assert(threw !== null, 'a DRAFT is refused by the gate')
  assert((threw as { code?: string })?.code === FAIR_NOT_JOINABLE,
    `refused with the NAMED code ${FAIR_NOT_JOINABLE} (got ${(threw as { code?: string })?.code}) — not a generic 403`)
  assert(fairAcceptsJoins(EventStatus.DRAFT) === false, 'the non-throwing form agrees')
  // Positive controls: every real status must still be joinable, or the gate would close the fair.
  for (const s of [EventStatus.ACTIVE, EventStatus.UPCOMING, EventStatus.INACTIVE]) {
    assert(fairAcceptsJoins(s) === true, `positive control: ${s} still accepts joins`)
  }

  console.log('\n[4b] both attach paths call the gate')
  const vendorRoute = code(readFileSync('app/api/vendors/route.ts', 'utf8'))
  const driverRoute = code(readFileSync('app/api/drivers/route.ts', 'utf8'))
  assert(/assertFairAcceptsJoins\(/.test(vendorRoute),
    'app/api/vendors (vendor signup) gates before db.vendor.create')
  assert(/fairAcceptsJoins\(/.test(driverRoute),
    'app/api/drivers (runner minting) gates before db.runner.create')
  // Ordering matters: a gate AFTER the create protects nothing.
  //
  // ⚠️ `indexOf` returns -1 when ABSENT, and -1 < anything is true — so a naive
  // `indexOf(gate) < indexOf(create)` PASSES when the gate has been deleted entirely, which is the
  // one case it exists to catch. Caught by the negative control, not by reading. Require presence
  // first, then compare.
  function gatedBefore(src: string, gate: string, create: string): boolean {
    const g = src.indexOf(gate)
    const c = src.indexOf(create)
    return g >= 0 && c >= 0 && g < c
  }
  assert(gatedBefore(vendorRoute, 'assertFairAcceptsJoins(', 'db.vendor.create'),
    'the vendor gate is PRESENT and runs BEFORE the create')
  assert(gatedBefore(driverRoute, 'fairAcceptsJoins(', 'db.runner.create'),
    'the runner gate is PRESENT and runs BEFORE the create')
  // Positive control on the ordering probe itself: it must reject BOTH failure shapes.
  assert(!gatedBefore('db.vendor.create({})', 'assertFairAcceptsJoins(', 'db.vendor.create'),
    'positive control: the ordering probe FAILS when the gate is absent (the -1 trap)')
  assert(!gatedBefore('db.vendor.create({}); assertFairAcceptsJoins(s)', 'assertFairAcceptsJoins(', 'db.vendor.create'),
    'positive control: …and when the gate runs after the create')

  // ── [5] HARD DELETE IS DRAFT-ONLY, AND SAYS SO BY NAME ─────────────────────
  console.log('\n[5] the hard delete refuses anything that is not a DRAFT')
  const del = code(readFileSync('app/api/organizer/fairs/drafts/[fairSlug]/route.ts', 'utf8'))
  assert(/db\.event\.delete\(/.test(del), 'positive control: this route really does hard-delete')
  assert(/CANNOT_DELETE_NON_DRAFT/.test(del), 'a non-draft is refused with a NAMED error, not a silent no-op')
  assert(del.indexOf('CANNOT_DELETE_NON_DRAFT') < del.indexOf('db.event.delete('),
    'the status check runs BEFORE the delete')
  // The archive route must remain a SOFT delete — the two must never converge.
  const archive = code(readFileSync('app/api/organizer/fairs/[fairSlug]/route.ts', 'utf8'))
  assert(/archivedAt: new Date\(\)/.test(archive) && !/db\.event\.delete\(/.test(archive),
    'DELETE /organizer/fairs/[fairSlug] still SOFT-deletes — a real fair is never hard-deleted')

  console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
  if (fail > 0) process.exit(1)
}

main()
