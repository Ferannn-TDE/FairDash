// CHECKOUT TOTAL — the ONE calculation of what a customer pays (audit H5, step 2h).
//
// POST /api/orders charges this total and the checkout page shows it (and sends it back as
// expectedTotalCents). Both call this function with the same inputs, so they cannot drift: a
// difference can only mean a price really changed in between, which the server answers with
// 409 PRICE_CHANGED instead of charging more than the customer saw.
//
// THE MONEY RULES (Jordan, Nov 15):
//   - each unit is charged its ONLINE price: in-person × (1 + markup), per unit, integer cents,
//     half-up (onlinePriceCents in lib/menu/price.ts);
//   - food subtotal = Σ online unit × quantity: what the customer pays for food and what vendors
//     are paid on, so the markup reaches the vendor through the existing payout split;
//   - the 10% service fee is on the IN-PERSON subtotal only (calculateServiceFee, unchanged);
//   - total = food + service fee + delivery/curbside fee + service charge + tip (the 5-term identity).
//
// Integer cents throughout. Dollar inputs (a fee from config, a tip) go through toCents() once.
//
// Import-free apart from two import-free modules, so the checkout page can use it in the browser.

import { onlinePriceCents } from './menu/price'
import { calculateServiceFee } from './constants'

export type CheckoutLine = {
  /** The item's in-person price in cents (MenuItem.price × 100). */
  inPersonCents: number
  quantity: number
}

export type CheckoutTotalsInput = {
  lines: CheckoutLine[]
  /** Event.onlineMarkupBps: 0–1000. */
  markupBps: number
  deliveryFeeCents: number
  serviceChargeCents: number
  tipCents: number
}

export type CheckoutTotals = {
  /** Online unit price per line, in the same order as `lines`. */
  unitCents: number[]
  /** Online unit × quantity per line. */
  lineCents: number[]
  onlineSubtotalCents: number
  /** Σ in-person unit × quantity: the base of the 10% service fee. */
  feeBaseCents: number
  serviceFeeCents: number
  deliveryFeeCents: number
  serviceChargeCents: number
  tipCents: number
  totalCents: number
}

/**
 * Dollars → whole cents, half-up. One rounding for every dollar amount on both sides, so a custom
 * tip typed as 3.335 is the same number of cents on the page and on the server.
 * Non-finite or missing → 0.
 */
export function toCents(dollars: number | null | undefined): number {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars)) return 0
  return Math.round(dollars * 100)
}

/** Cents → dollars for storing in the Float columns and showing (always an exact 2-decimal value). */
export function fromCents(cents: number): number {
  return cents / 100
}

/**
 * THE online unit price, in cents, for one in-person price. Every online price a customer sees
 * (menus, vendor page, favorites, cart, checkout) and every unit checkoutTotals() charges goes
 * through this one function, so a displayed price and a charged price cannot differ.
 *
 * A legacy row priced at or below zero (before the $1 rule) is passed through unchanged, so it
 * still reaches the checkout floor, which refuses it.
 */
export function onlineUnitCents(inPersonCents: number, markupBps: number): number {
  if (!Number.isInteger(inPersonCents)) throw new Error(`onlineUnitCents: bad in-person cents ${inPersonCents}`)
  return inPersonCents > 0 ? onlinePriceCents(inPersonCents, markupBps) : inPersonCents
}

/** The online unit price in dollars, from a stored in-person price in dollars (for API payloads). */
export function onlineUnitPrice(inPersonDollars: number, markupBps: number): number {
  return fromCents(onlineUnitCents(toCents(inPersonDollars), markupBps))
}

// ── THE CART (browser) ───────────────────────────────────────────────────────────────────────────
// The cart works out its prices with these, from each line's in-person price and the fair's markup,
// so the cart, the checkout page and the server all use the one calculator above.

/** A cart line as the browser stores it. `inPersonPrice` is missing on carts saved before 2h. */
export type CartPricingItem = { menuItemId: string; price: number; inPersonPrice?: number; quantity: number }

