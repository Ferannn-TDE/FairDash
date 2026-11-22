// FILE ONE MENU-REQUEST ITEM — apply it now, or leave it PENDING for the approver (audit H5, 2g).
//
// Called by POST /api/menu-requests once per item, in submission order, inside the submission's
// one transaction (`tx`). Validation and the ownership check (checkMenuRequestItemOwnership) have
// already passed; this re-reads each named item through `tx`, scoped to the vendor, so the state
// it acts on is the state it writes against.
//
// THE RULES (Jordan, Nov 13, F2 + F4; they replace the Nov 12 "vendors set their own prices" rule
// for increases): a price that goes UP waits for the approver (the event's organizer, or a strict
// admin when it has none) and the old price keeps selling until then. Decreases, deletes and
// non-price edits go live at once. Brand-new items and every new size of a live item wait.
//   DELETE   Applied now. The item leaves the menu (removedAt); the request is written already
//            APPROVED, reviewed by the vendor, with a MENU_ITEM_REMOVED audit row.
//   EDIT     A LIVE item. The same, a lower, or no price: applied now, every field sent (name,
//            description, photo, category, prep time, size name), request APPROVED, and a
//            MENU_PRICE_CHANGED row if the price moved. A HIGHER price (F2, items and sizes
//            alike): the price is written PENDING and the item keeps selling at its old price;
//            any other fields in the same EDIT still go live now, recorded as their own APPROVED
//            EDIT row without a price. A REMOVED item: refused (409), because raising a removed
//            item's price and then restoring it "at the same price" would get round the restore
//            rule below. Restore it first.
//   RESTORE  The same or a lower price than the item's last recorded price (or none given):
//            applied now, request APPROVED, audit row if the price moved. A HIGHER price: PENDING,
//            and the item stays removed at its old price until the approver decides.
//   ADD      If the name is one of the vendor's removed items (re-add.ts), it IS that item coming
//            back: a RESTORE of the matched row under the same price rule, carrying the
//            description, category, photo and prep time the vendor typed (the stored name is
//            kept). If its variantGroup matches a LIVE item of the vendor, it is a new size of a
//            live item (F4): PENDING at any price, created only when the approver approves it,
//            on its own (apply-decision.ts). Otherwise a brand-new item, with all its sizes:
//            PENDING, approved together.
//
// ONE PENDING PRICE CHANGE PER ITEM: before an EDIT that carries a price, or any RESTORE, older
// PENDING price changes for that item are closed (supersede.ts). A second increase therefore
// replaces the first; a decrease replaces a waiting increase and applies now.
//
// ALERTS (audit H5, step 3): a DELETE and every PENDING price (a higher-priced restore or re-add,
// a live increase, a new size) record a menu change for the approvers' notifications
// (lib/menu-notify/record.ts) in the same transaction.
//
// Every refusal throws ApiError, which rolls the whole submission back.

import type { MenuRequest, Prisma } from '@prisma/client'
import { ApiError } from '../api-error'
import { priceNeedsApproval } from '../menu/price-gate'
import { priceChanged, recordMenuPriceChange, recordMenuItemRemoved } from '../menu/price-audit'
import { recordMenuDeleted, recordPriceChangePending } from '../menu-notify/record'
import { findRemovedNameMatch } from './re-add'
import { supersedePendingPriceChanges, closeOrphanedNewSizes } from './supersede'
import { liveSizeGroupWhere } from './size-groups'
import {
  assertNeverRequestType,
  buildMenuRequestData,
  type MenuRequestItemInput,
  type MenuRequestRowContext,
} from './validate-item'

export const REMOVED_NOTE = 'Removed immediately by vendor'
export const RESTORED_NOTE = 'Restored immediately by vendor'
export const EDITED_NOTE = 'Applied immediately by vendor'
export const EDIT_REMOVED_MESSAGE = 'This item is removed from the menu. Restore it first, then edit it.'

type RowData = ReturnType<typeof buildMenuRequestData>

