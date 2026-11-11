// MENU ITEM PRICE — the single rule for every price a vendor can set (audit H5).
//
// Three paths write a menu price: POST /api/menu (direct create), PATCH /api/menu/[id] (direct
// edit), and the menu-request path (lib/menu-requests/validate-item.ts, copied onto the item at
// approval). Before this, the direct paths stored `Number(price)` with no bounds at all —
// negative, NaN and $1,000,000 prices included — and the request path had its own inline rule
// ($0.01–$10,000, any number of decimals). One rule here, compared in integer cents, so the paths
// cannot drift.
//
// THE RULE (decision 2026-11-11, permanent): at least $1.00, at most $10,000.00, at most two
// decimal places. No free items.
//
// Import-free on purpose: the vendor menu page imports the bounds and the message from here, so
// the browser and the server state the same minimum.

/** $1.00. A permanent floor, not a placeholder: no free items, nothing under a dollar. */
export const MIN_PRICE_CENTS = 100
/** $10,000.00. */
export const MAX_PRICE_CENTS = 1_000_000

export const PRICE_MIN_MESSAGE = 'Price must be at least $1.00'
export const PRICE_RANGE_MESSAGE = 'Price must be between $1.00 and $10,000'
export const PRICE_NUMBER_MESSAGE = 'Price must be a number'
export const PRICE_DECIMALS_MESSAGE = 'Price can have at most 2 decimal places'

export type PriceParse =
  | { ok: true; value: number; cents: number }
  | { ok: false; message: string }

/** A plain decimal: digits, optionally a point and one or two more digits. No sign, exponent or spaces. */
const PRICE_STRING = /^\d+(\.\d{1,2})?$/

/**
 * Parse an untrusted price into dollars and cents, or say why it is refused.
 *
 * Accepts a finite number, or a string in plain decimal form ("12", "12.5", "12.50"). Refuses
 * everything else, including booleans and null (which `Number()` would quietly turn into 1 or 0),
 * exponents ("1e3"), signs, and empty strings.
 *
 * The decimal check is done in cents with a small tolerance, because binary floating point
 * cannot hold most two-decimal values exactly (0.29 * 100 is 28.999999999999996). A genuine third
 * decimal (1.234 → 123.4 cents) is far outside that tolerance and is refused.
 */
export function parseInPersonPrice(input: unknown): PriceParse {
  let n: number
  if (typeof input === 'number') {
    n = input
  } else if (typeof input === 'string') {
    if (!PRICE_STRING.test(input)) {
      // "-1" is a number, just a refused one: say so in range terms, not "not a number".
      return { ok: false, message: /^-\d+(\.\d+)?$/.test(input) ? PRICE_RANGE_MESSAGE : PRICE_NUMBER_MESSAGE }
    }
    n = Number(input)
  } else {
    return { ok: false, message: PRICE_NUMBER_MESSAGE }
  }

  if (!Number.isFinite(n)) return { ok: false, message: PRICE_NUMBER_MESSAGE }

  const cents = Math.round(n * 100)
  if (Math.abs(n * 100 - cents) > 1e-6) return { ok: false, message: PRICE_DECIMALS_MESSAGE }
  if (cents < MIN_PRICE_CENTS || cents > MAX_PRICE_CENTS) return { ok: false, message: PRICE_RANGE_MESSAGE }

  return { ok: true, value: cents / 100, cents }
}
