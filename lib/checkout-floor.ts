// CHECKOUT FLOOR — the orders checkout refuses before any money exists (audit H5, Step 2b).
//
// WHY. Vendors absorb the real Stripe processing fee out of their food slice (the payout worker
// charges the whole settled fee to the food subtotal: lib/process-payout.ts, splitStripeFee). So an
// order whose food is smaller than the card fee on the full charge pays the vendor nothing or less,
// and an order with no food at all makes splitStripeFee throw. Stripe also refuses USD charges
// under $0.50. Item prices now start at $1.00 (lib/menu/price.ts), but rows priced before that rule
// can still exist until the database CHECK constraint lands, and a large delivery fee, service
// charge or tip can still dwarf a small food total. These three refusals run in POST /api/orders
// after the total is known and before any database write or Stripe call.
//
// THE ESTIMATE IS A FLOOR, NOT THE REAL FEE. It is Stripe's standard US card price, 2.9% + 30¢,
// on the full charge. International cards and currency conversion cost more, and the real fee is
// only known after settlement. An order that just passes can still leave a vendor slice at or below
// zero after the real fee; the payout worker's `non_positive` PayoutHold stays the backstop for that.
//
// Import-free on purpose: the checkout page will show the same message from the same function.

/** Stripe's standard US card rate, 2.9%, as parts per thousand. */
export const STRIPE_PCT_PER_MILLE = 29
/** Stripe's standard US per-charge fee, 30¢. */
export const STRIPE_FIXED_CENTS = 30
/** Stripe's minimum USD charge, $0.50. */
export const MIN_CHARGE_CENTS = 50

export const ORDER_SUBTOTAL_ZERO_MESSAGE = 'Add at least one paid item to place an order.'
export const ORDER_BELOW_PROCESSING_FEE_MESSAGE =
  'This order is too small to process online: the card processing fee would be more than the food total. ' +
  'Add more items, or order in person at the booth.'
export const ORDER_BELOW_MINIMUM_MESSAGE = 'Online orders must total at least $0.50.'

export type CheckoutRefusalCode = 'ORDER_SUBTOTAL_ZERO' | 'ORDER_BELOW_PROCESSING_FEE' | 'ORDER_BELOW_MINIMUM'

export interface CheckoutRefusal {
  code: CheckoutRefusalCode
  message: string
}

/**
 * The estimated Stripe fee on a charge of `totalCents`: 2.9% rounded half-up to the cent, plus 30¢.
 * Integer arithmetic only, so it gives the same answer in the browser and on the server.
 */
export function estimatedStripeFeeCents(totalCents: number): number {
  return Math.floor((totalCents * STRIPE_PCT_PER_MILLE + 500) / 1000) + STRIPE_FIXED_CENTS
}

/**
 * Why this order must be refused at checkout, or null when it may proceed. Checked in this order:
 *   1. no food at all;
 *   2. the food is less than the estimated card fee on the FULL charge (food + service fee +
 *      delivery or curbside fee + service charge + tip). For a multi-vendor order this is the
 *      order's whole food subtotal, not each vendor's share;
 *   3. the charge is under Stripe's $0.50 minimum.
 *
 * Both inputs are integer cents: `subtotalCents` is the food subtotal, `totalCents` is exactly what
 * the PaymentIntent would charge.
 */
export function checkoutRefusal(input: { subtotalCents: number; totalCents: number }): CheckoutRefusal | null {
  const { subtotalCents, totalCents } = input
  if (subtotalCents <= 0) {
    return { code: 'ORDER_SUBTOTAL_ZERO', message: ORDER_SUBTOTAL_ZERO_MESSAGE }
  }
  if (subtotalCents < estimatedStripeFeeCents(totalCents)) {
    return { code: 'ORDER_BELOW_PROCESSING_FEE', message: ORDER_BELOW_PROCESSING_FEE_MESSAGE }
  }
  if (totalCents < MIN_CHARGE_CENTS) {
    return { code: 'ORDER_BELOW_MINIMUM', message: ORDER_BELOW_MINIMUM_MESSAGE }
  }
  return null
}
