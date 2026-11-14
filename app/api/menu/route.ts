import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorAuth } from '@/lib/auth'
import { getGroupedMenuItemsByEvent } from '@/lib/menu/getGroupedMenuItems'

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

// No POST here. Vendors change their menu through /api/menu-requests (organizer review); the
// direct POST /api/menu and PATCH/DELETE /api/menu/[id] skipped that review and were removed
// (menu-ownership-boundary-proof [1]).
