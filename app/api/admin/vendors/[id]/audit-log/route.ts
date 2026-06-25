import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'

// GET /api/admin/vendors/:id/audit-log?take=50&skip=0
// Returns the audit trail for a vendor. Admin-only.
// Organizer access to their own vendors' logs is handled separately
// by GET /api/organizer/vendors/:id/audit-log (if implemented).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminAuth()

    const { id: vendorId } = await params
    const take = Math.min(200, parseInt(req.nextUrl.searchParams.get('take') ?? '50', 10))
    const skip = parseInt(req.nextUrl.searchParams.get('skip') ?? '0', 10)
    const action = req.nextUrl.searchParams.get('action') ?? undefined

    const [logs, total] = await Promise.all([
      db.vendorAuditLog.findMany({
        where: {
          vendorId,
          ...(action ? { action } : {}),
        },
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

    if (!logs.length && skip === 0) {
      // Verify the vendor actually exists before returning empty
      const exists = await db.vendor.findUnique({ where: { id: vendorId }, select: { id: true } })
      if (!exists) return apiError('Vendor not found', 404, 'NOT_FOUND')
    }

    return success({ logs, total, take, skip })
  } catch (err) {
    return handleApiError(err)
  }
}
