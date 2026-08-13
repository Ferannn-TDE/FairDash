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

// ─────────────────────────────────────────────────────────────────────────────
// DISPLAY — for surfaces rendering a date the PICKER owns
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ These live here, beside the adapter, for one reason: a summary that formats
// the same value a different way is exactly how the off-by-one comes back. The
// obvious `new Date('2026-08-03').toLocaleDateString()` shifts back a day in every
// America/* zone, so a "pretty" panel would read Aug 2 while the grid it sits next
// to highlights Aug 3 — the worst version of the bug, because the calendar looks
// right and only the readout lies.
//
// Everything below formats from `toPickerDate`'s LOCAL Date — the exact object the
// grid renders — so the two cannot disagree by construction.
//
// Static name tables, NOT date-fns `format`: the containment guard forbids importing
// it, and this module must stay dependency-free so the round-trip guard can prove it
// without mounting a calendar.
//
// (For a fair date rendered ANYWHERE ELSE in the app — a public page, an admin list —
// use lib/event-date.ts. That reads the stored UTC carrier and is the right tool when
// there is no picker involved. This is the picker's own summary.)

// ─────────────────────────────────────────────────────────────────────────────
// EVENT DATE BOUNDS — creation vs editing, which are NOT the same rule
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ THE LOCKOUT THIS PREVENTS. Creating a fair forbids past dates: you cannot schedule an
// event that already happened. Applying that same floor to the EDIT form would be a trap — a
// fair that has already started has a start date in the past BY DEFINITION, so a floor of
// "today" greys out its own dates and, with navigation hard-stopped at the same boundary,
// leaves an admin unable to reach or re-pick the dates of a LIVE event. Same for a fair
// scheduled beyond the creation horizon.
//
// So the two are separate functions rather than one function with a flag, and the edit bounds
// WIDEN around whatever the record already holds. They live here — pure, dependency-free —
// so `scripts/date-bounds-guard.ts` can assert the no-lockout property directly instead of it
// resting on a comment in a form component.

export interface DateBounds {
  minDate: Date
  maxDate: Date
  defaultMonth: Date
}

/** Local midnight today. Never `new Date(string)` — see the header. */
function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/**
 * Month arithmetic, so Oct + 3 rolls the year. A day absent from the target month
 * (Aug 31 → Nov 31) rolls forward one day, which is harmless for a ceiling.
 */
function monthsAhead(months: number, now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + months, now.getDate())
}

/** How far ahead a fair may be scheduled at CREATION time. */
export const CREATION_HORIZON_MONTHS = 3

/**
 * CREATION: no past dates, hard horizon. `existingStart` is only used to choose the opening
 * month when resuming a draft — a stale draft dated in the past does NOT widen the floor,
 * because it must be re-dated before it can be published.
 */
export function creationDateBounds(existingStart?: CalendarDateString | null, now = new Date()): DateBounds {
  const today = startOfToday(now)
  const draftStart = toPickerDate(existingStart)
  return {
    minDate: today,
    maxDate: monthsAhead(CREATION_HORIZON_MONTHS, now),
    defaultMonth: draftStart && draftStart >= today ? draftStart : today,
  }
}

/**
 * EDITING: bounds widen to include the record's own dates, so they are ALWAYS reachable —
 * that is the no-lockout guarantee. Still floors at today for a normal upcoming fair, so an
 * admin cannot wander back years for no reason.
 */
export function editDateBounds(
  existingStart?: CalendarDateString | null,
  existingEnd?: CalendarDateString | null,
  now = new Date(),
): DateBounds {
  const today = startOfToday(now)
  const horizon = monthsAhead(CREATION_HORIZON_MONTHS, now)
  const start = toPickerDate(existingStart)
  const end = toPickerDate(existingEnd)
  return {
    minDate: start && start < today ? start : today,
    maxDate: end && end > horizon ? end : horizon,
    // DayPicker opens on the CURRENT month by default, so editing any fair not happening this
    // month made you navigate to find its own dates.
    defaultMonth: start ?? today,
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** 'YYYY-MM-DD' → 'Mon, Aug 3, 2026'. Empty string when there is nothing to show. */
export function formatCalendarDate(value: CalendarDateString | null | undefined): string {
  const d = toPickerDate(value)
  if (!d) return ''
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/**
 * Inclusive day count across a range: Aug 3 → Aug 3 is 1 day, Aug 3 → Aug 25 is 23.
 *
 * ⚠️ NOT `(to - from) / 86400000`. Both Dates are LOCAL midnight, so a range spanning a
 * DST transition is 22.958… or 23.042… days and any rounding choice is wrong somewhere —
 * measured: Mar 1 → Mar 24 2026 in America/Chicago floors to 22, losing a day. Normalising
 * the calendar parts through Date.UTC removes the offset entirely and the subtraction is
 * exact integer days.
 */
export function calendarDayCount(
  start: CalendarDateString | null | undefined,
  end: CalendarDateString | null | undefined,
): number | null {
  const a = toPickerDate(start)
  const b = toPickerDate(end)
  if (!a || !b) return null
  const ms = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
    - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const days = ms / 86_400_000
  return days < 0 ? null : days + 1 // inclusive of both endpoints
}
