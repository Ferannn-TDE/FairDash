import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { getGroupedMenuItemsByVendor } from '@/lib/menu/getGroupedMenuItems'

// GET /api/vendors/:id/menu
// Returns pre-grouped menu items for a single vendor.
// Grouping is done server-side using variantGroup/variantLabel fields.
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const vendor = await db.vendor.findUnique({
      where: { id: params.id },
      select: { id: true, isOffline: true },
    })

    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')
    if (vendor.isOffline) return apiError('Vendor is currently offline', 503, 'VENDOR_OFFLINE')

    const grouped = await getGroupedMenuItemsByVendor(params.id)
    return success(grouped)
  } catch (err) {
    return handleApiError(err)
  }
}
