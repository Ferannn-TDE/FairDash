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

// ── ONLINE PRICE MARKUP (audit H5, step 2h; decisions Jordan, Nov 15) ────────────────────────────
//
// Each event has an online markup in basis points (1 bp = 0.01%): 0 = 0%, 715 = 7.15%, 1000 = 10%.
// Online price = in-person price × (1 + markup), worked out PER UNIT in integer cents, rounded
// half-up. The markup goes to the vendor; the 10% service fee stays on the in-person price.
//
// The 10% cap is THIS constant, not an admin or database setting. Out-of-range values are refused,
// never clamped (it is a money setting).

/** 0%: with no markup set, the online price equals the in-person price. */
export const MARKUP_BPS_DEFAULT = 0
/** 10%, the fixed cap. */
export const MARKUP_BPS_MAX = 1000

export const MARKUP_RANGE_MESSAGE = 'Online price markup must be a whole number of basis points from 0 to 1000 (0% to 10%)'

export type MarkupParse = { ok: true; bps: number } | { ok: false; message: string }

/**
 * Parse an untrusted markup in basis points. Only a JavaScript number that is a whole number from
 * 0 to 1000 is accepted. Strings ("5"), booleans, null, fractions (2.5), NaN and Infinity are
 * refused, so nothing is quietly converted.
 */
export function parseMarkupBps(input: unknown): MarkupParse {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 0 || input > MARKUP_BPS_MAX) {
    return { ok: false, message: MARKUP_RANGE_MESSAGE }
  }
  return { ok: true, bps: input }
}

/**
 * The online unit price in cents: inPersonCents × (10000 + bps) / 10000, rounded half-up.
 * Integer arithmetic only (the largest product, 1,000,000 × 11,000, is far inside the safe range).
 *   333¢ at 750 bp → 357.975 → 358¢ ($3.33 at 7.5% → $3.58)
 *   105¢ at 1000 bp → 115.5 → 116¢ (half a cent rounds up)
 */
export function onlinePriceCents(inPersonCents: number, bps: number): number {
  if (!Number.isInteger(inPersonCents) || inPersonCents < 0) throw new Error(`onlinePriceCents: bad cents ${inPersonCents}`)
  if (!Number.isInteger(bps) || bps < 0 || bps > MARKUP_BPS_MAX) throw new Error(`onlinePriceCents: bad markup ${bps}`)
  return Math.floor((inPersonCents * (10000 + bps) + 5000) / 10000)
}

/** The online unit price in dollars, from an in-person price in dollars (stored prices have ≤ 2 decimals). */
export function onlinePrice(inPersonDollars: number, bps: number): number {
  return onlinePriceCents(Math.round(inPersonDollars * 100), bps) / 100
}

/**
 * A percentage typed on a settings screen → basis points, with Math.round: 7.15 × 100 is
 * 715.0000000000001 in JavaScript, and the server refuses anything that is not a whole number.
 * Returns null for an empty or non-numeric entry. Does not range-check: the server does, so the
 * screen shows the server's message.
 */
export function percentToBps(percent: number | string): number | null {
  const n = typeof percent === 'number' ? percent : (percent.trim() === '' ? NaN : Number(percent))
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

/** Basis points → a percentage for display (715 → 7.15). */
export function bpsToPercent(bps: number): number {
  return bps / 100
}

export const MARKUP_PERCENT_RANGE_MESSAGE = 'Online markup must be between 0% and 10%'
export const MARKUP_PERCENT_NUMBER_MESSAGE = 'Enter the online markup as a number, for example 5 or 7.5'
export const MARKUP_PERCENT_DECIMALS_MESSAGE = 'Online markup can have at most 2 decimal places'
/** Shown by the server (409 MARKUP_LOCKED) and on the organizer settings screen: one sentence. */
export const MARKUP_LOCKED_MESSAGE =
  'The online price markup is locked because this event has started. Contact FairSynq if it needs to change.'

export type MarkupPercentParse = { ok: true; bps: number } | { ok: false; message: string }

/**
 * A percentage typed on a settings screen → basis points, or why it is refused. Never clamps: a
 * value over 10% is an error for the person to fix, not something quietly saved as 10%.
 *   "7.15" → 715 · "8.2" → 820 (Math.round, see percentToBps) · "10" → 1000
 *   "" / "abc" → not a number · "7.155" → too many decimals · "10.5" / "-1" → out of range
 */
export function parseMarkupPercentInput(input: string): MarkupPercentParse {
  const trimmed = input.trim()
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return { ok: false, message: MARKUP_PERCENT_NUMBER_MESSAGE }
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return { ok: false, message: MARKUP_PERCENT_NUMBER_MESSAGE }
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { ok: false, message: MARKUP_PERCENT_DECIMALS_MESSAGE }
  const bps = percentToBps(n)
  if (bps === null || bps < 0 || bps > MARKUP_BPS_MAX) return { ok: false, message: MARKUP_PERCENT_RANGE_MESSAGE }
  return { ok: true, bps }
}

// ── CLIENT-SENT PRICES ARE REFUSED (2h) ──────────────────────────────────────────────────────────
// The server works out the online price itself. A request that carries any of these keys is
// refused with 400 CLIENT_PRICE_NOT_ACCEPTED, rather than silently ignored, so a client that thinks
// it is setting a price learns that it is not. FairSynq's own pages never send them.

/** Keys refused on a menu item (create, edit, menu request) and at checkout. */
export const CLIENT_MARKUP_KEYS = ['onlinePrice', 'onlineMarkupBps', 'markup'] as const
/** Keys refused on a checkout cart line: the line names an item and a quantity, never a price. */
export const CLIENT_LINE_PRICE_KEYS = ['price', 'unitPrice', 'totalPrice', 'subtotal', 'inPersonPrice', ...CLIENT_MARKUP_KEYS] as const
/**
 * Keys refused on a checkout BODY (review F8): the server works out every total itself. Before
 * Nov 17 these were silently ignored. `tip` is NOT here: it is real customer input. The real
 * checkout body (app/fair/[fairSlug]/checkout/page.tsx) sends none of these.
 */
export const CLIENT_ORDER_TOTAL_KEYS = ['total', 'subtotal', 'serviceFee', 'deliveryFee', ...CLIENT_MARKUP_KEYS] as const

export const CLIENT_PRICE_MESSAGE = 'Prices are worked out by FairSynq. Remove the online price or markup from this request.'

/** The first refused key present on `obj` (own property, any value), or null. */
export function clientPriceKey(obj: unknown, keys: readonly string[] = CLIENT_MARKUP_KEYS): string | null {
  if (!obj || typeof obj !== 'object') return null
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) return k
  return null
}
