/**
 * EVENT-DATE GUARD — a fair date is a CALENDAR DATE and renders through one formatter.
 *
 * The bug: `Event.startDate` is stored as a UTC-midnight instant CARRYING a calendar date
 * (2026-08-05T00:00:00Z = "Aug 5"), and eight surfaces each hand-formatted it with
 * `new Date(iso).toLocaleDateString(...)` — the viewer's zone. In America/Chicago (UTC-5 in
 * August) that instant is Aug 4 at 19:00, so every surface — the public landing card included —
 * showed the fair starting AND ending one day early.
 *
 * The stored value is NOT wrong (the admin form writes `new Date('2026-08-05')` and reads back
 * `toISOString().slice(0,10)`, a consistent round-trip), so nothing is migrated: the carrier is
 * simply read in the zone it was written in.
 *
 *   [0] POSITIVE CONTROLS — the scanner flags a planted local-zone event-date format, and does
 *       NOT flag an instant being formatted locally (order.placedAt SHOULD be local). Asserted
 *       BEFORE the real scan so a broken regex cannot pass this suite vacuously.
 *   [1] THE RULE — formatting is zone-fixed: the same calendar day comes out under any TZ,
 *       including the zone that produced the bug.
 *   [2] NO PER-SITE FORMATTING — no surface hand-formats an event date; the second copy that
 *       drifts cannot reappear.
 *   [3] INSTANTS ARE UNTOUCHED — order timestamps still render in the viewer's local zone; this
 *       guard must not have pushed them into UTC.
 *
 * Pure file-reader + pure-function. Run:  npx tsx scripts/event-date-guard.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { formatEventDate, formatEventDateRange, EVENT_DATE_ZONE } from '../lib/event-date'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const START = '2026-08-05T00:00:00.000Z'
const END = '2026-08-12T00:00:00.000Z'

// A local-zone format applied to an EVENT date field. Keyed on the field name (startDate /
// endDate), so an order timestamp formatted locally — which is correct — never trips it.
// Keyed on the FIELD NAME (startDate/endDate)… and on the shape that slipped past it: a fair's
// dates copied into local vars first (`const s = new Date(start)` → `s.toLocaleDateString([])`),
// which is exactly how app/admin/_components/FairPicker.tsx kept hand-formatting a date range
// after the sweep. A `[]`-locale toLocaleDateString on a fair range is the tell.
const LOCAL_EVENT_FORMAT = /(?:start|end)Date[^\n]*\.toLocaleDateString|new Date\([^)]*(?:start|end)Date[^)]*\)\s*\.toLocale|function fmtRange[\s\S]{0,200}toLocaleDateString\(\s*\[\s*\]/

console.log('[0] positive controls')
assert(LOCAL_EVENT_FORMAT.test("new Date(fair.startDate).toLocaleDateString('en-US', opts)"),
  'flags a planted local-zone render of an event date (the exact shape that shipped)')
assert(LOCAL_EVENT_FORMAT.test('return new Date(dateStr).toLocaleDateString(); // startDate'.replace('dateStr', 'startDate')),
  'flags it through a renamed local variable too')
assert(!LOCAL_EVENT_FORMAT.test("new Date(order.placedAt).toLocaleDateString([], opts)"),
  'baseline: an INSTANT (order.placedAt) formatted locally is NOT flagged — that is correct behavior')
assert(LOCAL_EVENT_FORMAT.test("function fmtRange(start: string, end: string) {\n  const s = new Date(start)\n  return `${s.toLocaleDateString([], opts)}`\n}"),
  'flags a fair range hand-formatted via local vars — the shape that slipped past the field-name rule (FairPicker)')

console.log('\n[1] the rule: zone-fixed, so the calendar day survives the viewer')
assert(EVENT_DATE_ZONE === 'UTC', 'the carrier zone is explicit (UTC — where the admin form writes)')
assert(formatEventDateRange(START, END) === 'Aug 5 – Aug 12, 2026',
  `the fair renders as stored: "Aug 5 – Aug 12, 2026" (got "${formatEventDateRange(START, END)}")`)
assert(formatEventDate(START) === 'Aug 5, 2026', 'a single date keeps its day')
// The bug in one line: the same instant, formatted the old way, in the reported viewer zone.
const brokenWay = new Date(START).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' })
assert(brokenWay === 'Aug 4' && formatEventDate(START, { month: 'short', day: 'numeric' }) === 'Aug 5',
  'positive control on the BUG: local-zone formatting really does say Aug 4 while the shared one says Aug 5')
assert(formatEventDate('2026-08-05') === 'Aug 5, 2026', 'a date-only string lands on the same day (no double-shift)')
assert(formatEventDate(null) === null && formatEventDateRange(null, null) === 'Dates TBA',
  'absent dates yield null / an explicit fallback — never a fabricated date')

console.log('\n[2] no surface hand-formats an event date')
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}
const files = [...walk('app'), ...walk('lib')].filter(f => !f.endsWith('lib/event-date.ts'))
const offenders = files.filter(f => LOCAL_EVENT_FORMAT.test(readFileSync(f, 'utf8')))
offenders.forEach(f => console.log(`     ✗ ${f}`))
assert(files.length > 100, `the scan walked the tree (${files.length} files — not an empty glob)`)
assert(offenders.length === 0, 'ZERO local-zone event-date renders across app/ + lib/')
const CARD = readFileSync('app/_components/FairCard.tsx', 'utf8')
assert(/formatEventDateRange/.test(CARD) && !/function formatDateRange/.test(CARD),
  'the public landing card renders through the shared formatter (its own copy is gone)')

console.log('\n[3] instants still render locally (this guard did not over-reach)')
const ordersPage = readFileSync('app/fair/[fairSlug]/orders/page.tsx', 'utf8')
assert(/placedAt/.test(ordersPage) && /toLocaleDateString/.test(ordersPage),
  'order timestamps still format in the VIEWER\'s zone — a placed-at time is an instant, not a calendar date')
assert(!/formatEventDate/.test(ordersPage),
  'the event-date helper was NOT applied to order timestamps (that would be the same conflation, reversed)')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} event-date-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
