import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { getGroupedMenuItemsByVendor } from '@/lib/menu/getGroupedMenuItems'
import { isVendorReadinessEnforced, vendorReady } from '@/lib/vendor-readiness'
import { getOptionalUserId } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { resolveVendorWhere } from '@/lib/resolve-vendor'

// GET /api/vendors/:id/menu
// Returns pre-grouped menu items for a single vendor. Grouping is server-side.
// Serves BOTH the customer per-vendor menu view AND the vendor's own menu manager,
// so the customer readiness/offline gates apply ONLY to non-members — the owner
// always sees their own menu (ready or not; the menu manager is how they add items
// to BECOME ready).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    // Per-fair slug scoping — same as the vendor page (?fair=<fairSlug>). See resolveVendorWhere.
    const fairSlug = new URL(req.url).searchParams.get('fair')
    const vendor = await db.vendor.findFirst({
      where: await resolveVendorWhere(id, fairSlug),
      select: {
        id: true, isOffline: true, status: true, stripeVerified: true,
        _count: { select: { menuItems: { where: { isAvailable: true } } } },
      },
    })

    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')

    // Owner bypass: is the (optional) caller a MEMBER of this vendor?
    let isMember = false
    const clerkId = await getOptionalUserId()
    if (clerkId) {
      const u = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
      if (u) isMember = !!(await getVendorAuth(u.id, vendor.id, req))
    }

    // Customer-facing gates apply to non-members only. A member sees their own menu
    // regardless of offline/readiness — the gate hides vendors from CUSTOMERS, not
    // from themselves.
    if (!isMember) {
      if (vendor.isOffline) return apiError('Vendor is currently offline', 503, 'VENDOR_OFFLINE')
      if (isVendorReadinessEnforced() &&
          !vendorReady({ status: vendor.status, stripeVerified: vendor.stripeVerified, availableMenuCount: vendor._count.menuItems })) {
        return apiError('Vendor not found', 404, 'NOT_FOUND')
      }
    }

    const grouped = await getGroupedMenuItemsByVendor(vendor.id)
    return success(grouped)
  } catch (err) {
    return handleApiError(err)
  }
}
