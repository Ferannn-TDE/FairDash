// The admin side of the menu approver rule (audit H5, Step 2g).
//
// An admin approves menu requests ONLY for a fair that has no organizer; a fair with an organizer
// is the organizer's to decide. Every refusal is a 404, the same answer as a fair that does not
// exist: a non-admin (including event_operator), and an admin asking about a fair with an
// organizer. The fair itself is resolved through requireAdminFairContext, the one admin
// cross-fair chokepoint.

import { db } from '../db'
import { ApiError } from '../api-error'
import { hasStrictAdminAuth } from '../auth'
import { requireAdminFairContext, type AdminFair } from '../admin-fair-context'

const fairNotFound = () => new ApiError('Event not found', 404, 'NOT_FOUND')

export interface AdminMenuApprover {
  event: AdminFair
  /** The admin's DB User.id: reviewedBy and the audit rows are keyed on it (foreign key). */
  reviewerUserId: string
}

export async function requireAdminMenuApprover(idOrSlug: string): Promise<AdminMenuApprover> {
  if (!(await hasStrictAdminAuth())) throw fairNotFound()
  const { event, adminClerkId } = await requireAdminFairContext(idOrSlug)
  if (event.organizerId) throw fairNotFound()
  const user = await db.user.findUnique({ where: { clerkId: adminClerkId }, select: { id: true } })
  if (!user) {
    throw new ApiError('Your admin account has no FairSynq user record yet, so the decision cannot be recorded. Sign in to the app once, then try again.', 409, 'ADMIN_USER_MISSING')
  }
  return { event, reviewerUserId: user.id }
}
