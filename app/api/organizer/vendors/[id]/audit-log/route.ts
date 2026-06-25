import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'

// GET /api/organizer/vendors/:id/audit-log?take=50&skip=0&action=ORDER_DECLINED
// Returns the audit trail for a vendor belonging to this organizer's event.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { id: vendorParam } = await params

    // Accept cuid or per-event slug
    const vendor = await db.vendor.findFirst({
      where: { OR: [{ id: vendorParam }, { slug: vendorParam }] },
      select: { id: true, event: { select: { organizerId: true } } },
    })
    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')
    if (vendor.event.organizerId !== organizerId) return apiError('Access denied', 403, 'FORBIDDEN')
    const vendorId = vendor.id

    const take = Math.min(200, parseInt(req.nextUrl.searchParams.get('take') ?? '50', 10))
    const skip = parseInt(req.nextUrl.searchParams.get('skip') ?? '0', 10)
    const action = req.nextUrl.searchParams.get('action') ?? undefined

    const [logs, total] = await Promise.all([
      db.vendorAuditLog.findMany({
        where: { vendorId, ...(action ? { action } : {}) },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      }),
      db.vendorAuditLog.count({
        where: { vendorId, ...(action ? { action } : {}) },
      }),
    ])

    return success({ logs, total, take, skip })
  } catch (err) {
    return handleApiError(err)
  }
}