/** What filing one item did. */
export interface FiledItem {
  /** The row the vendor's screen follows: APPROVED when applied now, PENDING when it waits. */
  row: MenuRequest
  /**
   * True when this item changed the live menu now, so the caller expires the menu cache after the
   * commit. Not the same as `row.status === 'APPROVED'`: an EDIT that raises the price AND renames
   * the item answers with its PENDING price row, while the rename went live.
   */
  menuChanged: boolean
  /**
   * Any OTHER request rows this item wrote, besides `row`: the APPROVED companion row of an EDIT
   * that raises the price and changes other fields at once. The caller writes one activity-log
   * entry per row, so these must not be dropped. Empty for every other item.
   */
  alsoWritten: MenuRequest[]
}

const itemNotFound = () => new ApiError('Menu item not found', 404, 'NOT_FOUND')

/** A row is "applied now" exactly when it was written APPROVED. */
const filed = (row: MenuRequest): FiledItem => ({ row, menuChanged: row.status === 'APPROVED', alsoWritten: [] })

/** The non-name fields a request may set on an existing item; null means "leave as is". */
function carriedFields(data: RowData) {
  return {
    ...(data.description !== null && { description: data.description }),
    ...(data.category    !== null && { category: data.category }),
    ...(data.prepTime    !== null && { prepTime: data.prepTime }),
    ...(data.imageUrl    !== null && { imageUrl: data.imageUrl }),
  }
}

export async function fileMenuRequestItem(
  tx: Prisma.TransactionClient,
  item: MenuRequestItemInput,
  ctx: MenuRequestRowContext,
): Promise<FiledItem> {
  const data = buildMenuRequestData(item, ctx)
  const now = new Date()

  switch (data.type) {
  case 'DELETE':
    return filed(await applyDelete(tx, data, now))
  case 'EDIT':
    return applyEdit(tx, data, now)
  case 'RESTORE':
    return filed(await fileRestore(tx, data, data.menuItemId as string, now))
  case 'ADD': {
    const match = await findRemovedNameMatch(tx, ctx.vendorId, data.name as string)
    if (match) return filed(await fileRestore(tx, data, match.id, now))
    // A new SIZE of an item that is already live waits for the approver at any price (F4).
    if (data.variantGroup !== null) {
      const liveSibling = await tx.menuItem.findFirst({
        where: liveSizeGroupWhere(data.vendorId, data.variantGroup),
        select: { id: true },
      })
      if (liveSibling) return filed(await fileNewSize(tx, data))
    }
    // Brand-new item (with or without sizes): waits for the approver.
    return filed(await tx.menuRequest.create({ data }))
  }
  default:
    return assertNeverRequestType(data.type)
  }
}

async function applyDelete(tx: Prisma.TransactionClient, data: RowData, now: Date): Promise<MenuRequest> {
  const menuItemId = data.menuItemId as string
  const item = await tx.menuItem.findFirst({
    where: { id: menuItemId, vendorId: data.vendorId },
    select: { name: true, price: true, variantGroup: true },
  })
  if (!item) throw itemNotFound()

  // Only an item still on the menu flips; a concurrent removal finds nothing and refuses.
  const flipped = await tx.menuItem.updateMany({
    where: { id: menuItemId, vendorId: data.vendorId, removedAt: null },
    data: { removedAt: now },
  })
  if (flipped.count === 0) throw new ApiError('This item is already removed from the menu', 409, 'CONFLICT')
  // A price increase still waiting for this item (F2) can never apply now: close it, so the
  // approver isn't left a request for an item that is gone.
  await supersedePendingPriceChanges(tx, { menuItemId, vendorId: data.vendorId, replacedBy: data.requestedBy, now })
  // And if this was the last live row of its size group, the group's waiting new sizes (F4) have
  // nothing left to be added to: close them too (supersede.ts).
  await closeOrphanedNewSizes(tx, { vendorId: data.vendorId, variantGroup: item.variantGroup, closedBy: data.requestedBy, now })

  const row = await tx.menuRequest.create({
    data: { ...data, status: 'APPROVED', reviewedBy: data.requestedBy, reviewedAt: now, reviewNote: REMOVED_NOTE },
  })
  await recordMenuItemRemoved(tx, {
    vendorId: data.vendorId, userId: data.requestedBy, menuItemId,
    name: item.name, price: item.price, requestId: row.id,
  })
  // The approvers are told (grouped per vendor for 10 minutes), in this same transaction.
  await recordMenuDeleted(tx, {
    vendorId: data.vendorId, menuItemId, name: item.name, price: item.price, menuRequestId: row.id,
  })
  return row
}

