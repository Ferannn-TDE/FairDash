import { revalidateTag } from 'next/cache'

// The vendor's own menu cache (lib/menu/getGroupedMenuItems.ts, tag `vendor-menu-{vendorId}`).
//
// EXPIRED, NOT MARKED STALE. In Next 16, revalidateTag(tag, <profile>) only marks the data
// stale: the NEXT request is still served the old copy while it refreshes in the background
// (stale-while-revalidate). The vendor menu page reloads straight after every change it makes,
// so with a profile the vendor saw a deleted item still in their active list until a second
// reload (local dev DB check D.4, 2026-11-16). `{ expire: 0 }` makes that next request wait
// for fresh data. This is Next's documented choice for a Route Handler whose caller needs the
// change visible at once (updateTag exists only in Server Actions).
//
// Display only: checkout never reads this cache. It re-reads items and prices from the
// database and refuses removed or sold-out items (app/api/orders/route.ts).
export function expireVendorMenu(vendorId: string): void {
  revalidateTag(`vendor-menu-${vendorId}`, { expire: 0 })
}
