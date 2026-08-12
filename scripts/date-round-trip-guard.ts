/**
 * DATE ROUND-TRIP GUARD — a fair date survives the calendar picker unchanged, in every timezone.
 *
 * THE BUG THIS PINS SHUT. `lib/event-date.ts` exists because a naive date render showed every
 * fair starting and ending ONE DAY EARLY: a fair date is stored as a UTC-midnight instant used
 * as a CARRIER for a calendar day, but a calendar grid renders `Date` objects in the viewer's
 * LOCAL zone. Both obvious one-line conversions are wrong, in OPPOSITE hemispheres:
 *
 *     new Date('2026-08-15')                 → UTC midnight → Aug 14 in America/*   ❌
 *     localMidnightDate.toISOString().slice() → previous day in Asia/* + Australia/* ❌
 *
 * America/Chicago is the app's own default (organizer/fairs/new:26), so the first failure mode
 * is the COMMON case, not an edge one.
 *
 *   [0] POSITIVE CONTROL ON THE TEST ITSELF — both naive implementations must FAIL here. A
 *       round-trip test that a broken implementation also passes proves nothing, and this
 *       whole guard is worthless without it.
 *   [1] ROUND TRIP — fromPickerDate(toPickerDate(s)) === s for every date, in every timezone.
 *   [2] GRID DAY — the Date handed to the calendar is the day the user actually picked (this
 *       is the half that breaks in the Americas, and it is invisible to a round-trip alone).
 *   [3] REJECTS NON-DATES — '' / malformed / Feb 30 never become a Date (the roll-over class
 *       that app/become-driver/page.tsx:172 moved off native date inputs to avoid).
 *
 * Node resolves the timezone ONCE at startup, so this re-spawns itself per zone rather than
 * assigning process.env.TZ in-process (which silently does nothing after the first Date call).
 *
 * Run:  npx tsx scripts/date-round-trip-guard.ts
 */

import { spawnSync } from 'node:child_process'
import { toPickerDate, fromPickerDate } from '../lib/calendar-date'

/** The zones that actually decide this: two west of UTC, UTC itself, two east. */
const ZONES = ['America/Chicago', 'America/Los_Angeles', 'UTC', 'Asia/Tokyo', 'Australia/Sydney']

const DATES = [
  '2026-08-15', // the worked example
  '2026-01-01', // year boundary
  '2026-12-31', // year end
  '2026-02-28', // month end
  '2028-02-29', // leap day — a real calendar date
  '2026-03-08', // US DST spring-forward
  '2026-11-01', // US DST fall-back
]

// ── CHILD: run the assertions for whatever TZ this process was started in ────────────────
if (process.env.RT_TZ_CHILD === '1') {
  let failures: string[] = []

  // [1] round trip — the string survives
  for (const s of DATES) {
    const back = fromPickerDate(toPickerDate(s))
    if (back !== s) failures.push(`round-trip ${s} → ${back}`)
  }

  // [2] grid day — the Date represents the SAME calendar day the string names. This is the
  // assertion a naive `new Date(str)` fails in America/*, and which a round-trip alone misses.
  for (const s of DATES) {
    const d = toPickerDate(s)
    if (!d) { failures.push(`grid-day ${s} → undefined`); continue }
    const [y, m, day] = s.split('-').map(Number)
    if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== day) {
      failures.push(`grid-day ${s} → renders ${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`)
    }
  }

  // [3] non-dates never become a Date
  for (const bad of ['', '2026-02-30', '2026-13-01', '2026-8-15', 'not-a-date', '2026-08-15T00:00:00Z']) {
    if (toPickerDate(bad) !== undefined) failures.push(`accepted invalid input "${bad}"`)
  }
  if (fromPickerDate(undefined) !== '' || fromPickerDate(new Date(NaN)) !== '') {
    failures.push('fromPickerDate did not return "" for empty/invalid')
  }

  if (failures.length) {
    console.log(`FAIL ${failures.length}`)
    for (const f of failures) console.log(`     ${f}`)
    process.exit(1)
  }
  process.exit(0)
}

// ── PARENT: run the child once per timezone ──────────────────────────────────────────────
let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

console.log('[0] positive control — BOTH naive implementations must fail this guard')
{
  // The two one-liners a future edit would reach for, exercised directly. If either passes
  // in every zone, this guard cannot detect the bug it exists for.
  const naiveIn  = (s: string) => new Date(s)                                   // UTC-parsed
  const naiveOut = (d: Date) => d.toISOString().slice(0, 10)                    // UTC-read

  const probe = (tz: string, fn: string) => spawnSync(
    process.execPath,
    ['-e', `
      const s = '2026-08-15';
      const inFn  = ${fn === 'in' ? `(x) => new Date(x)` : `(x) => { const [y,m,d]=x.split('-').map(Number); return new Date(y,m-1,d) }`};
      const outFn = ${fn === 'out' ? `(d) => d.toISOString().slice(0,10)` : `(d) => \`\${d.getFullYear()}-\${String(d.getMonth()+1).padStart(2,'0')}-\${String(d.getDate()).padStart(2,'0')}\``};
      const d = inFn(s);
      const gridDay = \`\${d.getFullYear()}-\${String(d.getMonth()+1).padStart(2,'0')}-\${String(d.getDate()).padStart(2,'0')}\`;
      process.stdout.write(JSON.stringify({ round: outFn(d), gridDay }));
    `],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' },
  ).stdout
  void naiveIn; void naiveOut

  // naive IN (new Date(str)) → the GRID shows the wrong day in America/*
  const chi = JSON.parse(probe('America/Chicago', 'in'))
  assert(chi.gridDay !== '2026-08-15',
    `naive new Date('2026-08-15') renders ${chi.gridDay} in America/Chicago — the guard CAN see this`)

  // naive OUT (toISOString) → the wrong day is SENT east of UTC
  const syd = JSON.parse(probe('Australia/Sydney', 'out'))
  assert(syd.round !== '2026-08-15',
    `naive toISOString() emits ${syd.round} in Australia/Sydney — the guard CAN see this`)

  // …and each naive half looks FINE in the other hemisphere, which is why one-zone testing missed it
  const chiOut = JSON.parse(probe('America/Chicago', 'out'))
  assert(chiOut.round === '2026-08-15',
    'naive toISOString() looks correct in America/Chicago — why testing one zone is not enough')
}

console.log('\n[1–3] the real adapter, per timezone')
for (const tz of ZONES) {
  const res = spawnSync(
    process.execPath,
    ['--import', 'tsx', new URL(import.meta.url).pathname],
    { env: { ...process.env, TZ: tz, RT_TZ_CHILD: '1' }, encoding: 'utf8' },
  )
  const out = (res.stdout ?? '').trim()
  assert(res.status === 0, `${tz.padEnd(20)} round-trip + grid-day + rejects${out ? `\n     ${out.replace(/\n/g, '\n     ')}` : ''}`)
}

console.log(`\n${'─'.repeat(60)}\n${fail === 0 ? '✅' : '❌'} date-round-trip-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
