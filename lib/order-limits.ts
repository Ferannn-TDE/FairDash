// ORDER QUANTITY LIMITS (Jordan, Nov 17). The ONE place both limits live, so they are easy to
// change later. Import-free: the checkout route (app/api/orders/route.ts) refuses anything over
// them, and the cart and checkout screens use the same numbers, the same sentences and the pure
// helpers below.
//
//   • at most MAX_QTY_PER_ITEM of any one dish per order, every size of it counted together
//     (whole numbers 1 to 5);
//   • at most MAX_ITEMS_PER_ORDER items in total per order (the whole cart, all booths combined).
//
// The total limit also bounds an order to at most 15 booths. That does NOT keep the PaymentIntent
// metadata under Stripe's 500-character limit per value: `vendorSubtotalCents` reaches 541
// characters at 15 booths of $10,000 each (measured Nov 17, scripts/online-markup-test.ts [14]).
// See "Stripe metadata at 15 booths" in the audit progress note (parked for Feran).

/** At most this many of any one dish (all its sizes together) in one order. */
export const MAX_QTY_PER_ITEM = 5

/** At most this many items in one order, counting every quantity across every booth. */
export const MAX_ITEMS_PER_ORDER = 15

/** Shown on the cart and checkout screens, and sent with 400 ORDER_ITEM_LIMIT. */
export const ORDER_ITEM_LIMIT_MESSAGE =
  `Orders are limited to ${MAX_ITEMS_PER_ORDER} items. Place a second order for more.`

/** Shown on the screens when a dish is trimmed, and sent with 400 QUANTITY_LIMIT. */
export const QUANTITY_LIMIT_MESSAGE =
  `You can order at most ${MAX_QTY_PER_ITEM} of each item.`

// ─── Pure helpers for the screens (batch 1b) ──────────────────────────────────────────────────────
// The cart context, the menu card, the cart page and "order again" call these; the tests call them
// directly. They never decide what is charged: the server re-checks every limit at checkout.

/** Which limit an action would break. The total is named first, as the route checks it first. */
export type OrderLimitCode = 'ORDER_ITEM_LIMIT' | 'QUANTITY_LIMIT'

/** The part of a cart line the limits read. `dishKey` is missing on carts saved before batch 1b. */
export interface LimitLine {
  menuItemId: string
  quantity: number
  dishKey?: string
}

/**
 * One dish, all its sizes: THE SAME RULE AND THE SAME STRINGS AS THE ROUTE
 * (app/api/orders/route.ts, the "ONE DISH, ALL ITS SIZES" block). Sizes are menu items sharing a
 * variantGroup within a vendor; an item without a variantGroup is a dish on its own.
 */
export function dishKeyFor(vendorId: string, variantGroup: string | null | undefined, menuItemId: string): string {
  return variantGroup ? `group|${vendorId}|${variantGroup}` : `item|${menuItemId}`
}

/**
 * The dish key from the menu's group (lib/menu/getGroupedMenuItems.ts): its groupKey is
 * `${vendorId}::${variantGroup}` for a dish with sizes, or the item id for a dish on its own.
 */
export function dishKeyFromGroup(groupKey: string, vendorId: string, menuItemId: string): string {
  const prefix = `${vendorId}::`
  const variantGroup = groupKey.startsWith(prefix) ? groupKey.slice(prefix.length) : null
  return dishKeyFor(vendorId, variantGroup, menuItemId)
}

/** A line's dish. A line without a usable dishKey (saved before batch 1b) counts as its own size. */
export function dishKeyOf(line: LimitLine): string {
  return typeof line.dishKey === 'string' && line.dishKey !== ''
    ? line.dishKey
    : dishKeyFor('', null, line.menuItemId)
}

/** How many of one dish the lines hold, all sizes together. */
export function dishQuantity(lines: readonly LimitLine[], dishKey: string): number {
  return lines.reduce((sum, l) => (dishKeyOf(l) === dishKey ? sum + l.quantity : sum), 0)
}

/** How many items the lines hold in all. */
export function totalQuantity(lines: readonly LimitLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0)
}

