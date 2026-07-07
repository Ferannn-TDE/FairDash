import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { getGroupedMenuItemsByVendor } from '@/lib/menu/getGroupedMenuItems'
import { isVendorReadinessEnforced, vendorReady } from '@/lib/vendor-readiness'

// GET /api/vendors/:id/menu
// Returns pre-grouped menu items for a single vendor.
// Grouping is done server-side using variantGroup/variantLabel fields.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const vendor = await db.vendor.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      select: {
        id: true, isOffline: true, status: true, stripeVerified: true,
        _count: { select: { menuItems: { where: { isAvailable: true } } } },
      },
    })

    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')
    if (vendor.isOffline) return apiError('Vendor is currently offline', 503, 'VENDOR_OFFLINE')

    // When enforcement is on, a not-ready vendor's menu is not reachable even by
    // direct URL — mirrors the /api/vendors/[id] detail gate.
    if (isVendorReadinessEnforced() &&
        !vendorReady({ status: vendor.status, stripeVerified: vendor.stripeVerified, availableMenuCount: vendor._count.menuItems })) {
      return apiError('Vendor not found', 404, 'NOT_FOUND')
    }

    const grouped = await getGroupedMenuItemsByVendor(vendor.id)
    return success(grouped)
  } catch (err) {
    return handleApiError(err)
  }
}
