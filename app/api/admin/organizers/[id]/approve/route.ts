import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireStrictAdminAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'

// POST /api/admin/organizers/[id]/approve
//
// Flips an organizer PENDING (or REJECTED) → APPROVED, unlocking every organizer power the
// gate blocks: fair creation, VENDOR APPROVAL, refunds/disputes/chargebacks, settings.
//
// PLATFORM-LEVEL AUTHORITY. requireStrictAdminAuth — STRICT platform admin (admin |
// super_admin, NOT event_operator), matching the sibling organizer-suspend route. An
// organizer is not scoped to one fair (they own several), so approval means "you may be an
// organizer at all" — this deliberately does NOT ride requireAdminFairContext, which is
// fair-scoped.
//
// NO SELF-APPROVAL — the property that keeps the gate from being decorative. This is the
// same no-self-rescue standard as the A6 kill-switch: an organizer identity is structurally
// rejected by requireStrictAdminAuth (they carry no admin role, and the role is read FRESH
// from Clerk, not from a JWT they could hold stale). So a pending organizer cannot approve
// themselves — they never reach the update. Resolves a FairOrganizer (not an Event), so no
// unscoped Event resolve is introduced and the admin grep invariant is untouched.
//
// AUDIT — the decision is recorded ON THE ROW (approvedBy / approvedAt, and rejectionReason
// cleared), exactly as the runner approve route does. An approval decision gets contested;
// "who approved this organizer, and when" must have a durable answer, not a log line.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const adminClerkId = await requireStrictAdminAuth()
    const { id } = await params

    const organizer = await db.fairOrganizer.findUnique({
      where: { id },
      select: { id: true, approvalStatus: true },
    })
    if (!organizer) throw new ApiError('Organizer not found', 404, 'ORGANIZER_NOT_FOUND')

    const updated = await db.fairOrganizer.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: adminClerkId,
        rejectionReason: null, // clear any prior rejection — this is a fresh decision
      },
      select: {
        id: true, name: true, contactEmail: true,
        approvalStatus: true, approvedAt: true, approvedBy: true,
      },
    })

    logger.info('[OrganizerApproval] APPROVED', {
      adminClerkId, organizerId: updated.id, previousStatus: organizer.approvalStatus,
    })

    return success({ organizer: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
