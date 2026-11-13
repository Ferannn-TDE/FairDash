// MENU-REQUEST ITEM OWNERSHIP — audit H4.
//
// A menu request that names an existing item (EDIT, DELETE, RESTORE) used to store that item id
// without checking whose item it was, and approval then wrote to whatever row it named, including
// another vendor's item at another fair. These checks run when a request is filed and again when
// it is approved.
//
// Kept apart from validate-item.ts on purpose: that module is pure, and these need the database.

import { db } from '../db'
import type { ItemRejection, MenuRequestItemInput } from './validate-item'

export interface IndexedItemRejection extends ItemRejection {
  /** Zero-based position of the failing item in the submission. */
  index: number
}

const notFound = (index: number): IndexedItemRejection =>
  ({ index, message: 'Menu item not found', status: 404, code: 'NOT_FOUND' })

/**
 * Every item a submission names must belong to THIS vendor. One query for the whole batch.
 *
 * A missing id and another vendor's id get the same 404, so item ids cannot be probed. Also
 * refuses DELETE of an item that is already removed, RESTORE of one that isn't, and EDIT of a
 * removed item (409).
 * An ADD that carries a menuItemId is checked too: the id would otherwise be stored on the
 * request even though approving an ADD ignores it.
 *
 * Returns the first failure, or null when every named item is the vendor's own.
 */
export async function checkMenuRequestItemOwnership(
  vendorId: string,
  inputs: MenuRequestItemInput[],
): Promise<IndexedItemRejection | null> {
  const named = inputs
    .map((item, index) => ({ index, type: item.type, id: item.menuItemId }))
    .filter(n => n.id !== undefined && n.id !== null && n.id !== '')
  if (named.length === 0) return null

  for (const n of named) {
    if (typeof n.id !== 'string') return notFound(n.index)
  }

  const ids = [...new Set(named.map(n => n.id as string))]
  const rows = await db.menuItem.findMany({
    where:  { id: { in: ids } },
    select: { id: true, vendorId: true, removedAt: true },
  })
  const byId = new Map(rows.map(r => [r.id, r]))

  for (const n of named) {
    const row = byId.get(n.id as string)
    if (!row || row.vendorId !== vendorId) return notFound(n.index)
    if (n.type === 'DELETE' && row.removedAt !== null) {
      return { index: n.index, message: 'This item is already removed from the menu', status: 409, code: 'CONFLICT' }
    }
    if (n.type === 'RESTORE' && row.removedAt === null) {
      return { index: n.index, message: 'This item is on the menu, so there is nothing to restore', status: 409, code: 'CONFLICT' }
    }
    // An EDIT applies at once (H5 2g), so editing a removed item would let its price be raised and
    // then restored "at the same price", around the restore rule. Restore first, then edit.
    if (n.type === 'EDIT' && row.removedAt !== null) {
      return { index: n.index, message: 'This item is removed from the menu. Restore it first, then edit it.', status: 409, code: 'CONFLICT' }
    }
  }
  return null
}

/**
 * Approval-time re-check: the item a request names must still belong to the request's vendor.
 * Defence in depth for rows written before checkMenuRequestItemOwnership existed.
 */
export async function menuRequestTargetsOwnItem(menuItemId: string, vendorId: string): Promise<boolean> {
  const item = await db.menuItem.findUnique({ where: { id: menuItemId }, select: { vendorId: true } })
  return item !== null && item.vendorId === vendorId
}
