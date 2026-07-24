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
