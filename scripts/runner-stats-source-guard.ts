/**
 * RUNNER-STATS SOURCE GUARD — custody is the spine for COUNTS, the ledger for MONEY, and the
 * dead Runner counter columns can never grow a reader again.
 *
 * The class (two at once, both live on the admin runners screen until 2026-07-23):
 *   - TWO COPIES OF ONE DERIVATION: #4a–4c collapsed the runner-facing stats onto the custody/
 *     ledger derivation and left the admin copy reading Runner.totalCompleted / completionRate —
 *     columns with NO write site anywhere (0/0/1.0 in the DB against real deliveries).
 *   - VACUOUS GATE: the admin <90% warning banner keyed on a column hard-stuck at 1.0 — a
 *     safety surface that was silently off.
 *
 *   [0] POSITIVE CONTROL — the scanner detects a deliberately planted COLUMN-READ fixture
 *       (a broken grep cannot pass vacuously); asserted BEFORE the real scan.
 *   [1] DEAD COLUMNS UNREAD — no file under app/ or lib/ reads Runner.totalCompleted,
 *       Runner.totalDispatched, or selects completionRate from the Runner model. The rules
 *       match the COLUMN READ, not the bare word: four unrelated LIVE `completionRate`
 *       derivations exist (vendor analytics, organizer analytics, the runners/me response
 *       field, mocks) and must NOT trip this.
 *   [2] ONE SOURCE — the admin runners route imports lib/runner-completion and calls the
 *       BATCHED form (a local reimplementation or an N+1 per-runner loop fails the gate).
 *   [3] FEE-SHAPED-COUNT CLASS — the pure core counts a DELIVERED order with no fee, no tip,
 *       and no ledger row (the exact case the #4a ledger-derived count missed: "2 deliveries"
 *       shown for 3 made). Its input shape has no money field at all, and the module source
 *       never references the ledger.
 *   [4] THE FLOOR — RUNNER_COMPLETION_MIN_DENOMINATOR is a named constant in lib/constants;
 *       the route computes `scored` from it (the ONE copy of the predicate); the page gates
 *       the bar AND the banner on `scored`, shows "not enough deliveries" below it, and
 *       carries no local floor literal to drift.
 *
 * Pure file-reader + pure-function — no DB, no worker. Run:
 *   npx tsx scripts/runner-stats-source-guard.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { summarizeCustody } from '../lib/runner-completion'

/** The fair's zone. summarizeCustody has no default — every caller states one. */
const TZ = 'America/Chicago'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

// ── The scan rules: COLUMN READS, not bare words ─────────────────────────────────────────────
// totalCompleted / totalDispatched exist nowhere else in the domain, so any mention in app/lib
// is a read of the dead columns (member access, select field, or response type built from one).
// completionRate is ALSO a legitimate live response/computed field in four places, so for it we
// match only the Prisma select syntax (`completionRate: true`) — the one form that reads the
// Runner COLUMN.
const RULES: { name: string; re: RegExp }[] = [
  { name: 'totalCompleted',        re: /totalCompleted/ },
  { name: 'totalDispatched',       re: /totalDispatched/ },
  { name: 'completionRate select', re: /completionRate:\s*true/ },
]
const violationsIn = (src: string) => RULES.filter(r => r.re.test(src)).map(r => r.name)

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

console.log('[0] positive control: the scanner sees a planted column read')
const planted = 'const r = await db.runner.findUnique({ select: { completionRate: true, totalCompleted: true } })'
const hits0 = violationsIn(planted)
assert(hits0.includes('totalCompleted') && hits0.includes('completionRate select'),
  'planted fixture (a db.runner select of the dead columns) IS detected — the grep is alive')
assert(violationsIn('const completionRate = delivered / attempted; return { completionRate }').length === 0,
  'baseline: a LIVE computed completionRate (the vendor/organizer-analytics shape) is NOT flagged')

