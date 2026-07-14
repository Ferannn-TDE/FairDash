import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireStrictAdminAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'

// POST /api/admin/organizers/[id]/reject   body: { reason: string }
//
// Flips an organizer → REJECTED. They stay blocked by the gate (403 ORGANIZER_REJECTED, with
// the reason surfaced), and every organizer power remains refused.
//
// NOTHING TO CLEAN UP — Option A's payoff. Because fair CREATION is itself gated by
// requireOrganizerAuth, a pending organizer can never have accumulated a fair, vendors, or
// setup work. So rejection is terminal and clean: there is no orphaned fair to archive, no
// vendor relationship to unwind, no half-built structure to reconcile.
//
// PLATFORM-LEVEL + NO SELF-REJECTION/APPROVAL: requireStrictAdminAuth (admin | super_admin,
// NOT event_operator), same gate as approve and the sibling suspend route — an organizer
// identity is structurally rejected, so the gate cannot be self-served.
//
// A REASON IS REQUIRED. Like every admin money action, a decision without a stated reason is
// unauditable — and the reason is surfaced to the organizer by the gate, so they know why.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const adminClerkId = await requireStrictAdminAuth()
    const { id } = await params

    const body = (await req.json().catch(() => ({}))) as { reason?: unknown }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) {
      throw new ApiError('A rejection reason is required', 400, 'VALIDATION_ERROR')
    }

    const organizer = await db.fairOrganizer.findUnique({
      where: { id },
      select: { id: true, approvalStatus: true },
    })
    if (!organizer) throw new ApiError('Organizer not found', 404, 'ORGANIZER_NOT_FOUND')

    const updated = await db.fairOrganizer.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        rejectionReason: reason.slice(0, 300),
        approvedAt: null,
        approvedBy: adminClerkId, // who made the decision — recorded either way
      },
      select: {
        id: true, name: true, contactEmail: true,
        approvalStatus: true, rejectionReason: true, approvedBy: true,
      },
    })

    logger.warn('[OrganizerApproval] REJECTED', {
      adminClerkId, organizerId: updated.id, previousStatus: organizer.approvalStatus, reason,
    })

    return success({ organizer: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
