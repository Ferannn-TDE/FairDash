import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { getGroupedMenuItemsByEvent } from '@/lib/menu/getGroupedMenuItems'
import { assertSafeImageUrl } from '@/lib/upload-limits'

// GET /api/menu?eventSlug=&vendorId=
// Returns pre-grouped menu items for a fair.
// vendorId filter is supported for vendor-scoped views.
// showAll=true (vendor auth required) includes unavailable items.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const eventSlug = searchParams.get('eventSlug')
    const vendorId = searchParams.get('vendorId')
    const showAll = searchParams.get('showAll') === 'true'

    if (showAll) await requireVendorAuth()

    if (!eventSlug) return apiError('eventSlug is required', 400, 'VALIDATION_ERROR')

    const grouped = await getGroupedMenuItemsByEvent(eventSlug, { showUnavailable: showAll })

    const data = vendorId
      ? grouped.filter((g) => g.vendorId === vendorId)
      : grouped

    return success(data)
  } catch (err) {
    return handleApiError(err)
  }
}

// POST /api/menu
// Creates a menu item. Vendor auth required.
export async function POST(req: Request) {
  try {
    const clerkId = await requireVendorAuth()
    const body = await req.json()
    const { vendorId, name, description, price, category, imageUrl, prepTime, variantGroup, variantLabel } = body

    if (!vendorId || !name || price == null || !category) {
      return apiError('vendorId, name, price, and category are required', 400, 'VALIDATION_ERROR')
    }
    // imageUrl is a LINK, not a payload — a data: URI here would be an upload-cap bypass with
    // no file upload involved. See lib/upload-limits.ts.
    assertSafeImageUrl(imageUrl)

    const vendor = await db.vendor.findUnique({ where: { id: vendorId } })
    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')

    // Authorize against THIS vendor: requireVendorAuth() only proves membership of
    // SOME vendor, so without this a vendor member could create items on any other
    // vendor (IDOR). Mirrors the per-vendor check in menu-items/[id]/availability.
    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')
    const isMember = await getVendorAuth(dbUser.id, vendorId, req)
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

    const item = await db.menuItem.create({
      data: {
        vendorId,
        name,
        description,
        price: Number(price),
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
