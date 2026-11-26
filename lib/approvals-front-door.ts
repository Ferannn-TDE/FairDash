// APPROVALS FRONT DOOR (Jordan, Nov 25). PENDING applications (vendor booths, organizers,
// partners) are decided ONLY on the Approvals page: POST /api/admin/approvals/{kind}/{id} →
// lib/approvals.ts decide(), the one path that writes the ApprovalAction and queues the
// applicant's email in the same transaction.
//
// The older admin routes (app/api/admin/organizers/[id]/approve|reject and
// app/api/admin/vendor-members/[id]/approve|reject) change status only. On Nov 25 every decision
// made there sent no email, so they now refuse a PENDING application with 409
// DECIDE_IN_APPROVALS and change nothing. They keep working for records already decided and for
// team members.
//
// No database, no server-only imports: the admin screens use the same code and text.

export const DECIDE_IN_APPROVALS_CODE = 'DECIDE_IN_APPROVALS'

/** Fixed text, never built from server data (toast-leak rule). */
export const DECIDE_IN_APPROVALS_TEXT = 'Pending applications are decided on the Approvals page.'

/**
 * A VendorMember row is a vendor APPLICATION when it is the owner of a booth that is still
 * PENDING. Team members, and owners of booths that are no longer PENDING, are not applications:
 * Booth Operators still decides those.
 */
export function isBoothApplication(facts: { role: string; boothStatus: string }): boolean {
  return facts.role === 'owner' && facts.boothStatus === 'PENDING'
}
