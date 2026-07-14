import { organizerApprovalError, type OrganizerApprovalState } from './organizer-approval'
import { organizerSuspensionError, type OrganizerSuspensionState } from './organizer-suspension'

/**
 * The ORGANIZER-FACING side of the #7 gate (slice 4) — what the organizer on the receiving end
 * of an admin decision sees when they sign in.
 *
 * THE PROBLEM THIS CLOSES. The gate (slice 1) blocks a pending/rejected/suspended organizer
 * from all 26 powers server-side, and the admin panel (slice 3) lets an admin make and see
 * those decisions. But the organizer's own portal gated on OrgMember EXISTENCE only — so a
 * pending organizer passed the guard, landed on the dashboard, and every route 403'd
 * underneath them: a wall of failed queries, not an "awaiting approval" screen. Worst of all,
 * the REJECTION REASON — required, validated, audited, and surfaced to the admin — was never
 * shown to the rejected organizer. The whole point of requiring a reason ("so a rejected
 * person knows why, rather than hitting a silent wall") was undelivered on the one screen that
 * mattered to them. This is exactly that silent wall.
 *
 * DERIVED FROM THE GATE, NOT A PARALLEL COPY. This computes the screen from the SAME two
 * functions requireOrganizerAuth throws with (organizerApprovalError, organizerSuspensionError)
 * — including the SAME message text. So the screen can never drift from the 403: whatever the
 * gate decided is what the organizer is told, by construction. Same "one source of truth"
 * discipline as slice 3's view-model, applied to the other side of the wall.
 *
 * ORDER MATCHES THE GATE. Approval is checked BEFORE suspension, exactly as requireOrganizerAuth
 * does: an organizer who was never approved is AWAITING (or DECLINED) — NOT "suspended". Nobody
 * stopped them; we never let them in. The two-axis distinction from slice 3, seen from the
 * organizer's chair.
 */

export type OrganizerPortalState = 'ACTIVE' | 'AWAITING' | 'DECLINED' | 'SUSPENDED'

export interface OrganizerPortalView {
  state: OrganizerPortalState
  /** The exact message the SERVER GATE returns for this state (null when ACTIVE). The screen
   *  shows this verbatim, so it can never say something the 403 wouldn't. */
  message: string | null
  /** The rejection or suspension reason, surfaced to the organizer — the thing the whole
   *  reason-requirement existed to deliver. Null when ACTIVE or when no reason was recorded. */
  reason: string | null
}

type OrganizerGateFacts = OrganizerApprovalState & OrganizerSuspensionState

export function organizerPortalState(
  org: OrganizerGateFacts | null | undefined,
): OrganizerPortalView {
  // Approval FIRST — same precedence as requireOrganizerAuth.
  const approvalErr = organizerApprovalError(org)
  if (approvalErr) {
    return {
      state: approvalErr.code === 'ORGANIZER_REJECTED' ? 'DECLINED' : 'AWAITING',
      message: approvalErr.message,
      // A declined application shows its reason; an awaiting one has none yet.
      reason: approvalErr.code === 'ORGANIZER_REJECTED' ? (org?.rejectionReason ?? null) : null,
    }
  }

  // Then suspension — an APPROVED organizer we later stopped.
  const suspendErr = organizerSuspensionError(org)
  if (suspendErr) {
    return { state: 'SUSPENDED', message: suspendErr.message, reason: org?.suspendedReason ?? null }
  }

  return { state: 'ACTIVE', message: null, reason: null }
}
