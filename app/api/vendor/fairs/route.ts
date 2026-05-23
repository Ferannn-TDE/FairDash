import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/vendor/fairs
// Returns all fairs (events) the authenticated user is a vendor member of,
// along with their vendor record and application status for each.
export async function GET() {
  try {
    const clerkId = await requireAuth()

    const dbUser = await db.user.findUnique({
      where: { clerkId },
      select: { id: true },
    })

    if (!dbUser) return success({ fairs: [], applicationStatus: 'none' })

    const memberships = await db.vendorMember.findMany({
      where: { userId: dbUser.id },
      select: {
        role: true,
        vendor: {
          select: {
            id: true,
            name: true,
            slug: true,
            boothNumber: true,
            status: true,
            event: {
              select: {
                id: true,
                name: true,
                urlSlug: true,
                status: true,
                startDate: true,
                endDate: true,
                primaryColor: true,
                _count: {
                  select: { vendors: { where: { status: 'ACTIVE' } } },
                },
              },
            },
          },
        },
      },
    })

    const fairs = memberships.map(({ role, vendor }) => {
      const event = vendor.event
      return {
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorSlug: vendor.slug,
        vendorStatus: vendor.status,
        boothNumber: vendor.boothNumber ?? null,
        role,
        fairId: event.id,
        fairName: event.name,
        fairSlug: event.urlSlug,
        fairStatus: event.status,
        startDate: event.startDate.toISOString(),
        endDate: event.endDate.toISOString(),
        primaryColor: event.primaryColor,
        vendorCount: event._count.vendors,
      }
    })

    // Derive overall application status from vendor records
    const statuses = memberships.map(m => m.vendor.status)
    const applicationStatus =
      statuses.some(s => s === 'ACTIVE')   ? 'approved' :
      statuses.some(s => s === 'PENDING')  ? 'pending'  :
      statuses.some(s => s === 'INACTIVE') ? 'rejected' :
      'none'

    return success({ fairs, applicationStatus })
  } catch (err) {
    return handleApiError(err)
  }
}
