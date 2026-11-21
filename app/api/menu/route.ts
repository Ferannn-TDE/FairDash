import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { getGroupedMenuItemsByEvent } from '@/lib/menu/getGroupedMenuItems'

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

// No POST here. Vendors change their menu through /api/menu-requests (organizer review); the
// direct POST /api/menu and PATCH/DELETE /api/menu/[id] skipped that review and were removed
// (menu-ownership-boundary-proof [1]).
