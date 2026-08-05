import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireStrictAdminAuth } from '@/lib/auth'
import { invalidateVendorAuth } from '@/lib/vendor-auth-cache'
import { logger } from '@/lib/logger'

// PATCH /api/admin/vendor-members/[id]/reject   body: { reason: string }
//
// Refuses a HUMAN permission to operate a booth. The booth axis (Vendor.status) is untouched:
// rejecting the operator does not close the stall, and an ACTIVE booth with a rejected operator
// is precisely the state this axis exists to represent.
//
// A REASON IS REQUIRED **AND PERSISTED**. The sibling BOOTH reject route
// (/api/admin/vendors/[id]/reject) validates a reason and then drops it on the floor — it has no
// column to put it in and a `TODO: send email` where the delivery should be. That bug is not
// reproduced here: rejectionReason exists on VendorMember for this purpose, and the operator-
// facing screen in a later commit reads it. A required reason that nobody can ever read is
// theatre; the whole point is that a refused operator learns why instead of hitting a silent wall.
//
// REVERSIBLE — rejection is not terminal. The approve route accepts a REJECTED row and clears
// this reason, so an appeal or a corrected document has a path back. (The runner routes are
// terminal in both directions; organizer's are not. This follows organizer.)
//
// AUDIT SHAPE ON REJECT, and why it differs from approve:
//   approvedBy  = the acting admin's User.id — WHO DECIDED, recorded either way. A rejection is
//                 a decision that gets contested; it needs an author just as much as an approval.
//   approvedAt  = NULL — this row is not approved, and leaving a stale approval timestamp on a
//                 rejected operator would make "when were they admitted?" answer with a moment
//                 that no longer describes them. Mirrors the organizer reject route exactly.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const adminClerkId = await requireStrictAdminAuth()

    const admin = await db.user.findUnique({ where: { clerkId: adminClerkId }, select: { id: true } })
    if (!admin) throw new ApiError('Admin user not found', 404, 'USER_NOT_FOUND')

    const body = (await req.json().catch(() => ({}))) as { reason?: unknown }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) {
      throw new ApiError('A rejection reason is required', 400, 'VALIDATION_ERROR')
    }

    const { id } = await params
    const member = await db.vendorMember.findUnique({
      where: { id },
      select: { id: true, userId: true, vendorId: true, approvalStatus: true },
    })
    if (!member) throw new ApiError('Vendor operator not found', 404, 'VENDOR_MEMBER_NOT_FOUND')

    const updated = await db.vendorMember.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        rejectionReason: reason.slice(0, 300),
        approvedAt: null,       // not approved — do not leave a stale admission timestamp
        approvedBy: admin.id,   // who decided — recorded either way
      },
      select: {
        id: true, role: true,
        approvalStatus: true, approvedAt: true, approvedBy: true, rejectionReason: true,
        user: { select: { id: true, name: true, email: true } },
        vendor: { select: { id: true, name: true, status: true, event: { select: { name: true, urlSlug: true } } } },
      },
    })

    // See the approve route for why this is wired before anything reads it: the membership cache
    // holds an 'owner' entry for 600s + jitter, so without this a rejected operator would keep
    // working for ~10 minutes once the gate reads through that cache.
    await invalidateVendorAuth(member.userId, member.vendorId)

    logger.warn('[VendorOperatorAdmittance] REJECTED', {
      adminUserId: admin.id, vendorMemberId: updated.id,
      operatorUserId: updated.user.id, vendorId: updated.vendor.id,
      previousStatus: member.approvalStatus, reason,
    })

    return success({ vendorMember: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
