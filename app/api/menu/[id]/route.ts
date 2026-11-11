import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorMenuItemAccess, requireVendorMayEditMenu } from '@/lib/auth'
import { assertSafeImageUrl } from '@/lib/upload-limits'
import { parseInPersonPrice } from '@/lib/menu/price'

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
    return success(item)
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

    const body = await req.json()
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

    const updated = await db.menuItem.update({
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

    revalidateTag(`vendor-menu-${item.vendorId}`, 'default')
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
    await db.menuItem.update({
      where: { id: item.id },
      data: { removedAt: new Date() },
    })

    revalidateTag(`vendor-menu-${item.vendorId}`, 'default')
    return success({ deleted: true })
  } catch (err) {
    return handleApiError(err)
  }
}
