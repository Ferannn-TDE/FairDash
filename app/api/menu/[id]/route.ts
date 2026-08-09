// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorAuth } from '@/lib/auth'
import { assertSafeImageUrl } from '@/lib/upload-limits'

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
// Update availability (sold-out toggle) or item details. Vendor auth required.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireVendorAuth()
    const body = await req.json()
    const { name, description, price, category, imageUrl, isAvailable, prepTime } = body

    // Same bypass door as POST /api/menu — an update can smuggle a data: URI just as easily.
    assertSafeImageUrl(imageUrl)

    const item = await db.menuItem.update({
      where: { id: (await params).id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(price !== undefined && { price: Number(price) }),
        ...(category !== undefined && { category }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(isAvailable !== undefined && { isAvailable: Boolean(isAvailable) }),
        ...(prepTime !== undefined && { prepTime: Number(prepTime) }),
      },
    })

    revalidateTag(`vendor-menu-${item.vendorId}`, 'default')
    return success(item)
  } catch (err) {
    return handleApiError(err)
  }
}

// DELETE /api/menu/:id
// Vendor auth required.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireVendorAuth()
    const id = (await params).id
    const item = await db.menuItem.findUnique({ where: { id }, select: { vendorId: true } })
    await db.menuItem.delete({ where: { id } })
    if (item) revalidateTag(`vendor-menu-${item.vendorId}`, 'default')
    return success({ deleted: true })
  } catch (err) {
    return handleApiError(err)
  }
}
