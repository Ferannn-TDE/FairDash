// Exact admin-text → integer conversion for the money settings (item 10 / B1.13 stage 2, S2-Q2).
//
// NO FLOAT MATHS. "3.99" is split into its digits and assembled as 3 × 100 + 99 = 399; it is never
// parsed as the float 3.99 and multiplied (Math.round(4.35 × 100) and friends are exactly where cents
// go missing). Percent and dollars share one rule: at most 2 decimals, no sign, no commas, no symbols,
// no exponent. A number arriving from the API is turned back into its shortest text first, so 3.99
// stays "3.99".
//
//   dollars "3.99"  → 399 cents        percent "12.5" → 1250 basis points
//
// Pure, so scripts/money-settings-test.ts [1] pins every case.

export type Exact = { ok: true; value: number } | { ok: false; error: string }

const PLAIN = /^\d{1,6}(\.\d{1,2})?$/

/** Text with at most 2 decimals → an integer number of hundredths ("3.99" → 399, "15" → 1500). */
export function parseHundredths(raw: unknown, example: string): Exact {
  if (raw === null || raw === undefined) return { ok: false, error: 'Enter a value' }
  if (typeof raw !== 'string' && typeof raw !== 'number') return { ok: false, error: `Enter a number, e.g. ${example}` }
  const t = String(raw).trim()
  if (!t) return { ok: false, error: 'Enter a value' }
  if (t.includes(',')) return { ok: false, error: `No commas, e.g. ${example}` }
  if (t.startsWith('-')) return { ok: false, error: 'Must not be negative' }
  if (/^\d+\.\d{3,}$/.test(t)) return { ok: false, error: 'At most 2 decimal places' }
  if (!PLAIN.test(t)) return { ok: false, error: `Enter a number, e.g. ${example}` }
  const [whole, frac = ''] = t.split('.')
  return { ok: true, value: Number(whole) * 100 + Number(frac.padEnd(2, '0')) }
}

/** Dollars text → cents, within [0, maxCents]. */
export function dollarsToCents(raw: unknown, maxCents: number): Exact {
  const p = parseHundredths(raw, '3.99')
  if (!p.ok) return p
  if (p.value > maxCents) return { ok: false, error: `At most ${formatCents(maxCents)}` }
  return p
}

/** Percent text → basis points, within [0, maxBps]. */
export function percentToBps(raw: unknown, maxBps: number): Exact {
  const p = parseHundredths(raw, '15')
  if (!p.ok) return p
  if (p.value > maxBps) return { ok: false, error: `At most ${formatBps(maxBps)}` }
  return p
}

/** 399 → "$3.99", 0 → "$0.00". */
export function formatCents(cents: number): string {
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

/** 1500 → "15%", 1250 → "12.5%", 1525 → "15.25%". */
export function formatBps(bps: number): string {
  const whole = Math.floor(bps / 100), frac = bps % 100
  if (frac === 0) return `${whole}%`
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}%`
}

/** For the admin form: the stored integer back to editable text (399 → "3.99", 1250 → "12.5"). */
export function centsToText(cents: number): string {
  return formatCents(cents).slice(1)
}
export function bpsToText(bps: number): string {
  return formatBps(bps).slice(0, -1)
}
