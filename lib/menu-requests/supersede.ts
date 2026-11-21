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

export const REPLACED_NOTE = 'Replaced by newer request'

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
