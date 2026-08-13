/**
 * DATE-BOUNDS GUARD — editing a fair must never lock an admin out of its own dates.
 *
 * THE TRAP. The fair-creation form forbids past dates: you cannot schedule an event that
 * already happened. Applying that same floor to the EDIT form is a lockout — a fair that has
 * already started has a start date in the past BY DEFINITION, so a floor of "today" greys out
 * its own dates, and because the bounds also hard-stop month navigation, the admin cannot even
 * page back to see them. The failure lands on a LIVE event, which is the worst possible moment.
 *
 * One shared picker serves both forms, so the rules must differ by caller. This asserts they do.
 *
 *   [0] POSITIVE CONTROL — the naive shared rule (today as the floor everywhere) MUST fail the
 *       lockout assertion, or this guard proves nothing.
 *   [1] NO LOCKOUT — for every shape of existing fair (running, finished, far-future, today,
 *       upcoming) the record's OWN dates fall inside the edit bounds and the calendar opens on
 *       the month those dates are in.
 *   [2] STILL BOUNDED — editing does not become unlimited: a normal upcoming fair still floors
 *       at today, so an admin cannot wander back years.
 *   [3] CREATION IS STRICTER — no past, hard horizon, and a stale draft does NOT widen the
 *       floor (it must be re-dated before publishing).
 *   [4] CALLERS USE THE RIGHT RULE — the edit form must not inline its own floor.
 *
 * Run:  npx tsx scripts/date-bounds-guard.ts
 */

import { readFileSync } from 'node:fs'
import {
  creationDateBounds,
  editDateBounds,
  toPickerDate,
  CREATION_HORIZON_MONTHS,
  type DateBounds,
} from '../lib/calendar-date'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

/** A fixed "now" so the guard is deterministic regardless of when it runs. */
const NOW = new Date(2026, 7, 13) // 13 Aug 2026, local
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()

/** The property that matters: the record's own dates are selectable, and we open where they are. */
function reachable(b: DateBounds, start: string, end: string): boolean {
  const s = toPickerDate(start)!, e = toPickerDate(end)!
  return s >= b.minDate && e <= b.maxDate && sameMonth(b.defaultMonth, s)
}

const FAIRS: [string, string, string][] = [
  ['running (started, not ended)', '2026-08-01', '2026-08-20'],
  ['finished (entirely past)',     '2026-06-01', '2026-06-05'],
  ['beyond the creation horizon',  '2027-02-10', '2027-02-18'],
  ['starting today',               '2026-08-13', '2026-08-15'],
  ['normal upcoming',              '2026-09-01', '2026-09-07'],
]

console.log('[0] positive control — the naive shared rule MUST fail')
{
  // What a careless implementation does: reuse the creation floor on the edit form.
  const naive = (s: string, e: string): DateBounds => ({ ...creationDateBounds(s, NOW), defaultMonth: toPickerDate(s)! })
  const lockedOut = FAIRS.filter(([, s, e]) => !reachable(naive(s, e), s, e))
  assert(lockedOut.length > 0,
    `naive "today floor everywhere" locks out ${lockedOut.length}/${FAIRS.length} fairs (${lockedOut.map(f => f[0]).join('; ')}) — the guard CAN see a lockout`)
  const runningNaive = naive('2026-08-01', '2026-08-20')
  assert(toPickerDate('2026-08-01')! < runningNaive.minDate,
    "…specifically: a running fair's own start falls BELOW the naive floor and becomes unpickable")
}

console.log('\n[1] no lockout — every fair shape keeps its own dates reachable')
for (const [label, s, e] of FAIRS) {
  const b = editDateBounds(s, e, NOW)
  assert(reachable(b, s, e), `${label.padEnd(30)} bounds ${iso(b.minDate)} … ${iso(b.maxDate)}, opens ${iso(b.defaultMonth).slice(0, 7)}`)
}

console.log('\n[2] editing is widened, not unlimited')
{
  const b = editDateBounds('2026-09-01', '2026-09-07', NOW)
  assert(iso(b.minDate) === '2026-08-13', 'a normal upcoming fair still floors at today (no wandering back years)')
  const past = editDateBounds('2026-06-01', '2026-06-05', NOW)
  assert(iso(past.minDate) === '2026-06-01', 'the floor widens EXACTLY to the fair start, not further')
  const far = editDateBounds('2027-02-10', '2027-02-18', NOW)
  assert(iso(far.maxDate) === '2027-02-18', 'the ceiling widens EXACTLY to the fair end, not further')
}

console.log('\n[3] creation is stricter than editing')
{
  const c = creationDateBounds(undefined, NOW)
  assert(iso(c.minDate) === '2026-08-13', 'creation floors at today (no fair that already happened)')
  assert(iso(c.maxDate) === '2026-11-13', `creation ceiling is a hard +${CREATION_HORIZON_MONTHS} months`)
  const stale = creationDateBounds('2026-06-01', NOW)
  assert(iso(stale.minDate) === '2026-08-13', 'a STALE draft does not widen the creation floor — it must be re-dated')
  assert(iso(stale.defaultMonth) === '2026-08-13', '…and does not open on a month navigation cannot return from')
  const live = creationDateBounds('2026-09-01', NOW)
  assert(iso(live.defaultMonth) === '2026-09-01', 'a still-valid draft DOES open on its own start month')
  // The asymmetry itself, stated as an assertion.
  const edit = editDateBounds('2026-06-01', '2026-06-05', NOW)
  assert(edit.minDate < c.minDate, 'EDIT bounds are strictly wider than CREATION bounds for a past fair')
}

console.log('\n[4] the callers use the right rule')
{
  const admin = readFileSync(new URL('../app/admin/[eventSlug]/settings/page.tsx', import.meta.url), 'utf8')
  const organizer = readFileSync(new URL('../app/organizer/fairs/new/page.tsx', import.meta.url), 'utf8')
  assert(admin.includes('editDateBounds') && !admin.includes('creationDateBounds'),
    'the admin EDIT form uses editDateBounds (and not the creation rule)')
  assert(organizer.includes('creationDateBounds') && !organizer.includes('editDateBounds'),
    'the organizer CREATE form uses creationDateBounds')
  // A hand-rolled floor in the edit form is how the lockout comes back.
  assert(!/minDate=\{[^}]*new Date\(/.test(admin), 'the edit form does not inline its own minDate')
}

console.log(`\n${'─'.repeat(60)}\n${fail === 0 ? '✅' : '❌'} date-bounds-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
