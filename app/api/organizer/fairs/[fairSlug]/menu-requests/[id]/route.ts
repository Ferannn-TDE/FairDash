import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { resolveOwnedFair } from '@/lib/organizer-fair-context'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { applyMenuRequestDecision } from '@/lib/menu-requests/apply-decision'

// PLATFORM TIME LIMIT (Step 12 finding 2, 2026-11-22): long enough for the vendor lock's 8 s wait
// plus the 20 s transaction (lib/menu-requests/size-groups.ts lockVendorMenu), so a busy menu ends
// in a named 503, never a platform 504. A plain number: Next reads it at build time.
export const maxDuration = 30

// PATCH /api/organizer/fairs/[fairSlug]/menu-requests/[id]
// { action: 'APPROVE' | 'REJECT', reason?: string }
//
// The organizer's door to the shared decision (lib/menu-requests/apply-decision.ts), which holds
// the approver rule, the checks, the one transaction and the audit rows. This route proves only
// WHO is asking: an approved organizer member (requireOrganizerAuth) who owns this fair
// (resolveOwnedFair, 404 otherwise).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string; id: string }> }
) {
  try {
    const { organizerId, clerkId } = await requireOrganizerAuth()
    const { fairSlug, id: requestId } = await params

    const event = await resolveOwnedFair(fairSlug, organizerId)

    const body = await req.json() as { action?: string; reason?: string }
    const { action, reason } = body
    if (action !== 'APPROVE' && action !== 'REJECT') {
      return apiError('action must be APPROVE or REJECT', 400, 'VALIDATION_ERROR')
    }

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const updated = await applyMenuRequestDecision({
      requestId,
      event: { id: event.id, organizerId },
      approver: { kind: 'organizer', organizerId },
      reviewerUserId: dbUser.id,
      action,
      reason,
    })

    return success({
      id: updated.id,
      status: updated.status,
      reviewNote: updated.reviewNote,
      reviewedAt: updated.reviewedAt,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
