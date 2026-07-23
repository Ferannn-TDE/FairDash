/**
 * Event dates — the ONE way to render a fair's start/end.
 *
 * A FAIR DATE IS A CALENDAR DATE, NOT AN INSTANT. "Italian Fest runs Aug 5–12" is true for
 * every viewer on earth; it does not shift with their timezone the way "the order was placed
 * at 18:02" does. The two kinds must be formatted differently, and conflating them is what
 * shipped the bug this module exists to end:
 *
 *   Stored:   startDate = 2026-08-05T00:00:00.000Z  (correct — see below)
 *   Rendered: new Date(startDate).toLocaleDateString('en-US', …)
 *   Result:   in America/Chicago (UTC-5 in August) that instant is Aug 4, 19:00 → "Aug 4".
 *
 * Every public and internal surface showed the fair starting and ending ONE DAY EARLY.
 *
 * THE STORED VALUE IS NOT WRONG, so nothing is migrated. The admin round-trip is already
 * consistent: the settings form writes `new Date('2026-08-05')` (UTC midnight) and reads back
 * `toISOString().slice(0, 10)` → '2026-08-05'. The instant is simply a CARRIER for a calendar
 * date, and the carrier must be read in the same zone it was written in — UTC. Formatting with
 * `timeZone: 'UTC'` returns the intended day for every viewer, which is the whole point.
 *
 * DO NOT use these helpers for timestamps (order.placedAt, custody events, payouts). Those are
 * real instants and SHOULD render in the viewer's local zone — a vendor reading "18:02" wants
 * their own clock. `app/fair/[fairSlug]/orders/page.tsx` formats placedAt locally on purpose.
 */

/**
 * The zone a fair date is stored in and must be read in. Not the venue's zone and not the
 * viewer's: the carrier's. Changing this without changing how the admin form writes would
 * re-introduce the off-by-one.
 */
export const EVENT_DATE_ZONE = 'UTC'

const BASE: Intl.DateTimeFormatOptions = { timeZone: EVENT_DATE_ZONE }

type Dateish = string | Date | null | undefined

function toDate(value: Dateish): Date | null {
  if (!value) return null
  // A date-only string ('2026-08-05') parses as UTC midnight already; a full ISO string keeps
  // its instant. Both land on the same calendar day once formatted in UTC.
  const d = value instanceof Date ? value : new Date(value.includes('T') ? value : `${value}T00:00:00.000Z`)
  return isNaN(d.getTime()) ? null : d
}

/** One fair date. Returns null (never a placeholder string) when there is nothing to show. */
export function formatEventDate(value: Dateish, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string | null {
  const d = toDate(value)
  return d ? d.toLocaleDateString('en-US', { ...opts, ...BASE }) : null
}

/**
 * A fair's run: "Aug 5 – Aug 12, 2026". The year rides on the end only (it is the same year in
 * every case we render), and a single-day fair collapses to one date rather than "Aug 5 – Aug 5".
 */
export function formatEventDateRange(start: Dateish, end: Dateish, fallback = 'Dates TBA'): string {
  const s = formatEventDate(start, { month: 'short', day: 'numeric' })
  if (!s) return fallback
  const e = formatEventDate(end, { month: 'short', day: 'numeric', year: 'numeric' })
  const sFull = formatEventDate(start, { month: 'short', day: 'numeric', year: 'numeric' })
  if (!e || e === sFull) return sFull ?? fallback
  return `${s} – ${e}`
}

/** 'YYYY-MM-DD' for an <input type="date">, in the same zone the value was written in. */
export function toEventDateInput(value: Dateish): string {
  const d = toDate(value)
  return d ? d.toISOString().slice(0, 10) : ''
}
