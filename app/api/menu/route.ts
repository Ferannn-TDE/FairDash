import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth, requireVendorMayEditMenu } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { getGroupedMenuItemsByEvent } from '@/lib/menu/getGroupedMenuItems'
import { assertSafeImageUrl } from '@/lib/upload-limits'
import { parseInPersonPrice } from '@/lib/menu/price'

// GET /api/menu?eventSlug=&vendorId=
// Public. Returns pre-grouped menu items for a fair; vendorId narrows to one booth.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const eventSlug = searchParams.get('eventSlug')
    const vendorId = searchParams.get('vendorId')

    if (!eventSlug) return apiError('eventSlug is required', 400, 'VALIDATION_ERROR')

    const grouped = await getGroupedMenuItemsByEvent(eventSlug)

    const data = vendorId
      ? grouped.filter((g) => g.vendorId === vendorId)
      : grouped

    return success(data)
  } catch (err) {
    return handleApiError(err)
  }
}

// POST /api/menu
// Creates a menu item. The caller must be a member of this vendor (404 otherwise, the same
// answer as a vendor that doesn't exist), and the booth and operator must be allowed to edit.
export async function POST(req: Request) {
  try {
    const clerkId = await requireAuth()
    const body = await req.json()
    const { vendorId, name, description, price, category, imageUrl, prepTime, variantGroup, variantLabel } = body

    if (typeof vendorId !== 'string' || !vendorId || !name || price == null || !category) {
      return apiError('vendorId, name, price, and category are required', 400, 'VALIDATION_ERROR')
    }
    // The one price rule every write path shares (lib/menu/price.ts, audit H5): this route
    // used to store Number(price) with no bounds, so a negative or NaN price went straight live.
    const parsedPrice = parseInPersonPrice(price)
    if (!parsedPrice.ok) return apiError(parsedPrice.message, 400, 'VALIDATION_ERROR')
    // imageUrl is a LINK, not a payload — a data: URI here would be an upload-cap bypass with
    // no file upload involved. See lib/upload-limits.ts.
    assertSafeImageUrl(imageUrl)

    // Authorize against THIS vendor. getVendorAuth returns null both for a vendor the caller
    // doesn't belong to and for one that doesn't exist, so both answer the same 404.
    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('Vendor not found', 404, 'NOT_FOUND')
    const isMember = await getVendorAuth(dbUser.id, vendorId, req)
    if (!isMember) return apiError('Vendor not found', 404, 'NOT_FOUND')
    await requireVendorMayEditMenu(dbUser.id, vendorId)

    const item = await db.menuItem.create({
      data: {
        vendorId,
        name,
        description,
        price: parsedPrice.value,
        category,
        imageUrl,
        ...(prepTime != null && { prepTime: Number(prepTime) }),
        ...(variantGroup && { variantGroup }),
        ...(variantLabel && { variantLabel }),
      },
    })

    return success(item, 201)
  } catch (err) {
    return handleApiError(err)
  }
}
