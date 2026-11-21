// RE-ADD MATCH — an ADD whose name is one of the vendor's removed items (audit H5, Step 2g).
//
// A vendor who removes "Cannoli" and later types "cannoli" into the add form is bringing the same
// item back, not inventing a new one. Treating it as new would let a removed item return at any
// price through an ADD that only checks the price is in range. So the ADD becomes a RESTORE of the
// matched row, and the restore price rule applies: the same or a lower price than the item's last
// recorded price publishes directly, a higher one waits for the approver.
//
// THE MATCH IS THE EXACT FULL NAME, trimmed and compared case-insensitively. Nothing fuzzier:
// variants of one dish ("Bagna Cauda" Small / Medium) share a base name and are told apart by
// variantLabel, so anything looser could bring back the wrong size.
//
// THE COMPARISON PRICE is the removed row's stored price. A removed item's price is never written
// (every price write is on a live item or is the restore itself, and all are audited since 2f), so
// that column IS its last recorded price, however long ago it was removed. No time limit applies.

import type { Prisma } from '@prisma/client'

export const normalizeMenuName = (name: string) => name.trim().toLowerCase()

export interface RemovedMatch {
  id: string
  name: string
  price: number
}

/**
 * The vendor's most recently removed item with this exact name (trimmed, case-insensitive), or
 * null. Also null when a LIVE item already carries the name: restoring would put two identical
 * names on the menu, so that ADD stays an ordinary new item for the approver to judge.
 *
 * Reads through the caller's transaction, so the match and the write that follows see one state.
 */
export async function findRemovedNameMatch(
  tx: Prisma.TransactionClient,
  vendorId: string,
  name: string,
): Promise<RemovedMatch | null> {
  const target = normalizeMenuName(name)
  if (!target) return null
  // A vendor's whole menu is small (largest live menu: 11 items), so the name comparison runs here
  // rather than in SQL, where trimming the stored column would need raw SQL.
  const rows = await tx.menuItem.findMany({
    where: { vendorId },
    select: { id: true, name: true, price: true, removedAt: true },
  })
  const sameName = rows.filter(r => normalizeMenuName(r.name) === target)
  if (sameName.some(r => r.removedAt === null)) return null
  const removed = sameName
    .filter((r): r is typeof r & { removedAt: Date } => r.removedAt !== null)
    .sort((a, b) => b.removedAt.getTime() - a.removedAt.getTime())
  const hit = removed[0]
  return hit ? { id: hit.id, name: hit.name, price: hit.price } : null
}
