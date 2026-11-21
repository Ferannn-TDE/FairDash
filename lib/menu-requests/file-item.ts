// FILE ONE MENU-REQUEST ITEM — apply it now, or leave it PENDING for the approver (audit H5, 2g).
//
// Called by POST /api/menu-requests once per item, in submission order, inside the submission's
// one transaction (`tx`). Validation and the ownership check (checkMenuRequestItemOwnership) have
// already passed; this re-reads each named item through `tx`, scoped to the vendor, so the state
// it acts on is the state it writes against.
//
// THE RULES (Jordan, Nov 12): vendors set their own prices; only brand-new items, and bringing a
// removed item back at a HIGHER price, wait for the approver.
//   DELETE   Applied now. The item leaves the menu (removedAt); the request is written already
//            APPROVED, reviewed by the vendor, with a MENU_ITEM_REMOVED audit row.
//   EDIT     A LIVE item: applied now, every field sent (price up or down, name, description,
//            photo, category, prep time), request APPROVED, and a MENU_PRICE_CHANGED row if the
//            price moved. Any existing item counts as approved. A REMOVED item: refused (409),
//            because raising a removed item's price and then restoring it "at the same price"
//            would get round the restore rule below. Restore it first.
//   RESTORE  The same or a lower price than the item's last recorded price (or none given):
//            applied now, request APPROVED, audit row if the price moved. A HIGHER price: PENDING,
//            and the item stays removed at its old price until the approver decides.
//   ADD      If the name is one of the vendor's removed items (re-add.ts), it IS that item coming
//            back: a RESTORE of the matched row under the same price rule, carrying the
//            description, category, photo and prep time the vendor typed (the stored name is
//            kept). If its variantGroup matches a LIVE item of the vendor, it is a new size of an
//            approved item: created now (REQUEST_APPLIED_SIZE audit row). Otherwise a brand-new
//            item, with all its sizes: PENDING, approved together (apply-decision.ts).
//
// ONE PENDING PRICE CHANGE PER ITEM: before an EDIT that carries a price, or any RESTORE, older
// PENDING price changes for that item are closed (supersede.ts).
//
// ALERTS (audit H5, step 3): a DELETE and a PENDING higher-priced restore each record a menu
// change for the approvers' notifications (lib/menu-notify/record.ts) in the same transaction.
//
// Every refusal throws ApiError, which rolls the whole submission back.

import type { MenuRequest, Prisma } from '@prisma/client'
import { ApiError } from '../api-error'
import { priceNeedsApproval } from '../menu/price-gate'
import { priceChanged, recordMenuPriceChange, recordMenuItemRemoved } from '../menu/price-audit'
import { recordMenuDeleted, recordPriceChangePending } from '../menu-notify/record'
import { findRemovedNameMatch } from './re-add'
import { supersedePendingPriceChanges } from './supersede'
import {
  assertNeverRequestType,
  buildMenuRequestData,
  type MenuRequestItemInput,
  type MenuRequestRowContext,
} from './validate-item'

export const REMOVED_NOTE = 'Removed immediately by vendor'
export const RESTORED_NOTE = 'Restored immediately by vendor'
export const EDITED_NOTE = 'Applied immediately by vendor'
export const SIZE_ADDED_NOTE = 'New size of a live item, applied immediately'
export const EDIT_REMOVED_MESSAGE = 'This item is removed from the menu. Restore it first, then edit it.'

type RowData = ReturnType<typeof buildMenuRequestData>

const itemNotFound = () => new ApiError('Menu item not found', 404, 'NOT_FOUND')

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
): Promise<MenuRequest> {
  const data = buildMenuRequestData(item, ctx)
  const now = new Date()

  switch (data.type) {
  case 'DELETE':
    return applyDelete(tx, data, now)
  case 'EDIT':
    return applyEdit(tx, data, now)
  case 'RESTORE':
    return fileRestore(tx, data, data.menuItemId as string, now)
  case 'ADD': {
    const match = await findRemovedNameMatch(tx, ctx.vendorId, data.name as string)
    if (match) return fileRestore(tx, data, match.id, now)
    // A new SIZE of an item that is already live is a live edit (Nov 12): created at once.
    if (data.variantGroup !== null) {
      const liveSibling = await tx.menuItem.findFirst({
        where: { vendorId: data.vendorId, variantGroup: data.variantGroup, removedAt: null },
        select: { id: true },
      })
      if (liveSibling) return applyNewSize(tx, data, now)
    }
    // Brand-new item (with or without sizes): waits for the approver.
    return tx.menuRequest.create({ data })
  }
  default:
    return assertNeverRequestType(data.type)
  }
}

