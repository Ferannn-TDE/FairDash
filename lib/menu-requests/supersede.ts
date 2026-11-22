// ONE PENDING PRICE CHANGE PER ITEM (audit H5, Step 2g).
//
// A vendor who asks for $9.50, then changes their mind and asks for $9.00, must not leave the
// approver two live proposals for one item, where approving the stale one later would quietly undo
// the newer one. The newer request REPLACES the older: the older PENDING row is closed as REJECTED
// with the note below, in the same transaction that writes the newer request. No new status and no
// migration: REJECTED plus a fixed note is already how a request that will never apply is recorded.
//
// "A price change" is a request that names an existing item AND carries a price: an EDIT with a
// price, or a RESTORE with a price. A name-only EDIT is not one, and is left alone.

import type { Prisma } from '@prisma/client'
import { liveSizeGroupWhere } from './size-groups'

export const REPLACED_NOTE = 'Replaced by newer request'
export const ITEM_REMOVED_NOTE = 'Closed: the item was removed from the menu'

/**
 * Close every older PENDING price-change request for this item as REJECTED, "Replaced by newer
 * request". Call it, inside the transaction, just before writing the newer request. Returns how
 * many were replaced.
 */
export async function supersedePendingPriceChanges(
  tx: Prisma.TransactionClient,
  args: { menuItemId: string; vendorId: string; replacedBy: string; now: Date },
): Promise<number> {
  const { count } = await tx.menuRequest.updateMany({
    where: {
      menuItemId: args.menuItemId,
      vendorId: args.vendorId,
      status: 'PENDING',
      type: { in: ['EDIT', 'RESTORE'] },
      price: { not: null },
    },
    data: {
      status: 'REJECTED',
      reviewNote: REPLACED_NOTE,
      reviewedBy: args.replacedBy,
      reviewedAt: args.now,
    },
  })
  return count
}

/**
 * NEW SIZES OF A REMOVED ITEM (F4; ultrareview finding 1, 2026-11-21). A new size of a live item
 * waits as a PENDING ADD in that item's size group. Once the LAST live row of the group is
 * removed, those sizes have nothing to be added to, and approving one would otherwise create the
 * sizes as if they were a brand-new item. So every removal path calls this, inside its
 * transaction, right after the item is removed: if no live row of the group is left, every
 * PENDING ADD of the group is closed as REJECTED with the note below. A removal that leaves
 * another size live closes nothing. Re-adding the item later restores it (re-add.ts) and does
 * NOT reopen these; the vendor files the sizes again. Returns how many were closed.
 *
 * The two removal paths: a vendor's DELETE (file-item.ts applyDelete) and an approver's decision
 * on a DELETE filed before 2g (apply-decision.ts).
 */
export async function closeOrphanedNewSizes(
  tx: Prisma.TransactionClient,
  args: { vendorId: string; variantGroup: string | null; closedBy: string; now: Date },
): Promise<number> {
  if (args.variantGroup === null) return 0
  const stillLive = await tx.menuItem.count({ where: liveSizeGroupWhere(args.vendorId, args.variantGroup) })
  if (stillLive > 0) return 0
  const { count } = await tx.menuRequest.updateMany({
    where: { vendorId: args.vendorId, variantGroup: args.variantGroup, type: 'ADD', status: 'PENDING' },
    data: { status: 'REJECTED', reviewNote: ITEM_REMOVED_NOTE, reviewedBy: args.closedBy, reviewedAt: args.now },
  })
  return count
}