/**
 * An EDIT of a LIVE item. A higher price waits (F2); everything else in it applies now. An EDIT of
 * a removed item is refused.
 */
async function applyEdit(tx: Prisma.TransactionClient, data: RowData, now: Date): Promise<FiledItem> {
  const menuItemId = data.menuItemId as string
  const before = await tx.menuItem.findFirst({
    where: { id: menuItemId, vendorId: data.vendorId },
    select: { name: true, price: true, removedAt: true },
  })
  if (!before) throw itemNotFound()
  if (before.removedAt !== null) throw new ApiError(EDIT_REMOVED_MESSAGE, 409, 'CONFLICT')

  if (data.price !== null) {
    await supersedePendingPriceChanges(tx, { menuItemId, vendorId: data.vendorId, replacedBy: data.requestedBy, now })
  }

  // F2: A HIGHER PRICE WAITS. The item keeps selling at its old price; the price alone is written
  // PENDING for the approver, and the approvers are told in this same transaction.
  if (data.price !== null && priceNeedsApproval(before.price, data.price)) {
    const requestedPrice = data.price
    const otherFields = { ...data, price: null }
    const hasOtherFields = otherFields.name !== null || otherFields.variantLabel !== null
      || Object.keys(carriedFields(otherFields)).length > 0
    const liveRow = hasOtherFields ? await applyLiveFields(tx, otherFields, now) : null
    const pending = await tx.menuRequest.create({
      data: {
        vendorId: data.vendorId, requestedBy: data.requestedBy, batchId: data.batchId,
        type: 'EDIT', menuItemId, price: requestedPrice,
        name: null, description: null, category: null, prepTime: null, imageUrl: null,
        variantGroup: null, variantLabel: null,
      },
    })
    await recordPriceChangePending(tx, {
      vendorId: data.vendorId, menuItemId, menuRequestId: pending.id, batchId: data.batchId,
      // The item's name as it now is: renamed by this same EDIT, or as it was.
      name: data.name ?? before.name, previousPrice: before.price, requestedPrice, reason: 'LIVE_INCREASE',
    })
    return { row: pending, menuChanged: hasOtherFields, alsoWritten: liveRow ? [liveRow] : [] }
  }

  // The same, a lower, or no price: every field sent goes live now.
  const row = await applyLiveFields(tx, data, now)
  const after = await tx.menuItem.findUniqueOrThrow({ where: { id: menuItemId }, select: { name: true, price: true } })
  if (data.price !== null && priceChanged(before.price, after.price)) {
    await recordMenuPriceChange(tx, {
      vendorId: data.vendorId, userId: data.requestedBy, menuItemId, name: after.name,
      previousPrice: before.price, newPrice: after.price, source: 'REQUEST_APPLIED_EDIT', requestId: row.id,
    })
  }
  return { row, menuChanged: true, alsoWritten: [] }
}

/**
 * Write an EDIT's fields to the live item and record the EDIT as APPROVED by the vendor. The
 * caller has already decided that every field in `data` may go live (a higher price never does).
 */
async function applyLiveFields(tx: Prisma.TransactionClient, data: RowData, now: Date): Promise<MenuRequest> {
  const menuItemId = data.menuItemId as string
  // Only a row still on the menu is written: a concurrent removal finds nothing and refuses.
  const written = await tx.menuItem.updateMany({
    where: { id: menuItemId, vendorId: data.vendorId, removedAt: null },
    data: {
      ...(data.name  !== null && { name: data.name }),
      ...(data.price !== null && { price: data.price }),
      // Renaming a size is a live edit too; moving it to another item is refused upstream.
      ...(data.variantLabel !== null && { variantLabel: data.variantLabel }),
      ...carriedFields(data),
    },
  })
  if (written.count === 0) throw new ApiError(EDIT_REMOVED_MESSAGE, 409, 'CONFLICT')
  return tx.menuRequest.create({
    data: { ...data, status: 'APPROVED', reviewedBy: data.requestedBy, reviewedAt: now, reviewNote: EDITED_NOTE },
  })
}