console.log('\n[1] no file under app/ or lib/ reads the dead Runner columns')
const files = [...walk('app'), ...walk('lib')]
const offenders = files
  .map(f => ({ f, hits: violationsIn(readFileSync(f, 'utf8')) }))
  .filter(x => x.hits.length > 0)
offenders.forEach(x => console.log(`     ✗ ${x.f}: ${x.hits.join(', ')}`))
assert(files.length > 100, `scan actually walked the tree (${files.length} files — not an empty glob)`)
assert(offenders.length === 0, 'ZERO readers of totalCompleted / totalDispatched / a Runner completionRate select')

console.log('\n[2] the admin runners route derives through the shared module, batched')
const route = readFileSync('app/api/admin/events/[id]/runners/route.ts', 'utf8')
assert(/from '@\/lib\/runner-completion'/.test(route), 'route imports lib/runner-completion (the single source)')
assert(/computeRunnerCompletionRates\(/.test(route), 'route calls the BATCHED form — one roster query, not N+1')
assert(/eventId:\s*event\.id/.test(route), 'stats are scoped to the requireAdminFairContext-resolved event')

console.log('\n[3] fee-shaped-count class: a zero-fee, no-tip, no-ledger-row delivery COUNTS')
// The pure core's input has no money field — this delivered order "paid" nothing and still counts.
const rows = [{ collectedAt: new Date(), possessionAt: null, order: { status: 'DELIVERED', runnerId: 'r1' } }]
const s = summarizeCustody(rows, 'r1', TZ)
assert(s.delivered === 1 && s.collected === 1, 'delivered count = 1 with NO fee, tip, or RunnerEarning anywhere in the input')
// The sibling evidence-shaped undercount: a delivery with NO collect tap (the status route
// permits deliver on proofPath alone) counts on both sides via the possession fallback.
const noTap = summarizeCustody([{ collectedAt: null, possessionAt: new Date(), order: { status: 'DELIVERED', runnerId: 'r1' } }], 'r1', TZ)
assert(noTap.delivered === 1 && noTap.collected === 1 && noTap.deliveredToday === 1, 'a tap-skipped delivery still counts (delivery proves possession)')
const emptied = summarizeCustody([], 'r1', TZ)
assert(emptied.delivered === 0 && emptied.rate === 1, 'baseline: empty custody → 0 delivered, rate 1.0 (the [3] counts above are not vacuous)')
const completionSrc = readFileSync('lib/runner-completion.ts', 'utf8')
assert(!/runnerEarning|amountCents|deliveryFee|\btip\b/i.test(completionSrc.replace(/^\s*\/?\*.*$|\/\/.*$/gm, '')),
  'the counting module CODE never touches the ledger or a money field (counts cannot re-become fee-shaped)')

console.log('\n[4] the floor: one named constant, one predicate, honest below it')
const constantsSrc = readFileSync('lib/constants.ts', 'utf8')
assert(/export const RUNNER_COMPLETION_MIN_DENOMINATOR = \d+/.test(constantsSrc), 'RUNNER_COMPLETION_MIN_DENOMINATOR is a named constant in lib/constants')
assert(/RUNNER_COMPLETION_MIN_DENOMINATOR/.test(route) && /scored:\s*s\.collected\s*>=\s*RUNNER_COMPLETION_MIN_DENOMINATOR/.test(route),
  'the route computes `scored` from the constant — the ONE copy of the floor predicate')
const page = readFileSync('app/admin/[eventSlug]/runners/page.tsx', 'utf8')
assert(/runner\.scored\s*\?[\s\S]{0,200}CompletionBar/.test(page), 'page renders the bar/percentage ONLY when scored')
assert(/not enough deliveries/.test(page), 'below the floor the cell reads "not enough deliveries" — not a percentage')
assert(/r\.scored\s*&&\s*r\.completionRate\s*<\s*0\.9/.test(page), 'the <90% banner predicate requires scored — noise over N<floor can never fire it')
assert(!/[<>]=?\s*5\b/.test(page), 'the page carries NO local floor literal (retuning is one line in constants)')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} runner-stats-source-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
