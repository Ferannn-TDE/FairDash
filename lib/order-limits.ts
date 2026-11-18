// ORDER QUANTITY LIMITS (Jordan, Nov 17). The ONE place both limits live, so they are easy to
// change later. Import-free: the checkout route (app/api/orders/route.ts) refuses anything over
// them, and the cart and checkout screens use the same numbers and the same sentences.
//
//   • at most MAX_QTY_PER_ITEM of any one menu item per order (whole numbers 1 to 5);
//   • at most MAX_ITEMS_PER_ORDER items in total per order (the whole cart, all booths combined).
//
// The total limit also keeps an order to at most 15 booths, which keeps the PaymentIntent metadata
// under Stripe's 500-character limit per value (scripts/online-markup-test.ts [14] measures it).

/** At most this many of any one menu item in one order. */
export const MAX_QTY_PER_ITEM = 5

/** At most this many items in one order, counting every quantity across every booth. */
export const MAX_ITEMS_PER_ORDER = 15

/** Shown on the cart and checkout screens, and sent with 400 ORDER_ITEM_LIMIT. */
export const ORDER_ITEM_LIMIT_MESSAGE =
  `Orders are limited to ${MAX_ITEMS_PER_ORDER} items. Place a second order for more.`

/** Sent with 400 QUANTITY_LIMIT. */
export const QUANTITY_LIMIT_MESSAGE =
  `You can order at most ${MAX_QTY_PER_ITEM} of each item.`
