import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { computeFairReport } from '@/lib/admin-fair-reports'

// GET /api/admin/events/[id]/reports — the fair's financial report.
//
// Rides requireAdminFairContext (the proven chokepoint; no auth change). All the money math
// lives in computeFairReport (lib/admin-fair-reports) — computed once, from the ledgers,
// with the SAME voidedAt/CANCELLED filters as the dashboard so the two screens agree. The
// route resolves the Event only through the chokepoint (grep invariant holds) and passes the
// resolved event.id to the aggregation.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { event } = await requireAdminFairContext(id)
    const report = await computeFairReport(event.id)
    return success({ fair: { name: event.name, slug: event.urlSlug }, report })
  } catch (err) {
    return handleApiError(err)
  }
}
