import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorMembershipById } from '@/lib/auth'
import { computeTaxReport, taxReportCsv } from '@/lib/tax-report'

// GET /api/vendors/[id]/tax-report[?from&to&format=csv] — B1.19: this vendor's OWN tax row for its event.
// A vendor booth belongs to one event, so this is one row. Members of the booth only (requireVendorMembershipById).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await requireVendorMembershipById(id, req)
    const vendor = await db.vendor.findUnique({ where: { id }, select: { id: true, eventId: true, event: { select: { urlSlug: true, name: true } } } })
    if (!vendor) return success({ report: null })
    const sp = req.nextUrl.searchParams
    const report = await computeTaxReport(db, { eventId: vendor.eventId, vendorId: vendor.id, from: sp.get('from') || undefined, to: sp.get('to') || undefined })
    if (sp.get('format') === 'csv') {
      return new NextResponse(taxReportCsv(report, false), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="tax-report-${vendor.event.urlSlug}.csv"` },
      })
    }
    return success({ fair: { name: vendor.event.name, slug: vendor.event.urlSlug }, report })
  } catch (err) {
    return handleApiError(err)
  }
}
