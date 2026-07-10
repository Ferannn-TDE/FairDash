import { EventStatus, VendorStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { readinessWhereIfEnforced } from '@/lib/vendor-readiness'

// GET /api/fairs
// Public endpoint — returns all non-draft events for the discover / fairs listing pages.
// Does not require auth. Excludes internal fields.
export async function GET() {
  try {
    const events = await db.event.findMany({
      // Public discovery: only truly-live fairs. UPCOMING is NOT public (a fair
      // goes public when deliberately taken ACTIVE), and archived (soft-deleted)
      // fairs vanish even if still ACTIVE.
      where: { status: EventStatus.ACTIVE, archivedAt: null },
      take: 50,
      orderBy: { startDate: 'asc' },
      select: {
        id: true,
        name: true,
        urlSlug: true,
        description: true,
        status: true,
        primaryColor: true,
        startDate: true,
        endDate: true,
        _count: { select: { vendors: { where: { status: VendorStatus.ACTIVE, ...readinessWhereIfEnforced() } } } },
      },
    })

    const fairs = events.map(e => ({
      id: e.id,
      name: e.name,
      slug: e.urlSlug,
      description: e.description ?? null,
      primaryColor: e.primaryColor ?? '#FF0077',
      status: e.status,
      startDate: e.startDate.toISOString(),
      endDate: e.endDate.toISOString(),
      vendorCount: e._count.vendors,
    }))

    return success(fairs)
  } catch (err) {
    return handleApiError(err)
  }
}
