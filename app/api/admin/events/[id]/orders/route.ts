import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { getFairOrders } from '@/lib/fair-orders'

// GET /api/admin/events/[id]/orders
// Admin (cross-fair) order log for a fair. [id] may be the event UUID or urlSlug.
//
// Authorization: requireAdminFairContext — STRICT platform admin (admin |
// super_admin), fair resolved UNSCOPED. The order query is the SAME shared
// getFairOrders core the organizer route uses, so an admin viewing a fair sees
// exactly what its organizer sees. Same output shape → the admin Order Log page
// consumes this identically to the organizer endpoint it replaced.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { event } = await requireAdminFairContext(id)

    const { searchParams } = req.nextUrl
    const data = await getFairOrders(event.id, {
      take:            parseInt(searchParams.get('take') ?? '50', 10),
      cursor:          searchParams.get('cursor')   ?? undefined,
      vendorId:        searchParams.get('vendorId') ?? undefined,
      fulfillmentType: searchParams.get('type')     ?? undefined,
      search:          searchParams.get('q')        ?? undefined,
      dateFrom:        searchParams.get('dateFrom') ?? undefined,
      dateTo:          searchParams.get('dateTo')   ?? undefined,
      tab:             searchParams.get('tab'),
      status:          searchParams.get('status'),
      sort:            searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest',
    })

    return success(data)
  } catch (err) {
    return handleApiError(err)
  }
}
