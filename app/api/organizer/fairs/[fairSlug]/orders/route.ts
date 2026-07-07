import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { getFairOrders } from '@/lib/fair-orders'

// GET /api/organizer/fairs/[fairSlug]/orders
// ?tab=pending|issues        — shorthand multi-status groups
// ?status=PLACED|...         — single status filter
// ?vendorId=<id>             — filter to one vendor
// ?dateFrom=ISO&dateTo=ISO   — date range on placedAt
// ?take=50&cursor=<id>       — cursor pagination
//
// Authorization: ownership-scoped (requireOrganizerAuth → event resolved WITH
// organizerId). The order query itself lives in the shared getFairOrders core,
// so this log matches the admin one byte-for-byte. This route's boundary is
// UNCHANGED — same auth, same scope, same output shape.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    const event = await db.event.findFirst({
      where: { urlSlug: fairSlug, organizerId },
      select: { id: true },
    })
    if (!event) return apiError('Fair not found or access denied', 404, 'NOT_FOUND')

    const { searchParams } = req.nextUrl
    const data = await getFairOrders(event.id, {
      take:     parseInt(searchParams.get('take') ?? '50', 10),
      cursor:   searchParams.get('cursor')   ?? undefined,
      vendorId: searchParams.get('vendorId') ?? undefined,
      dateFrom: searchParams.get('dateFrom') ?? undefined,
      dateTo:   searchParams.get('dateTo')   ?? undefined,
      tab:      searchParams.get('tab'),
      status:   searchParams.get('status'),
    })

    return success(data)
  } catch (err) {
    return handleApiError(err)
  }
}
