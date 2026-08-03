/**
 * AUDIT-TIME GUARD — money and audit surfaces never format a timestamp without an explicit
 * locale, and never leave the zone unstated.
 *
 * The bug: Recent Money Actions rendered `new Date(a.createdAt).toLocaleString()` — no locale,
 * no zone — so a US fair's money log showed `19/07/2026, 12:21:50` (DD/MM/YYYY) to anyone whose
 * browser wasn't set to en-US. On a money surface a date that reads differently per viewer is a
 * reconciliation hazard: 07/08 is two different days depending on who opened the page.
 *
 * THE TWO KINDS, KEPT APART (asserted in [3]):
 *   • CALENDAR DATES (a fair runs Aug 5–12) → lib/event-date.ts, pinned to the carrier zone.
 *   • INSTANTS (a refund at 12:21:50)       → lib/audit-time.ts, explicit locale + stated zone.
 * Applying either to the other's data is the same conflation reversed, so neither lib imports
 * the other.
 *
 *   [0] POSITIVE CONTROLS (first) — the scanner flags a planted bare toLocale* and a planted
 *       `[]`-locale call, and does NOT flag an explicit-locale call.
 *   [1] MONEY/AUDIT SURFACES — none contains a bare or `[]`-locale toLocale* date/time call.
 *   [2] THE FORMATTER — explicit en-US, always names the zone, accepts a pinned zone, null-safe.
 *   [3] THE TWO MODULES STAY SEPARATE — no cross-import.
 *
 * Pure file-reader + pure-function. Run:  npx tsx scripts/audit-time-guard.ts
 */

import { readFileSync } from 'node:fs'
import { stripComments } from './_strip-comments'
import { formatAuditTimestamp, formatAuditDate } from '../lib/audit-time'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

// A DATE/TIME toLocale* with no locale, or with the `[]` (browser-default) locale. Deliberately
// excludes toLocaleString on a NUMBER (money amounts: `(cents/100).toLocaleString('en-US', …)`
// is a currency format, a different concern) by requiring a Date-ish receiver or the bare form.
const BARE_DATETIME = /toLocale(?:Date|Time)String\(\s*(?:\)|\[\s*\])|new Date\([^)]*\)\.toLocaleString\(\s*\)/

// Money + audit surfaces: where a misread timestamp costs money or trust.
const SURFACES = [
  'app/admin/[eventSlug]/money/page.tsx',
  'app/admin/_components/OrganizersPanel.tsx',
  'app/admin/_components/OrganizerControl.tsx',
  'app/admin/[eventSlug]/reports/page.tsx',
]

console.log('[0] positive controls')
assert(BARE_DATETIME.test('<p>{new Date(a.createdAt).toLocaleString()}</p>'),
  'scanner flags a planted bare toLocaleString() on a date (the exact bug)')
assert(BARE_DATETIME.test("new Date(d).toLocaleDateString([], { month: 'short' })"),
  'scanner flags a planted []-locale call (browser default, same failure)')
assert(!BARE_DATETIME.test("d.toLocaleString('en-US', { timeZoneName: 'short' })"),
  'scanner does NOT flag an explicit-locale call')
assert(!BARE_DATETIME.test("`$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`"),
  'scanner does NOT flag a NUMBER format (money amounts are a different concern)')

console.log('\n[1] money/audit surfaces carry no locale-dependent timestamp')
for (const f of SURFACES) {
  const src = readFileSync(f, 'utf8')
  assert(!BARE_DATETIME.test(src), `${f.split('/').slice(-2).join('/')} has no bare/[]-locale timestamp`)
}

console.log('\n[2] the shared formatter')
const T = '2026-07-19T17:21:50.000Z'
const out = formatAuditTimestamp(T, { timeZone: 'America/Chicago' })
assert(/^Jul 19, 2026/.test(out), `month-name format, never DD/MM (got "${out}")`)
assert(/CDT|CST/.test(out), 'the zone is NAMED in the output — a reader never has to guess')
assert(formatAuditTimestamp(T, { timeZone: 'UTC' }) !== out, 'a pinned zone actually changes the rendering (not ignored)')
assert(formatAuditTimestamp(null) === '—' && formatAuditDate(undefined) === '—', 'null-safe → em dash, never "Invalid Date"')
assert(formatAuditTimestamp('not-a-date') === '—', 'an unparseable value degrades to the em dash')
const lib = readFileSync('lib/audit-time.ts', 'utf8')
assert(/const AUDIT_LOCALE = 'en-US'/.test(lib) && /timeZoneName: 'short'/.test(lib),
  'locale is explicit and the zone is always labelled, in one place')

console.log('\n[3] instants and calendar dates stay separate')
// COMMENT-STRIPPED (scripts/_strip-comments.ts). These assert what the modules DO, not what they
// mention: audit-time's header explains the instant-vs-calendar split, and naming the other
// module's constant while explaining it is not pinning a carrier zone. Reading raw source here
// failed on that prose and would have pressured the next person to delete the explanation to go
// green — `guards-scan-code-not-prose`, the reason the shared stripper exists.
const eventDate = stripComments(readFileSync('lib/event-date.ts', 'utf8'))
const libCode = stripComments(lib)
assert(!/from '\.\/audit-time'/.test(eventDate), 'lib/event-date does NOT import the instant formatter')
assert(!/from '\.\/event-date'/.test(libCode), 'lib/audit-time does NOT import the calendar-date formatter')
assert(/EVENT_DATE_ZONE/.test(eventDate) && !/EVENT_DATE_ZONE/.test(libCode), 'only the calendar-date module pins a carrier zone')
// The stripping must not have blinded it: a REAL use in audit-time still fails.
assert(/EVENT_DATE_ZONE/.test(stripComments("import { EVENT_DATE_ZONE } from './event-date'")),
  'positive control: a real EVENT_DATE_ZONE import survives stripping and would still be caught')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} audit-time-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