/**
 * A markup the calculator can use: a whole number 0–1000, else 0. A bad or missing value (never
 * expected) makes the page's total LOWER than the server's, which the server answers with 409
 * PRICE_CHANGED and the real total for the customer to confirm: it can never cause an overcharge.
 */
export function safeMarkupBps(bps: unknown): number {
  return typeof bps === 'number' && Number.isInteger(bps) && bps >= 0 && bps <= 1000 ? bps : 0
}

/**
 * The in-person cents of one cart line. A line saved before 2h has no `inPersonPrice`; its stored
 * `price` is used instead. Before 2h every fair was at 0% markup, so that stored price WAS the
 * in-person price and the total is exact. A line saved after a markup was set always carries
 * `inPersonPrice`; if one somehow does not, its stored (online) price counts as in-person, the
 * page's total comes out HIGHER than the server's, and the server refuses with 409 and the real,
 * lower total for the customer to confirm. Never an overcharge.
 */
export function cartInPersonCents(item: CartPricingItem): number {
  const p = typeof item.inPersonPrice === 'number' && Number.isFinite(item.inPersonPrice) ? item.inPersonPrice : item.price
  return toCents(p)
}

/** Cart lines in the calculator's form. */
export function cartCalculatorLines(items: CartPricingItem[]): CheckoutLine[] {
  return items.map(i => ({ inPersonCents: cartInPersonCents(i), quantity: i.quantity }))
}

export type CartPricing = {
  /** Online unit price per cart line, by menuItemId. */
  unitCents: Record<string, number>
  /** Online line total per cart line, by menuItemId. */
  lineCents: Record<string, number>
  onlineSubtotalCents: number
}

/** The cart's online prices: checkoutTotals with no fees, so they match checkout to the cent. */
export function cartPricing(items: CartPricingItem[], markupBps: unknown): CartPricing {
  const t = checkoutTotals({
    lines: cartCalculatorLines(items),
    markupBps: safeMarkupBps(markupBps),
    deliveryFeeCents: 0,
    serviceChargeCents: 0,
    tipCents: 0,
  })
  const unitCents: Record<string, number> = {}
  const lineCents: Record<string, number> = {}
  items.forEach((it, i) => { unitCents[it.menuItemId] = t.unitCents[i]; lineCents[it.menuItemId] = t.lineCents[i] })
  return { unitCents, lineCents, onlineSubtotalCents: t.onlineSubtotalCents }
}

function assertWholeCents(name: string, v: number) {
  if (!Number.isInteger(v) || v < 0) throw new Error(`checkoutTotals: ${name} must be whole, non-negative cents (got ${v})`)
}

export function checkoutTotals(input: CheckoutTotalsInput): CheckoutTotals {
  assertWholeCents('deliveryFeeCents', input.deliveryFeeCents)
  assertWholeCents('serviceChargeCents', input.serviceChargeCents)
  assertWholeCents('tipCents', input.tipCents)

  const unitCents: number[] = []
  const lineCents: number[] = []
  let onlineSubtotalCents = 0
  let feeBaseCents = 0
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new Error(`checkoutTotals: bad quantity ${line.quantity}`)
    const inPerson = line.inPersonCents
    const unit = onlineUnitCents(inPerson, input.markupBps)
    unitCents.push(unit)
    lineCents.push(unit * line.quantity)
    onlineSubtotalCents += unit * line.quantity
    feeBaseCents += inPerson * line.quantity
  }

  // The existing fee rule, unchanged (lib/constants.ts), applied to the in-person base. At 0%
  // markup the base equals the food subtotal, so the fee is exactly what it was before 2h.
  const serviceFeeCents = Math.round(calculateServiceFee(fromCents(feeBaseCents)) * 100)

  const totalCents = onlineSubtotalCents + serviceFeeCents + input.deliveryFeeCents + input.serviceChargeCents + input.tipCents

  return {
    unitCents,
    lineCents,
    onlineSubtotalCents,
    feeBaseCents,
    serviceFeeCents,
    deliveryFeeCents: input.deliveryFeeCents,
    serviceChargeCents: input.serviceChargeCents,
    tipCents: input.tipCents,
    totalCents,
  }
}
