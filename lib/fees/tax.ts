// B1.19 SALES TAX — the pure rules (docs/BATCH-1.md B1.19, design agreed 2026-11-18, test plan approved 2026-11-21).
// No server imports: shared by checkout, the order route, the refund engine, reports and the admin rate form.
//
//   Rates      whole thousandths of a percent: 8.35% → 8350, 7.125% → 7125. Two optional parts per event (sales,
//              local food & beverage). Each 0..15% (0..15000). null = that part isn't charged.
//   Rounding   PER VENDOR, PER PART, HALF UP: floor((foodCents × rateMilli + 50,000) / 100,000). The order's tax
//              is the SUM of the stored parts; there is no order-level calculation.
//   Base       food only. Fees (service fee, curbside fee) and tips are never taxed.
//   Partial    a refund of `a` food cents out of a vendor's `d` food cents returns, per part,
//   refunds    floor((2 × part × a + d) / (2 × d)) — the exact half-up of part × a / d for even and odd d —
//              capped at the stored part. A full vendor refund returns exactly the stored parts.

export const TAX_RATE_MAX_MILLI = 15_000 // 15%
export const TAX_RATE_SCALE = 100_000 // rateMilli is thousandths of a percent: rate = rateMilli / 100,000

export interface TaxRates { salesTaxRateMilli: number | null; localTaxRateMilli: number | null }
export interface VendorTax { vendorId: string; foodCents: number; salesTaxCents: number; localTaxCents: number }

const assertCents = (what: string, n: number) => {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} must be a non-negative whole number of cents (got ${n})`)
}
const assertRate = (what: string, r: number | null) => {
  if (r === null) return
  if (!Number.isInteger(r) || r < 0 || r > TAX_RATE_MAX_MILLI) throw new Error(`${what} must be a whole number 0..${TAX_RATE_MAX_MILLI} (got ${r})`)
}

/** One part's tax on one vendor's food: half up, exact integer arithmetic. */
export function taxPartCents(foodCents: number, rateMilli: number | null): number {
  assertCents('foodCents', foodCents)
  assertRate('rateMilli', rateMilli)
  if (!rateMilli) return 0
  return Math.floor((foodCents * rateMilli + TAX_RATE_SCALE / 2) / TAX_RATE_SCALE)
}

/** Each vendor's tax, per part. Vendors with no food get no row. */
export function vendorTaxes(vendorFoodCents: Record<string, number>, rates: TaxRates): VendorTax[] {
  assertRate('salesTaxRateMilli', rates.salesTaxRateMilli)
  assertRate('localTaxRateMilli', rates.localTaxRateMilli)
  return Object.keys(vendorFoodCents).sort().filter(id => vendorFoodCents[id] > 0).map(vendorId => {
    const foodCents = vendorFoodCents[vendorId]
    return { vendorId, foodCents, salesTaxCents: taxPartCents(foodCents, rates.salesTaxRateMilli), localTaxCents: taxPartCents(foodCents, rates.localTaxRateMilli) }
  })
}

export const totalTaxCents = (rows: Pick<VendorTax, 'salesTaxCents' | 'localTaxCents'>[]) =>
  rows.reduce((s, r) => s + r.salesTaxCents + r.localTaxCents, 0)

export const hasTax = (rates: TaxRates) => !!rates.salesTaxRateMilli || !!rates.localTaxRateMilli

/** Tax returned, per part, when `refundedFoodCents` of a vendor's `vendorFoodCents` is refunded. */
export function refundTaxParts(
  stored: { salesTaxCents: number; localTaxCents: number },
  refundedFoodCents: number,
  vendorFoodCents: number,
): { salesTaxCents: number; localTaxCents: number } {
  assertCents('refundedFoodCents', refundedFoodCents)
  assertCents('vendorFoodCents', vendorFoodCents)
  assertCents('stored sales tax', stored.salesTaxCents)
  assertCents('stored local tax', stored.localTaxCents)
  if (refundedFoodCents > vendorFoodCents) throw new Error(`refunded food ${refundedFoodCents}¢ exceeds the vendor's food ${vendorFoodCents}¢`)
  if (vendorFoodCents === 0 || refundedFoodCents === 0) return { salesTaxCents: 0, localTaxCents: 0 }
  if (refundedFoodCents === vendorFoodCents) return { salesTaxCents: stored.salesTaxCents, localTaxCents: stored.localTaxCents }
  const share = (part: number) => Math.min(part, Math.floor((2 * part * refundedFoodCents + vendorFoodCents) / (2 * vendorFoodCents)))
  return { salesTaxCents: share(stored.salesTaxCents), localTaxCents: share(stored.localTaxCents) }
}

/** Admin form input → rateMilli. '' / null → null (not charged). Exact text: at most 3 decimals, 0..15. */
export type ParsedRate = { ok: true; value: number | null } | { ok: false; error: string }
export function parseTaxRatePercent(raw: unknown): ParsedRate {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  const text = String(raw).trim().replace(/%$/, '').trim()
  if (text === '') return { ok: true, value: null }
  const m = /^(\d{1,2})(?:\.(\d{1,3}))?$/.exec(text)
  if (!m) return { ok: false, error: 'Enter a percent like 8.35 (at most 3 decimal places, no other characters)' }
  const value = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'))
  if (value > TAX_RATE_MAX_MILLI) return { ok: false, error: 'A tax rate can be at most 15%' }
  return { ok: true, value }
}

/** rateMilli → "8.35%" (trailing zeros dropped) or "—" when not charged. */
export function formatTaxRate(rateMilli: number | null): string {
  if (rateMilli === null) return '—'
  const whole = Math.floor(rateMilli / 1000), frac = String(rateMilli % 1000).padStart(3, '0').replace(/0+$/, '')
  return `${whole}${frac ? `.${frac}` : ''}%`
}
