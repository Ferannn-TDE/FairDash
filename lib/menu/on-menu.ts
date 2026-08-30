// ON THE MENU — the single definition of "not removed".
//
// WHY ITS OWN MODULE, and not a constant inside getGroupedMenuItems. Three call sites need this
// predicate — the two customer reads, and the vendor-readiness count in POST /api/orders — and
// a fourth consumer needs it too: the guard that proves all of them apply it. But
// getGroupedMenuItems reaches next/cache through `require()`, so importing anything from it
// into a plain ESM script fails outright. A predicate that the guard cannot import is a
// predicate the guard has to re-type, and a re-typed rule is two copies of one derivation —
// the exact shape this codebase keeps finding. So the rule lives here, alone and import-free.
//
// It does NOT filter isAvailable. A sold-out item is still ON the menu and must still render
// (greyed, unorderable); a removed item is gone. Those are different states, which is the whole
// reason MenuItem.removedAt exists — before it, both were `isAvailable: false`.

/** Spread into a MenuItem `where` to exclude removed items: `{ vendorId, ...ON_MENU }`. */
export const ON_MENU = { removedAt: null } as const

/**
 * The COMPLEMENT of ON_MENU — the vendor's "Removed" section, and nothing else.
 *
 * Derived from ON_MENU rather than hand-typed as `{ removedAt: { not: null } }` sitting beside
 * it, because two independently-written clauses are two things that can drift: widen or narrow
 * one and the other silently stops being its opposite, leaving items in both sets or in
 * neither. Written as a negation, the partition is structural — and
 * scripts/menu-item-removal-guard.ts [6] asserts it holds against real rows, so the derivation
 * is proven rather than merely intended.
 */
export const IS_REMOVED = { removedAt: { not: ON_MENU.removedAt } } as const

/**
 * SELLABLE — an item a customer could actually order right now: on the menu AND not sold out.
 *
 * This is the readiness predicate. "Does this vendor have anything to sell" is asked in SIX
 * places (readyVendorWhere and computeVendorReadiness in lib/vendor-readiness.ts,
 * lib/fair-vendors.ts, /api/vendors, /api/vendors/[id], /api/vendors/[id]/menu and
 * POST /api/orders), and every one of them wrote `{ isAvailable: true }` by hand. Adding
 * removal to only one of them is how a vendor who removed their last item stays "ready"
 * everywhere except the order route — visible on the storefront with nothing to sell.
 *
 * Written once here so the six agree by construction, and asserted by
 * scripts/menu-item-removal-guard.ts, which greps for a bare `isAvailable: true` readiness
 * count anywhere in the tree.
 */
export const SELLABLE = { isAvailable: true, ...ON_MENU } as const
