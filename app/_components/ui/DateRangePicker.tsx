'use client'

import { DayPicker, type DateRange } from 'react-day-picker'
import { toPickerDate, fromPickerDate } from '@/lib/calendar-date'

/**
 * The shared event date-range picker — one themed calendar, used by every surface that sets a
 * fair's start and end.
 *
 * ── THE CONTRACT: 'YYYY-MM-DD' IN, 'YYYY-MM-DD' OUT ──────────────────────────────────────
 * It is a drop-in replacement for the two native `<input type="date">` pairs it replaces, and
 * it speaks their exact wire format — the same strings the forms already hold and the same
 * ones `new Date(startDate)` parses server-side. Emitting anything else silently breaks fair
 * creation, so the format is the load-bearing part of this component, not the styling.
 *
 * ⚠️ ALL timezone conversion lives in `lib/calendar-date.ts` and NOWHERE ELSE. A calendar grid
 * renders `Date` objects in the viewer's LOCAL zone while a fair date is a UTC-midnight carrier
 * for a calendar day (`lib/event-date.ts` — written after every surface showed fairs starting a
 * day early). Both obvious one-line conversions are wrong in opposite hemispheres;
 * `scripts/date-round-trip-guard.ts` proves it across five timezones and fails on either.
 *
 * NOT the `timeZone="UTC"` prop: it exists in v10 and would suit this, but is flagged
 * experimental in the shipped types. The adapter is four lines, provable without mounting a
 * calendar, and cannot change under us. `timeZone` stays the documented fallback.
 *
 * ── INLINE, NOT A POPOVER ────────────────────────────────────────────────────────────────
 * Both hosts have vertical room, and a popover would need click-outside handling this codebase
 * has no primitive for. Rendering inline gets the themed range with zero new interaction
 * machinery; if popovers are wanted broadly, that primitive should be built deliberately
 * rather than as a rider on this.
 *
 * ── THEME IS BAKED IN ────────────────────────────────────────────────────────────────────
 * Call sites pass no classNames. Keys below are react-day-picker v10's real `UI` /
 * `DayFlag` / `SelectionState` values, read from the shipped types — v8's `rdp-`-prefixed CSS
 * classes and v9's older nav names do not apply here.
 */

interface DateRangeValue {
  /** 'YYYY-MM-DD' or '' when unset. */
  start: string
  /** 'YYYY-MM-DD' or '' when unset. */
  end: string
}

interface Props {
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
  /**
   * Earliest selectable day, 'YYYY-MM-DD'. Days before it are disabled.
   * ⚠️ Deliberately NOT wired to DayPicker's `min`/`max` — in `mode="range"` those are the
   * number of DAYS the range may span, not date bounds. A date passed there would silently
   * mean something else entirely.
   */
  fromDate?: string
  /** Latest selectable day, 'YYYY-MM-DD'. */
  toDate?: string
}

/** One cell: a square, centred, hover-lit day button. */
const DAY_BUTTON =
  'w-9 h-9 rounded-lg text-sm text-white font-inter transition-colors ' +
  'hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-pink/60 ' +
  'disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent cursor-pointer'

export default function DateRangePicker({ value, onChange, fromDate, toDate }: Props) {
  const selected: DateRange | undefined = (() => {
    const from = toPickerDate(value.start)
    if (!from) return undefined
    return { from, to: toPickerDate(value.end) }
  })()

  // `disabled` (a matcher), NOT min/max — see the Props note above.
  const before = toPickerDate(fromDate)
  const after = toPickerDate(toDate)
  const disabled = before || after
    ? [...(before ? [{ before }] : []), ...(after ? [{ after }] : [])]
    : undefined

  return (
    <div className="inline-block rounded-2xl border border-white/10 bg-[#0a0a0a] p-4">
      <DayPicker
        mode="range"
        selected={selected}
        onSelect={range => {
          // A range clears to undefined on re-click; '' is what an empty form field holds, so
          // the existing "start and end are required" checks keep working unchanged.
          onChange({
            start: fromPickerDate(range?.from),
            end: fromPickerDate(range?.to),
          })
        }}
        disabled={disabled}
        showOutsideDays
        classNames={{
          root: 'text-white',
          months: 'flex flex-col',
          month: 'space-y-3',

          // ── Caption + navigation ──────────────────────────────────────────────────────
          month_caption: 'flex items-center justify-center h-9',
          caption_label: 'font-bebas text-xl tracking-wide text-white',
          nav: 'absolute inset-x-0 top-0 flex items-center justify-between h-9 px-1 pointer-events-none',
          button_previous:
            'pointer-events-auto w-8 h-8 rounded-lg flex items-center justify-center text-white ' +
            'hover:bg-white/10 transition-colors disabled:opacity-25 cursor-pointer',
          button_next:
            'pointer-events-auto w-8 h-8 rounded-lg flex items-center justify-center text-white ' +
            'hover:bg-white/10 transition-colors disabled:opacity-25 cursor-pointer',
          chevron: 'w-4 h-4 fill-current',

          // ── Grid ──────────────────────────────────────────────────────────────────────
          month_grid: 'w-full border-collapse',
          weekdays: 'flex',
          weekday: 'w-9 h-8 flex items-center justify-center text-[0.625rem] uppercase tracking-wide text-text-gray font-semibold',
          week: 'flex',
          day: 'p-0 relative',
          day_button: DAY_BUTTON,

          // ── Day flags ─────────────────────────────────────────────────────────────────
          // A ring, never a fill — a filled "today" competes with the selected endpoints and
          // makes an unselected calendar look like it already has a choice in it.
          today: 'ring-1 ring-inset ring-neon-pink/50 rounded-lg',
          outside: '[&_button]:text-text-gray/40',
          disabled: 'opacity-30',
          hidden: 'invisible',

          // ── Selection ─────────────────────────────────────────────────────────────────
          // Endpoints are solid neon-pink; the span between them is a translucent pill, so the
          // two ENDS a user has actually chosen stay visually distinct from what they implied.
          selected: '',
          range_start:
            'rounded-l-lg bg-neon-pink/10 ' +
            '[&_button]:bg-neon-pink [&_button]:text-white [&_button]:font-semibold [&_button]:hover:bg-neon-pink',
          range_end:
            'rounded-r-lg bg-neon-pink/10 ' +
            '[&_button]:bg-neon-pink [&_button]:text-white [&_button]:font-semibold [&_button]:hover:bg-neon-pink',
          range_middle:
            'bg-neon-pink/10 [&_button]:rounded-none [&_button]:text-white [&_button]:hover:bg-white/10',
        }}
      />
    </div>
  )
}
