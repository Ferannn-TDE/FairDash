/**
 * RUNNER "TODAY" BOUNDARY GUARD — the day bucket is the FAIR's, not the server's.
 *
 * ── THE BUG, AND WHY 89 GREEN SUITES MISSED IT ───────────────────────────────────────────────
 * lib/runner-earnings.ts and lib/runner-completion.ts both computed "today" as
 * `new Date(nowMs); setHours(0, 0, 0, 0)` — SERVER-local midnight. Vercel runs UTC, so during a
 * Chicago evening "today" had already rolled to tomorrow. Measured in prod on 2026-08-03: a
 * runner's two Aug-2 deliveries (11:03 AM and 9:19 PM Chicago) fell on opposite sides of the UTC
 * boundary, and the page read "1 delivery / $11.50" against a true "2 / $21.00".
 *
 * ⚠️ THE DEFECT IS INVISIBLE ON A CHICAGO LAPTOP. `setHours` is CORRECT whenever the host zone
 * equals the fair's zone — so local dev, and every existing suite, agreed with the bug. A guard
 * that simply called the function and checked a number would have gone green on the broken code
 * on the machine most likely to run it. That is the false-green this bug walked through, and it
 * is the thing this file is built to prevent.
 *
 * SO THE CONTROL FORCES THE HOST ZONE. Node reads the zone from process.env.TZ at first use of
 * the date machinery, so the UTC condition is reproduced by RE-EXECUTING this file in a child
 * process with TZ=UTC (setting process.env.TZ in-process is unreliable once Intl/Date has
 * cached the zone). The parent asserts on the child's verdict. Both halves report.
 *
 *   [0]  vacuity floor — the fixture rows really do straddle a Chicago midnight
 *   [P1] THE DEFECT, DEMONSTRATED: under TZ=UTC the OLD `setHours` expression splits the two
 *        fixture rows across two buckets. Executable, not asserted from prose.
 *   [P2] THE FIX: under the SAME TZ=UTC, the zoned boundary puts both in one Chicago day.
 *   [P3] HOST-INDEPENDENCE: the zoned boundary returns the identical instant under TZ=UTC and
 *        TZ=America/Chicago — the property `setHours` lacked.
 *   [1]  both consumers import the shared boundary; neither retains a local midnight expression.
 *   [2]  the zone is never defaulted in the pure functions (a hardcoded 'America/Chicago' would
 *        be the same assume-a-timezone mistake in a smaller costume).
 *
 * Run:  npx tsx scripts/runner-today-boundary-guard.ts
 */

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { startOfDayInZone } from '../lib/audit-time'
import { summarizeRunnerEarnings, type RunnerLedgerRow } from '../lib/runner-earnings'

const FAIR_TZ = 'America/Chicago'

// The real incident, as fixtures. Both are Aug 2 in Chicago; they straddle 2026-08-03T00:00Z.
const EARLY = new Date('2026-08-02T16:03:14Z') // Aug 2, 11:03 AM Chicago
const LATE = new Date('2026-08-03T02:19:43Z') // Aug 2,  9:19 PM Chicago
const OBSERVED_AT = Date.parse('2026-08-03T02:25:00Z') // Aug 2, 9:25 PM Chicago

const row = (createdAt: Date, amountCents: number): RunnerLedgerRow => ({
  orderId: `o-${createdAt.getTime()}`,
  amountCents,
  status: 'paid',
  paidAt: createdAt,
  createdAt,
  order: { tip: 0, fulfillmentType: 'HOME_DELIVERY' },
})
const ROWS = [row(LATE, 1150), row(EARLY, 950)]