async function applyDelete(tx: Prisma.TransactionClient, data: RowData, now: Date): Promise<MenuRequest> {
  const menuItemId = data.menuItemId as string
  const item = await tx.menuItem.findFirst({
    where: { id: menuItemId, vendorId: data.vendorId },
    select: { name: true, price: true },
  })
  if (!item) throw itemNotFound()

  // Only an item still on the menu flips; a concurrent removal finds nothing and refuses.
  const flipped = await tx.menuItem.updateMany({
    where: { id: menuItemId, vendorId: data.vendorId, removedAt: null },
    data: { removedAt: now },
  })
  if (flipped.count === 0) throw new ApiError('This item is already removed from the menu', 409, 'CONFLICT')

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

/** An EDIT of a LIVE item applies now, every field sent; an EDIT of a removed item is refused. */
async function applyEdit(tx: Prisma.TransactionClient, data: RowData, now: Date): Promise<MenuRequest> {
  const menuItemId = data.menuItemId as string
  const before = await tx.menuItem.findFirst({
    where: { id: menuItemId, vendorId: data.vendorId },
    select: { price: true, removedAt: true },
  })
  if (!before) throw itemNotFound()
  if (before.removedAt !== null) throw new ApiError(EDIT_REMOVED_MESSAGE, 409, 'CONFLICT')

  if (data.price !== null) {
    await supersedePendingPriceChanges(tx, { menuItemId, vendorId: data.vendorId, replacedBy: data.requestedBy, now })
  }

  // Only a row still on the menu is written: a concurrent removal finds nothing and refuses.
  const written = await tx.menuItem.updateMany({
    where: { id: menuItemId, vendorId: data.vendorId, removedAt: null },
    data: {
      ...(data.name  !== null && { name: data.name }),
      ...(data.price !== null && { price: data.price }),
      // Renaming a size is a live edit too (Nov 12); moving it to another item is refused upstream.
      ...(data.variantLabel !== null && { variantLabel: data.variantLabel }),
      ...carriedFields(data),
    },
  })
  if (written.count === 0) throw new ApiError(EDIT_REMOVED_MESSAGE, 409, 'CONFLICT')
  const after = await tx.menuItem.findUniqueOrThrow({ where: { id: menuItemId }, select: { name: true, price: true } })

  const row = await tx.menuRequest.create({
    data: { ...data, status: 'APPROVED', reviewedBy: data.requestedBy, reviewedAt: now, reviewNote: EDITED_NOTE },
  })
  if (data.price !== null && priceChanged(before.price, after.price)) {
    await recordMenuPriceChange(tx, {
      vendorId: data.vendorId, userId: data.requestedBy, menuItemId, name: after.name,
      previousPrice: before.price, newPrice: after.price, source: 'REQUEST_APPLIED_EDIT', requestId: row.id,
    })
  }
  return row
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
 * vendor). Sizes are part of the item, and the item is approved, so this is a live edit (Nov 12):
 * the row is created now, the request written APPROVED, and the price recorded as a
 * MENU_PRICE_CHANGED row (source REQUEST_APPLIED_SIZE, previous null) in the same transaction, in
 * VendorAuditLog where the organizer price-change log reads it.
 */
async function applyNewSize(tx: Prisma.TransactionClient, data: RowData, now: Date): Promise<MenuRequest> {
  const created = await tx.menuItem.create({
    data: {
      vendorId: data.vendorId,
      name: data.name as string,
      description: data.description ?? undefined,
      price: data.price as number,
      category: data.category as string,
      prepTime: data.prepTime ?? 15,
      imageUrl: data.imageUrl ?? undefined,
      variantGroup: data.variantGroup,
      variantLabel: data.variantLabel,
      isAvailable: true,
    },
  })
  const row = await tx.menuRequest.create({
    data: { ...data, menuItemId: created.id, status: 'APPROVED', reviewedBy: data.requestedBy, reviewedAt: now, reviewNote: SIZE_ADDED_NOTE },
  })
  await recordMenuPriceChange(tx, {
    vendorId: data.vendorId, userId: data.requestedBy, menuItemId: created.id, name: created.name,
    previousPrice: null, newPrice: created.price, source: 'REQUEST_APPLIED_SIZE', requestId: row.id,
  })
  return row
}
