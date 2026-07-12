import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireVendorMembershipById } from '@/lib/auth'
import { fetchVendorOrderHistory, UnknownTabError, MAX_TAKE } from '@/lib/vendor-order-history'
import { logger } from '@/lib/logger'

// GET /api/vendors/:id/orders/history
//   ?tab=all|PLACED|PREPARING|READY|COMPLETED|CANCELLED   (preferred — uses TAB_STATUS_MAP)
//   ?status=COMPLETED,DECLINED                            (legacy explicit list; still honoured)
//   ?sort=newest|oldest        default newest
//   ?take=50&cursor=<orderId>  cursor pagination
//   ?range=today
//   ?withCounts=1              also return TRUE per-tab totals (not just this page's)
//
// FILTERING, SORTING AND PAGINATION ARE ALL SERVER-SIDE (lib/vendor-order-history). They
// have to be: the page used to fetch the most recent 50 rows and then filter/count them in
// the browser, so the tab counts LIED ("Cancelled (3)" meant "3 among your last 50 orders",
// not "3 ever") and everything past the 50th order was unreachable. Paginating a
// client-side filter would have produced exactly the "page 2 of the wrong filter" bug.
//
// AUTHORISATION IS THIS ROUTE'S JOB. requireVendorMembershipById proves membership against
// the SESSION, so a tampered vendor id in the path cannot page into another vendor's orders.
// The query lib trusts the vendorId it is handed and does no authorisation of its own.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const start = performance.now()

  try {
    const vendorId = (await params).id
    await requireVendorMembershipById(vendorId, req)

    const sp = req.nextUrl.searchParams
    const statusParam = sp.get('status')

    const data = await fetchVendorOrderHistory({
      vendorId,
      tab:        sp.get('tab'),
      statuses:   statusParam ? statusParam.split(',').map(s => s.trim()).filter(Boolean) : null,
      sort:       sp.get('sort') === 'oldest' ? 'oldest' : 'newest',
      take:       Math.min(Math.max(1, parseInt(sp.get('take') ?? String(MAX_TAKE), 10)), MAX_TAKE),
      cursor:     sp.get('cursor'),
      range:      sp.get('range'),
      withCounts: sp.get('withCounts') === '1',
    })

    logger.debug('[vendor/orders/history] served', {
      durationMs: Math.round(performance.now() - start),
      rowCount: data.orders.length,
      tab: sp.get('tab'),
    })

    return success(data)
  } catch (err) {
    if (err instanceof UnknownTabError) return handleApiError(new ApiError(err.message, 400, 'VALIDATION_ERROR'))
    return handleApiError(err)
  }
}