/** The PRE-FIX expression, kept executable so the defect is demonstrated rather than described. */
function legacyStartOfToday(nowMs: number): Date {
  const d = new Date(nowMs)
  d.setHours(0, 0, 0, 0)
  return d
}

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => {
  if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

// ─── CHILD MODE ──────────────────────────────────────────────────────────────────────────────
// Re-entered with TZ forced. Prints one JSON line; the parent asserts on it.
if (process.argv[2] === '--probe') {
  const legacy = legacyStartOfToday(OBSERVED_AT)
  const zoned = startOfDayInZone(OBSERVED_AT, FAIR_TZ)
  const inBucket = (d: Date, start: Date) => d >= start
  process.stdout.write(JSON.stringify({
    tz: process.env.TZ ?? null,
    legacyStart: legacy.toISOString(),
    zonedStart: zoned.toISOString(),
    legacyEarlyIn: inBucket(EARLY, legacy),
    legacyLateIn: inBucket(LATE, legacy),
    zonedEarlyIn: inBucket(EARLY, zoned),
    zonedLateIn: inBucket(LATE, zoned),
    earnedTodayCents: summarizeRunnerEarnings(ROWS, FAIR_TZ, OBSERVED_AT).earnedTodayCents,
  }))
  process.exit(0)
}

// ─── PARENT ──────────────────────────────────────────────────────────────────────────────────
/** tsx is required to execute TS; re-invoke through the same runner the parent was started with. */
function probeVia(tz: string) {
  const out = execFileSync('npx', ['tsx', process.argv[1], '--probe'], {
    env: { ...process.env, TZ: tz }, encoding: 'utf8',
  })
  return JSON.parse(out.trim().split('\n').pop()!)
}
console.log('[0] vacuity floor — the fixtures straddle a Chicago midnight')
const chicagoDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: FAIR_TZ })
assert(chicagoDay(EARLY) === chicagoDay(LATE), `both fixtures are the SAME Chicago day (${chicagoDay(EARLY)})`)
assert(
  EARLY.toISOString().slice(0, 10) !== LATE.toISOString().slice(0, 10),
  'and DIFFERENT UTC days — so a UTC boundary must split them (else this guard proves nothing)',
)

const utc = probeVia('UTC')
const chi = probeVia('America/Chicago')

console.log('\n[P1] THE DEFECT, under TZ=UTC — the old expression splits the day')
assert(utc.legacyStart === '2026-08-03T00:00:00.000Z', `legacy startOfToday = UTC midnight (${utc.legacyStart})`)
assert(utc.legacyLateIn === true, 'legacy: the 9:19 PM delivery counts as "today"')
assert(utc.legacyEarlyIn === false, 'legacy: the 11:03 AM delivery is EXCLUDED — the bug, reproduced')

console.log('\n[P2] THE FIX, same TZ=UTC — the zoned boundary keeps the day whole')
assert(utc.zonedStart === '2026-08-02T05:00:00.000Z', `zoned startOfToday = Chicago midnight (${utc.zonedStart})`)
assert(utc.zonedEarlyIn === true && utc.zonedLateIn === true, 'zoned: BOTH deliveries land in the same Chicago day')
assert(utc.earnedTodayCents === 2100, `earnedToday = $21.00 under UTC, not $11.50 (got ${utc.earnedTodayCents}c)`)

console.log('\n[P3] HOST-INDEPENDENCE — the property setHours lacked')
assert(chi.zonedStart === utc.zonedStart, `zoned boundary identical on a Chicago host (${chi.zonedStart})`)
assert(chi.earnedTodayCents === utc.earnedTodayCents, 'and the money answer is identical on both hosts')
assert(chi.legacyStart !== utc.legacyStart, 'positive control: the LEGACY boundary DID differ by host (which is why it hid)')

console.log('\n[1] both consumers read the shared boundary')
for (const f of ['lib/runner-earnings.ts', 'lib/runner-completion.ts']) {
  const src = readFileSync(f, 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert(/startOfDayInZone\s*\(/.test(code), `${f} calls startOfDayInZone`)
  assert(!/setHours\s*\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(code), `${f} has NO local-midnight expression left`)
}

console.log('\n[2] the zone is never defaulted in the pure functions')
for (const f of ['lib/runner-earnings.ts', 'lib/runner-completion.ts']) {
  const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert(
    !/timeZone\s*(:\s*string)?\s*=\s*['"`]/.test(code),
    `${f} does not default timeZone to a literal (a hardcoded zone is the same bug, smaller)`,
  )
}

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} runner-today-boundary-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