/**
 * Restore `menuItemId` (named by a RESTORE, or matched by an ADD's name) at `data.price`, or at
 * its last recorded price when none is given, with any description, category, photo and prep time
 * the request carries. The stored name is kept. The row is written as a RESTORE of that item and
 * keeps the carried fields, so a PENDING one applies them on approval.
 */
async function fileRestore(tx: Prisma.TransactionClient, data: RowData, menuItemId: string, now: Date): Promise<MenuRequest> {
  const item = await tx.menuItem.findFirst({
    where: { id: menuItemId, vendorId: data.vendorId },
    select: { name: true, price: true, removedAt: true },
  })
  if (!item) throw itemNotFound()
  if (item.removedAt === null) {
    throw new ApiError('This item is on the menu, so there is nothing to restore', 409, 'CONFLICT')
  }

  await supersedePendingPriceChanges(tx, { menuItemId, vendorId: data.vendorId, replacedBy: data.requestedBy, now })

  const requested = data.price
  const rowData = {
    vendorId: data.vendorId,
    requestedBy: data.requestedBy,
    batchId: data.batchId,
    type: 'RESTORE' as const,
    menuItemId,
    name: data.name,
    description: data.description,
    price: requested,
    category: data.category,
    prepTime: data.prepTime,
    imageUrl: data.imageUrl,
    // A restore brings back the row as it was; its size group and label are not changed.
    variantGroup: null,
    variantLabel: null,
  }

  // A HIGHER price waits for the approver; the item stays removed at its old price meanwhile. The
  // approvers are told on the worker's next tick, recorded in this same transaction.
  if (requested !== null && priceNeedsApproval(item.price, requested)) {
    const pending = await tx.menuRequest.create({ data: rowData })
    await recordPriceChangePending(tx, {
      vendorId: data.vendorId, menuItemId, menuRequestId: pending.id, batchId: data.batchId,
      name: item.name, previousPrice: item.price, requestedPrice: requested,
      reason: data.type === 'ADD' ? 'READD' : 'RESTORE',
    })
    return pending
  }

  const flipped = await tx.menuItem.updateMany({
    where: { id: menuItemId, vendorId: data.vendorId, removedAt: { not: null } },
    data: { removedAt: null, ...(requested !== null && { price: requested }), ...carriedFields(data) },
  })
  if (flipped.count === 0) {
    throw new ApiError('This item is on the menu, so there is nothing to restore', 409, 'CONFLICT')
  }

  const row = await tx.menuRequest.create({
    data: { ...rowData, status: 'APPROVED', reviewedBy: data.requestedBy, reviewedAt: now, reviewNote: RESTORED_NOTE },
  })
  if (requested !== null && priceChanged(item.price, requested)) {
    await recordMenuPriceChange(tx, {
      vendorId: data.vendorId, userId: data.requestedBy, menuItemId, name: item.name,
      previousPrice: item.price, newPrice: requested, source: 'REQUEST_APPLIED_RESTORE', requestId: row.id,
    })
  }
  return row
}

/**
 * A new size of an item that is already live (an ADD whose variantGroup matches a live row of this
 * vendor). F4 (Jordan, Nov 13): it waits for the approver at any price, so a new size can't be used
 * to slip a higher price onto a live item. Nothing is created now; the approver's decision creates
 * it, on its own, with its MENU_PRICE_CHANGED row (apply-decision.ts). The approvers are told in
 * this same transaction.
 */
async function fileNewSize(tx: Prisma.TransactionClient, data: RowData): Promise<MenuRequest> {
  const pending = await tx.menuRequest.create({ data })
  await recordPriceChangePending(tx, {
    vendorId: data.vendorId, menuItemId: null, menuRequestId: pending.id, batchId: data.batchId,
    name: data.name as string,
    previousPrice: null, requestedPrice: data.price as number, reason: 'NEW_SIZE',
  })
  return pending
}