/** Which limit these lines break, if any (total first). */
export function limitBreach(lines: readonly LimitLine[]): OrderLimitCode | null {
  if (totalQuantity(lines) > MAX_ITEMS_PER_ORDER) return 'ORDER_ITEM_LIMIT'
  const perDish = new Map<string, number>()
  for (const l of lines) {
    const key = dishKeyOf(l)
    const forDish = (perDish.get(key) ?? 0) + l.quantity
    if (forDish > MAX_QTY_PER_ITEM) return 'QUANTITY_LIMIT'
    perDish.set(key, forDish)
  }
  return null
}

/** Would ONE more of this dish break a limit? Which one (total first), or null if it may be added. */
export function addBlockReason(lines: readonly LimitLine[], dishKey: string): OrderLimitCode | null {
  if (totalQuantity(lines) >= MAX_ITEMS_PER_ORDER) return 'ORDER_ITEM_LIMIT'
  if (dishQuantity(lines, dishKey) >= MAX_QTY_PER_ITEM) return 'QUANTITY_LIMIT'
  return null
}

/**
 * The most this cart line may hold if the customer asks for `wanted`: no more than its dish's
 * other sizes and the rest of the cart leave room for. Never below 0; asking for less is granted.
 */
export function capQuantity(lines: readonly LimitLine[], menuItemId: string, wanted: number): number {
  const line = lines.find(l => l.menuItemId === menuItemId)
  const own = line?.quantity ?? 0
  if (!Number.isFinite(wanted)) return own
  const key = line ? dishKeyOf(line) : dishKeyFor('', null, menuItemId)
  const dishRoom = MAX_QTY_PER_ITEM - (dishQuantity(lines, key) - own)
  const totalRoom = MAX_ITEMS_PER_ORDER - (totalQuantity(lines) - own)
  return Math.max(0, Math.min(Math.trunc(wanted), dishRoom, totalRoom))
}

/**
 * The same menu item on several lines becomes one line, quantities added, in first-seen order
 * (for "order again", whose order can list one item twice). A missing dishKey is filled from a
 * later line of the same item.
 */
export function mergeLines<T extends LimitLine>(lines: readonly T[]): T[] {
  const merged: T[] = []
  const at = new Map<string, number>()
  for (const line of lines) {
    const i = at.get(line.menuItemId)
    if (i === undefined) {
      at.set(line.menuItemId, merged.length)
      merged.push({ ...line })
    } else {
      const first = merged[i]
      merged[i] = { ...first, quantity: first.quantity + line.quantity, dishKey: first.dishKey ?? line.dishKey }
    }
  }
  return merged
}

/** What trimToLimits did, so the screen can say so (each matching sentence once). */
export interface TrimResult<T extends LimitLine> {
  lines: T[]
  /** A dish was cut down to MAX_QTY_PER_ITEM: show QUANTITY_LIMIT_MESSAGE. */
  dishTrimmed: boolean
  /** The cart was cut down to MAX_ITEMS_PER_ORDER: show ORDER_ITEM_LIMIT_MESSAGE. */
  totalTrimmed: boolean
}

/**
 * Brings lines within both limits, for a saved cart or "order again". Walks the lines in order:
 * each keeps as many as its dish has room for, then as many as the cart has room for. A line cut
 * to 0 is dropped. Lines already within the limits come back unchanged, with no flags.
 */
export function trimToLimits<T extends LimitLine>(lines: readonly T[]): TrimResult<T> {
  const perDish = new Map<string, number>()
  let total = 0
  let dishTrimmed = false
  let totalTrimmed = false
  const kept: T[] = []
  for (const line of lines) {
    const key = dishKeyOf(line)
    const usedByDish = perDish.get(key) ?? 0
    const afterDish = Math.min(line.quantity, Math.max(0, MAX_QTY_PER_ITEM - usedByDish))
    if (afterDish < line.quantity) dishTrimmed = true
    const keep = Math.min(afterDish, Math.max(0, MAX_ITEMS_PER_ORDER - total))
    if (keep < afterDish) totalTrimmed = true
    if (keep > 0) {
      kept.push(keep === line.quantity ? line : { ...line, quantity: keep })
      perDish.set(key, usedByDish + keep)
      total += keep
    }
  }
  return { lines: kept, dishTrimmed, totalTrimmed }
}
