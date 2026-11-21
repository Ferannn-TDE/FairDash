import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { computeTaxReport, taxReportCsv } from '@/lib/tax-report'

// GET /api/admin/events/[id]/reports/tax[?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv] — B1.19 per-vendor tax report.
// Admin only (requireAdminFairContext). All vendors at this event. Logic: lib/tax-report.ts.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { event } = await requireAdminFairContext(id)
    const sp = req.nextUrl.searchParams
    const report = await computeTaxReport(db, { eventId: event.id, from: sp.get('from') || undefined, to: sp.get('to') || undefined })
    if (sp.get('format') === 'csv') {
      return new NextResponse(taxReportCsv(report), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="tax-report-${event.urlSlug}.csv"` },
      })
    }
    return success({ fair: { name: event.name, slug: event.urlSlug }, report })
  } catch (err) {
    return handleApiError(err)
  }
}
