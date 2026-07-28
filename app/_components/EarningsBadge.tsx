// Shared vendor-earnings display. One component so dashboard / analytics / orders label
// take-home identically and a vendor can't be misled. Settled cash and a pending estimate
// are VISUALLY distinct (solid emerald "$X earned" vs muted "~$X pending" with a tilde) —
// an estimate must never read as cash in hand.

export type EarningsStatus = 'settled' | 'estimated' | 'refunded' | 'reversed' | 'declined' | 'excluded'

const fmt = (n: number) => `$${(n ?? 0).toFixed(2)}`

/**
 * ONE SHAPE PER STATE. The amount and its label are always the same two pieces in the same
 * two places — only the colour and the words change. Previously each state was its own
 * free-flowing text run of a different width ("$29.79 earned", "~$6.92 pending", a bare
 * "—"), which is why the amount column never lined up down a list.
 *
 * The colour coding is meaningful and is kept:
 *   settled   emerald  — real, banked money
 *   estimated white/amber, and a ~ prefix — an ESTIMATE, never read as cash in hand
 *   refunded  muted/amber
 *   reversed  muted/red — clawed back
 *   declined  muted     — the vendor earned nothing (never a bare dash; see below)
 */
// Exclude<…, 'excluded'> is deliberate: that state has NO shape because it renders nothing.
// Typing it out of the map means the compiler enforces the early return rather than letting a
// dummy '$0 excluded' entry sit here waiting to be rendered by accident.
const STATE: Record<Exclude<EarningsStatus, 'excluded'>, { amount: (n: number) => string; label: string; amountClass: string; labelClass: string }> = {
  settled:   { amount: n => fmt(n),  label: 'earned',       amountClass: 'text-emerald-400', labelClass: 'text-emerald-400/60' },
  estimated: { amount: n => `~${fmt(n)}`, label: 'pending', amountClass: 'text-white/70',    labelClass: 'text-amber-400/70' },
  refunded:  { amount: n => fmt(n),  label: 'refunded',     amountClass: 'text-white/40',    labelClass: 'text-amber-400/70' },
  reversed:  { amount: () => fmt(0), label: 'charged back', amountClass: 'text-white/40',    labelClass: 'text-red-400/70' },
  // A bare "—" reads as missing data. It isn't: a declined order means the vendor earned
  // nothing, which is a FACT worth stating rather than a gap worth guessing at.
  declined:  { amount: () => fmt(0), label: 'declined',     amountClass: 'text-white/30',    labelClass: 'text-white/25' },
  // 'excluded' is deliberately ABSENT — it renders NOTHING (see the early return below), so it
  // has no shape here. A written-off slice with a "$0 excluded" label would invite a question
  // whose only honest answer is "a testing accident"; the slice was never real, so it does not
  // appear. This is the one state that is not a fact about the vendor's money.
}

export function EarningsBadge({
  amount,
  status,
  size = 'sm',
  /**
   * 'inline'  — amount and label on one line (dashboard cards, inline contexts).
   * 'stacked' — amount over label, RIGHT-ALIGNED, tabular figures. For LIST COLUMNS, where
   *             every row must occupy the same footprint and the digits must line up so a
   *             vendor can scan straight down and compare.
   */
  variant = 'inline',
}: {
  amount: number
  status: EarningsStatus
  size?: 'sm' | 'lg'
  variant?: 'inline' | 'stacked'
}) {
  // ⛔ THE SLICE DOES NOT APPEAR. `excluded` means the record is not real (see
  // lib/pollution-cohort.ts) — not that the vendor earned zero. Rendering nothing is the
  // whole point: no line, no zero, no label. Returning null here rather than at each call
  // site means every vendor surface inherits it from the one badge they all already use.
  if (status === 'excluded') return null

  const s = STATE[status]
  const text = size === 'lg' ? 'text-base' : 'text-sm'

  if (variant === 'stacked') {
    return (
      <span className="flex flex-col items-end leading-tight">
        {/* tabular-nums keeps every digit the same width, so decimal points align down the
            column — the thing that actually makes an amount column scannable. */}
        <span className={`font-bold tabular-nums ${text} ${s.amountClass}`}>{s.amount(amount)}</span>
        <span className={`text-[0.6rem] font-semibold uppercase tracking-wide ${s.labelClass}`}>{s.label}</span>
      </span>
    )
  }

  return (
    <span className={`font-bold tabular-nums ${text} ${s.amountClass}`}>
      {s.amount(amount)}{' '}
      <span className={`text-[0.6rem] font-semibold uppercase tracking-wide ${s.labelClass}`}>{s.label}</span>
    </span>
  )
}
