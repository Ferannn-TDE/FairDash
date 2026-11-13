import { NextRequest } from 'next/server'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminMenuApprover } from '@/lib/menu-requests/admin-approver'
import { applyMenuRequestDecision } from '@/lib/menu-requests/apply-decision'

// PATCH /api/admin/events/[id]/menu-requests/[requestId]
// { action: 'APPROVE' | 'REJECT', reason?: string }
//
// The admin's door to the shared decision (lib/menu-requests/apply-decision.ts). Open only to a
// strict platform admin, and only for a fair with NO organizer (audit H5, 2g); every other caller
// gets 404. Same checks, transaction and audit rows as the organizer route.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> }
) {
  try {
    const { id, requestId } = await params
    const { event, reviewerUserId } = await requireAdminMenuApprover(id)

    const body = await req.json() as { action?: string; reason?: string }
    const { action, reason } = body
    if (action !== 'APPROVE' && action !== 'REJECT') {
      return apiError('action must be APPROVE or REJECT', 400, 'VALIDATION_ERROR')
    }

    const updated = await applyMenuRequestDecision({
      requestId,
      event: { id: event.id, organizerId: event.organizerId },
      approver: { kind: 'admin' },
      reviewerUserId,
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
