import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireStrictAdminAuth } from '@/lib/auth'

// GET /api/admin/fairs
// The admin fair picker's backing list. This is the ONE genuinely net-new admin
// screen vs the organizer portal: an admin oversees fairs it does NOT own, so the
// list CANNOT be derived from ownership — it enumerates ALL fairs. Cross-fair data
// → STRICT gate (admin | super_admin), same sensitivity as requireAdminFairContext.
//
// Note: db.event.findMany (a list) is unscoped BY DESIGN here and is not a
// single-resource ownership-bypass resolve — the grep invariant
// (no unscoped event.findFirst/findUnique under app/api/admin) is unaffected.
export async function GET(_req: NextRequest) {
  try {
    await requireStrictAdminAuth()

    const fairs = await db.event.findMany({
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      select: {
        id: true,
        name: true,
        urlSlug: true,
        status: true,
        isPaused: true,
        startDate: true,
        endDate: true,
        organizer: { select: { name: true, suspendedAt: true } },
        _count: { select: { vendors: true } },
      },
    })

    return success({
      fairs: fairs.map(f => ({
        id: f.id,
        name: f.name,
        urlSlug: f.urlSlug,
        status: f.status,
        isPaused: f.isPaused,
        startDate: f.startDate,
        endDate: f.endDate,
        organizerName: f.organizer?.name ?? null,
        organizerSuspended: !!f.organizer?.suspendedAt,
        vendorCount: f._count.vendors,
      })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
