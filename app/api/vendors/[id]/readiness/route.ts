import { NextRequest } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { hasRole } from '@/lib/roles'
import { computeVendorReadiness } from '@/lib/vendor-readiness'

// GET /api/vendors/:id/readiness
//
// The single source of truth for "is this vendor ready to sell at this fair"
// (decision-(c) bar: approved + stripeVerified + >=1 available menu item; booth
// optional). The checklist UI and the Phase-5 gates both consume this so they can
// never disagree about what "ready" means.
//
// Access: the vendor's own members, the event's organizer, or an admin.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const clerkId = await requireAuth()
    const vendorId = (await params).id

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    // ── Access: vendor member → organizer-of-this-event → admin ──────────────
    let allowed = Boolean(await getVendorAuth(dbUser.id, vendorId, req))
    if (!allowed) {
      const vendor = await db.vendor.findUnique({
        where: { id: vendorId },
        select: { event: { select: { organizerId: true } } },
      })
      if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')

      const orgMember = await db.orgMember.findFirst({
        where: { userId: dbUser.id },
        select: { organizerId: true },
      })
      if (orgMember && vendor.event.organizerId && orgMember.organizerId === vendor.event.organizerId) {
        allowed = true
      } else {
        const u = await currentUser()
        if (hasRole(u?.publicMetadata, 'admin')) allowed = true
      }
    }
    if (!allowed) return apiError('Access denied', 403, 'FORBIDDEN')

    const readiness = await computeVendorReadiness(vendorId)
    if (!readiness) return apiError('Vendor not found', 404, 'NOT_FOUND')

    return success(readiness)
  } catch (err) {
    return handleApiError(err)
  }
}
