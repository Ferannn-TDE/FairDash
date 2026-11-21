// MENU PRICE AUDIT — every menu-item price write leaves a record, or does not happen (audit H5, 2f).
//
// The general audit helper, logVendorAction (lib/vendor-audit.ts), is fire-and-forget: it runs
// after the business write and swallows its own failure, so "every price change is recorded"
// could not be promised. This writes the audit row through the SAME transaction client as the
// price write. If the audit insert fails, it throws, the transaction aborts, and the price change
// rolls back with it. Callers must pass the `tx` of the transaction that writes the price, never
// the global `db`.

import type { Prisma } from '@prisma/client'
import { AUDIT_ACTIONS } from '../vendor-audit'

/** Where a price write came from. One value per write path. */
export type MenuPriceChangeSource =
  | 'DIRECT_CREATE'            // historical: the removed POST /api/menu (2026-11-21). Old rows may hold it
  | 'DIRECT_EDIT'              // historical: the removed PATCH /api/menu/[id] (2026-11-21). Old rows may hold it
  | 'REQUEST_APPROVED_ADD'     // the approver approves an ADD menu request
  | 'REQUEST_APPROVED_EDIT'    // the approver approves an EDIT menu request that carries a price
  | 'REQUEST_APPLIED_EDIT'     // a vendor EDIT of a live item, applied at once (2g)
  | 'REQUEST_APPLIED_SIZE'     // a new size added to a live item, applied at once (Fix B)
  | 'REQUEST_APPLIED_RESTORE'  // a vendor restore at the same or a lower price, applied at once (2g)
  | 'REQUEST_APPROVED_RESTORE' // the approver approves a restore at a higher price (2g)

export interface MenuPriceChange {
  vendorId: string
  /** The User who made the change: the vendor operator, or the approving organizer or admin. */
  userId: string
  menuItemId: string
  name: string
  /** Null when the item is new. */
  previousPrice: number | null
  newPrice: number
  source: MenuPriceChangeSource
  /** The MenuRequest that carried the change, for the approval paths. */
  requestId?: string
}

const toCents = (dollars: number) => Math.round(dollars * 100)

/** True when two prices differ by at least one cent. Float-safe: compared in integer cents. */
export function priceChanged(previous: number | null, next: number): boolean {
  return previous === null || toCents(previous) !== toCents(next)
}

/**
 * Write the MENU_PRICE_CHANGED audit row inside the caller's transaction. Throws on failure,
 * which is what rolls the price write back. Does not check whether the price changed; callers
 * decide that with priceChanged() so an unchanged price writes nothing.
 */
export async function recordMenuPriceChange(tx: Prisma.TransactionClient, change: MenuPriceChange): Promise<void> {
  await tx.vendorAuditLog.create({
    data: {
      vendorId: change.vendorId,
      userId: change.userId,
      action: AUDIT_ACTIONS.MENU_PRICE_CHANGED,
      metadata: {
        menuItemId: change.menuItemId,
        name: change.name,
        previousPrice: change.previousPrice,
        newPrice: change.newPrice,
        previousCents: change.previousPrice === null ? null : toCents(change.previousPrice),
        newCents: toCents(change.newPrice),
        source: change.source,
        requestId: change.requestId ?? null,
      },
    },
  })
}

export interface MenuItemRemoval {
  vendorId: string
  /** The vendor operator who removed it, or the approver of an older pending DELETE. */
  userId: string
  menuItemId: string
  name: string
  /** The price the item had when it left the menu: what a later restore is compared against. */
  price: number
  /** The DELETE request that removed it. Null only on rows written by the removed DELETE
   *  /api/menu/[id] (2026-11-21), which filed no request. */
  requestId: string | null
}

/**
 * Write the MENU_ITEM_REMOVED audit row inside the caller's transaction (audit H5, 2g). Same
 * contract as recordMenuPriceChange: it throws on failure, so a removal that cannot be recorded
 * rolls back.
 */
export async function recordMenuItemRemoved(tx: Prisma.TransactionClient, removal: MenuItemRemoval): Promise<void> {
  await tx.vendorAuditLog.create({
    data: {
      vendorId: removal.vendorId,
      userId: removal.userId,
      action: AUDIT_ACTIONS.MENU_ITEM_REMOVED,
      metadata: {
        menuItemId: removal.menuItemId,
        name: removal.name,
        price: removal.price,
        priceCents: toCents(removal.price),
        requestId: removal.requestId,
      },
    },
  })
}
