/**
 * Audit / money TIMESTAMPS — the ONE way to render a moment on a money or audit surface.
 *
 * NOT THE SAME THING AS lib/event-date.ts, and the distinction is load-bearing:
 *
 *   • lib/event-date.ts formats CALENDAR DATES (a fair runs Aug 5–12). Those are the same for
 *     every viewer and are pinned to the carrier zone — formatting them in a viewer's zone
 *     shifted both ends by a day, which is the bug that module exists to prevent.
 *   • THIS module formats INSTANTS (a refund was recorded at 12:21:50). An instant is a real
 *     moment on the clock; it does not get pinned to a carrier zone, it gets rendered in a
 *     STATED zone so two people reading the same audit row mean the same moment.
 *
 * Applying either to the other's data is the same conflation in opposite directions, so neither
 * module imports the other and both say so.
 *
 * The bug this fixes: Recent Money Actions rendered `new Date(x).toLocaleString()` — no locale,
 * no zone — so a US fair's audit log displayed `19/07/2026, 12:21:50` (DD/MM/YYYY) for anyone
 * whose browser was set to a non-US locale. On a money surface, a date that reads differently
 * depending on who opens it is a reconciliation hazard: 07/08 is two different days.
 *
 * So: locale is ALWAYS explicit ('en-US'), and the zone is ALWAYS named in the output
 * (timeZoneName: 'short' → "Jul 19, 2026, 12:21 PM CDT"). A reader never has to guess which zone
 * a money timestamp is in. Pass `timeZone` to pin it — an event-scoped log should pass the
 * fair's `Event.timezone` so every admin sees the wall-clock the fair actually ran on; without
 * it the viewer's own zone is used, and the label keeps that honest rather than silent.
 */

const AUDIT_LOCALE = 'en-US'

export interface AuditTimeOpts {
  /** IANA zone (e.g. the fair's `Event.timezone`). Omitted → the viewer's zone, always labelled. */
  timeZone?: string
  /** Drop the seconds — for dense lists where the minute is enough. */
  omitSeconds?: boolean
}

/** Full money/audit stamp: "Jul 19, 2026, 12:21:50 PM CDT". Null-safe (→ em dash). */
export function formatAuditTimestamp(value: string | Date | null | undefined, opts: AuditTimeOpts = {}): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(AUDIT_LOCALE, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    ...(opts.omitSeconds ? {} : { second: '2-digit' }),
    timeZoneName: 'short',
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  })
}

/** Date-only variant for audit lists that group by day: "Jul 19, 2026". */
export function formatAuditDate(value: string | Date | null | undefined, opts: AuditTimeOpts = {}): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(AUDIT_LOCALE, {
    year: 'numeric', month: 'short', day: 'numeric',
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  })
}

// ─── DAY BUCKETING — "did this instant happen today, where the fair is?" ─────────────────────
//
// THE BUG THIS EXISTS TO KILL (prod, measured 2026-08-03). Two surfaces computed "today" as
// `new Date(nowMs); setHours(0, 0, 0, 0)` — the SERVER's local midnight. Vercel runs UTC, so
// during a Chicago evening "today" had already rolled over to tomorrow. A runner's two Aug-2
// deliveries (11:03 AM and 9:19 PM Chicago) landed on opposite sides of the UTC boundary:
// "1 delivery / $11.50" when the truth was "2 / $21.00". The next Chicago morning the same
// code reported the previous evening's delivery as today's.
//
// ⚠️ IT DOES NOT REPRODUCE ON A CHICAGO LAPTOP. `setHours` is correct when the host zone
// happens to equal the fair's zone, so local dev and 89 green suites all agreed with the bug.
// Anything asserting on this must force the host zone (see scripts/runner-today-boundary-guard.ts).
//
// This belongs in THIS module and not lib/event-date.ts, and the distinction is the one the
// header above already draws: a delivery timestamp is an INSTANT (a real moment), bucketed into
// a wall-clock day in a STATED zone. A fair's Aug 5–12 run is a CALENDAR DATE pinned to the
// carrier zone — a different thing, which is why event-date.ts pins to EVENT_DATE_ZONE and this
// takes the zone as a required argument.
//
// THE ZONE IS ALWAYS PASSED IN, NEVER DEFAULTED. A fallback of 'America/Chicago' would be right
// for today's only fair and silently wrong for the first fair in another zone — the same
// assume-a-timezone mistake in a smaller costume. `Event.timezone` is non-nullable with a schema
// default, so callers always have a real value to pass.

/** The offset (ms) to ADD to a UTC instant to get the wall-clock reading in `timeZone`. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instantMs))
  const g = (t: string) => Number(parts.find(p => p.type === t)!.value)
  // hour can format as 24 at midnight under hour12:false — %24 normalises it.
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - instantMs
}

/**
 * The instant at which the calendar day containing `nowMs` began, in `timeZone`.
 *
 * Compare real timestamps against this to bucket them into "today where the fair is":
 *   row.createdAt >= startOfDayInZone(Date.now(), event.timezone)
 *
 * Host-zone independent by construction — it reads the zone through Intl rather than through the
 * process's own clock, so it returns the same instant on a UTC server and a Chicago laptop
 * (asserted in the guard). DST-safe: the offset is resolved at the candidate instant and then
 * re-resolved once, which settles spring-forward/fall-back days where the offset at UTC-midnight
 * differs from the offset at local midnight.
 */
export function startOfDayInZone(nowMs: number, timeZone: string): Date {
  // 'en-CA' yields YYYY-MM-DD, the same key idiom lib/event-date.ts uses for calendar days.
  const dayKey = new Date(nowMs).toLocaleDateString('en-CA', { timeZone })
  const naiveMidnightUtc = Date.parse(`${dayKey}T00:00:00Z`)
  let ms = naiveMidnightUtc - zoneOffsetMs(naiveMidnightUtc, timeZone)
  ms = naiveMidnightUtc - zoneOffsetMs(ms, timeZone)
  return new Date(ms)
}
