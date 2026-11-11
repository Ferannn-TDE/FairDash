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
  | 'DIRECT_CREATE'          // POST /api/menu
  | 'DIRECT_EDIT'            // PATCH /api/menu/[id]
  | 'REQUEST_APPROVED_ADD'   // organizer approves an ADD menu request
  | 'REQUEST_APPROVED_EDIT'  // organizer approves an EDIT menu request that carries a price

export interface MenuPriceChange {
  vendorId: string
  /** The User who made the change: the vendor operator, or the approving organizer. */
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
