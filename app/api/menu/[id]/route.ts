import { expireVendorMenu } from '@/lib/menu/menu-cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireVendorMenuItemAccess, requireVendorMayEditMenu } from '@/lib/auth'
import { assertSafeImageUrl } from '@/lib/upload-limits'
import { parseInPersonPrice, clientPriceKey, CLIENT_PRICE_MESSAGE } from '@/lib/menu/price'
import { onlineUnitPrice } from '@/lib/checkout-total'
import { priceChanged, recordMenuPriceChange, recordMenuItemRemoved } from '@/lib/menu/price-audit'
import { recordMenuDeleted } from '@/lib/menu-notify/record'
import { demoVendorHidden } from '@/lib/demo-vendor'

// GET /api/menu/:id
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const item = await db.menuItem.findUnique({
      where: { id: (await params).id },
      include: { vendor: { select: { id: true, name: true, boothNumber: true } } },
    })
    if (!item) return apiError('Menu item not found', 404, 'NOT_FOUND')
    // ONLINE PRICE (audit H5, 2h): this is a public read, so `price` is the online price customers
    // pay, from lib/checkout-total.ts. `inPersonPrice` is the stored price, for the calculator only.
    const { event, isDemo } = await db.vendor.findUniqueOrThrow({
      where: { id: item.vendorId },
      select: { isDemo: true, event: { select: { onlineMarkupBps: true } } },
    })
    // DEMO BOOTHS (review F10; Jordan, Nov 17; lib/demo-vendor.ts): with live Stripe keys a demo
    // booth's item is hidden like every other customer read, with the same answer as a missing
    // item. isDemo is read here only for the check and is never sent.
    if (demoVendorHidden({ isDemo })) return apiError('Menu item not found', 404, 'NOT_FOUND')
    return success({ ...item, price: onlineUnitPrice(item.price, event.onlineMarkupBps), inPersonPrice: item.price })
  } catch (err) {
    return handleApiError(err)
  }
}

// PATCH /api/menu/:id
// Update availability (sold-out toggle) or item details.
// Only a member of the item's own vendor may do this (audit C1): anyone else gets the same 404
// as a missing item. The booth and the operator must also be allowed to edit the menu.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, item } = await requireVendorMenuItemAccess((await params).id, req)
    await requireVendorMayEditMenu(userId, item.vendorId)

    // A removed item comes back only through a restore, where a HIGHER price waits for the
    // approver (audit H5, 2g). Editing it here first would raise its price and then let it be
    // restored "at the same price", around that rule.
    if (item.removedAt) {
      return apiError('This item is removed from the menu. Restore it first, then edit it.', 409, 'CONFLICT')
    }

    const body = await req.json()
    // The online price is worked out by FairSynq (audit H5, 2h): refuse a body that sends one.
    if (clientPriceKey(body)) return apiError(CLIENT_PRICE_MESSAGE, 400, 'CLIENT_PRICE_NOT_ACCEPTED')
    const { name, description, price, category, imageUrl, isAvailable, prepTime } = body

    // The one price rule every write path shares (lib/menu/price.ts, audit H5). A PATCH that
    // leaves price out keeps the stored price; one that sends it must pass the rule.
    let parsedPrice: number | undefined
    if (price !== undefined) {
      const parsed = parseInPersonPrice(price)
      if (!parsed.ok) return apiError(parsed.message, 400, 'VALIDATION_ERROR')
      parsedPrice = parsed.value
    }

    // Same bypass door as POST /api/menu — an update can smuggle a data: URI just as easily.
    assertSafeImageUrl(imageUrl)

    // The update and its price audit row are one transaction (audit H5, 2f). The previous price
    // is re-read inside it, and a row is written only when the price actually changes.
    const updated = await db.$transaction(async tx => {
      const before = await tx.menuItem.findUniqueOrThrow({ where: { id: item.id }, select: { price: true } })
      const after = await tx.menuItem.update({
        where: { id: item.id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(parsedPrice !== undefined && { price: parsedPrice }),
          ...(category !== undefined && { category }),
          ...(imageUrl !== undefined && { imageUrl }),
          ...(isAvailable !== undefined && { isAvailable: Boolean(isAvailable) }),
          ...(prepTime !== undefined && { prepTime: Number(prepTime) }),
        },
      })
      if (parsedPrice !== undefined && priceChanged(before.price, parsedPrice)) {
        await recordMenuPriceChange(tx, {
          vendorId: item.vendorId, userId, menuItemId: item.id, name: after.name,
          previousPrice: before.price, newPrice: after.price, source: 'DIRECT_EDIT',
        })
      }
      return after
    })

    expireVendorMenu(item.vendorId)
    return success(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

// DELETE /api/menu/:id
// Takes the item off the menu immediately. Same ownership and edit rules as PATCH.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, item } = await requireVendorMenuItemAccess((await params).id, req)
    await requireVendorMayEditMenu(userId, item.vendorId)

    if (item.removedAt) {
      return apiError('This item is already removed from the menu', 409, 'CONFLICT')
    }

    // REMOVED, not deleted. OrderItem's FK to MenuItem is RESTRICT, so an ordered item cannot be
    // hard-deleted at all, and a hard delete would SET NULL the MenuRequest rows that reference
    // it, cutting the request trail. This is the same write the organizer-approved DELETE makes.
    //
    // One transaction (audit H5, step 3): the removal, its MENU_ITEM_REMOVED audit row (same shape
    // as the other delete paths; requestId null, since this route files no request) and the
    // approvers' alert record. If either record fails, the item stays on the menu.
    await db.$transaction(async tx => {
      // Only an item still on the menu flips; a concurrent removal finds nothing and refuses.
      const flipped = await tx.menuItem.updateMany({
        where: { id: item.id, removedAt: null },
        data: { removedAt: new Date() },
      })
      if (flipped.count === 0) throw new ApiError('This item is already removed from the menu', 409, 'CONFLICT')
      await recordMenuItemRemoved(tx, {
        vendorId: item.vendorId, userId, menuItemId: item.id, name: item.name, price: item.price, requestId: null,
      })
      await recordMenuDeleted(tx, {
        vendorId: item.vendorId, menuItemId: item.id, name: item.name, price: item.price, menuRequestId: null,
      })
    })

    expireVendorMenu(item.vendorId)
    return success({ deleted: true })
  } catch (err) {
    return handleApiError(err)
  }
}
