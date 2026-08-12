/**
 * CALENDAR-DATE ↔ PICKER-DATE — the only conversion between a stored fair date and the
 * `Date` object a calendar grid renders.
 *
 * ── WHY THIS IS ITS OWN MODULE WITH NO IMPORTS ───────────────────────────────────────────
 * So it can be proven without mounting a calendar. `scripts/date-round-trip-guard.ts` runs
 * these two functions under five timezones; if the round-trip is wrong the guard goes red
 * without React, a DOM, or react-day-picker being involved at all.
 *
 * ── THE BUG THIS EXISTS TO PREVENT (it already happened once) ────────────────────────────
 * `lib/event-date.ts` was written after every public and internal surface showed a fair
 * starting and ending ONE DAY EARLY. Its rule is the contract this module implements:
 *
 *     A FAIR DATE IS A CALENDAR DATE, NOT AN INSTANT.
 *
 * "Italian Fest runs Aug 5–12" is true for every viewer on earth. The value is stored as a
 * UTC-midnight instant used purely as a CARRIER for a calendar day, and it must be read in
 * the zone it was written in — UTC (`EVENT_DATE_ZONE`).
 *
 * A calendar grid, however, renders `Date` objects in the VIEWER'S LOCAL zone. So the carrier
 * and the grid disagree, and both of the obvious one-line conversions are wrong — in opposite
 * hemispheres. Measured, not assumed (2026-08-12, value '2026-08-15'):
 *
 *   TZ                    new Date('2026-08-15')     localDate.toISOString().slice(0,10)
 *                         → grid highlights          → value sent to the API
 *   America/Chicago       2026-08-14  ❌             2026-08-15  ✅
 *   America/Los_Angeles   2026-08-14  ❌             2026-08-15  ✅
 *   UTC                   2026-08-15  ✅             2026-08-15  ✅
 *   Asia/Tokyo            2026-08-15  ✅             2026-08-14  ❌
 *   Australia/Sydney      2026-08-15  ✅             2026-08-14  ❌
 *
 * `new Date('2026-08-15')` is parsed as UTC midnight by spec, which in any America/* zone is
 * the PREVIOUS evening — so the grid highlights the day before. That is the app's own default
 * timezone (`America/Chicago`, organizer/fairs/new:26), i.e. the failing case is the common one.
 * `toISOString()` fails the other way, east of UTC.
 *
 * The fix is to never let a Date cross this boundary carrying a timezone: build the Date from
 * LOCAL parts, and read it back from LOCAL parts. The string is the truth; the Date is only a
 * temporary shape the grid needs.
 *
 * ⚠️ DO NOT "simplify" either function to `new Date(str)` or `.toISOString()`. Both look
 * correct in a UTC CI box and are wrong for real users. The guard fails on both.
 */

/** A fair date on the wire: 'YYYY-MM-DD'. What both event forms hold and both APIs parse. */
export type CalendarDateString = string

/** Matches 'YYYY-MM-DD' and nothing else — a partially-typed value must not become a Date. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * 'YYYY-MM-DD' → a `Date` at LOCAL midnight on that calendar day, which is the day the grid
 * will highlight. Returns undefined for '' / malformed input, so an empty form field is simply
 * "nothing selected" rather than an Invalid Date.
 *
 * Rejects dates the calendar cannot express: `new Date(2026, 1, 30)` silently rolls Feb 30 to
 * Mar 2, the exact class `app/become-driver/page.tsx:172` moved off native date inputs to
 * avoid. Round-tripping the parts back out catches the roll-over and returns undefined.
 */
export function toPickerDate(value: CalendarDateString | null | undefined): Date | undefined {
  if (!value) return undefined
  const m = ISO_DATE.exec(value)
  if (!m) return undefined
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined

  // LOCAL midnight — NOT new Date(value), which the spec parses as UTC.
  const d = new Date(year, month - 1, day)
  // Roll-over check: a real calendar day survives the round-trip unchanged.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return undefined
  return d
}

/**
 * A `Date` from the grid → 'YYYY-MM-DD', read from LOCAL parts.
 *
 * NEVER `.toISOString()`: the grid hands back a local-midnight Date, and east of UTC that
 * instant is the previous day in UTC, so the API would store the wrong date.
 */
export function fromPickerDate(date: Date | null | undefined): CalendarDateString {
  if (!date || isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
