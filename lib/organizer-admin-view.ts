/**
 * The admin Organizers panel's view-model — the ONE place that decides how an organizer row
 * is presented and which actions are offered.
 *
 * WHY A PURE MODULE AND NOT JSX. An organizer carries TWO INDEPENDENT FACTS, and conflating
 * them is the mistake this file exists to make impossible:
 *
 *   approval  — "may you operate AT ALL?"      PENDING | APPROVED | REJECTED   (#7 gate)
 *   operating — "you were approved; are you
 *                still allowed to act?"         ACTIVE | SUSPENDED             (A6 kill-switch)
 *
 * They are enforced by two different gates (organizerApprovalError, organizerSuspensionError)
 * and answer two different questions. An admin who confuses them makes a REAL mistake —
 * un-suspending someone who was never approved, or hunting for a suspension on someone we
 * simply never let in. Same principle as passive-hold vs admin-hold on the money panel: two
 * different truths, two different visuals, never merged into one badge.
 *
 * So the third operating state is NOT_ADMITTED, not "suspended": a pending/rejected organizer
 * is not suspended — nobody stopped them, they were never let in. That distinction is asserted
 * by the panel test, not left to whoever next edits the JSX.
 *
 * Keeping it a pure function means the panel's ACTION AFFORDANCES are testable without a
 * browser: canSuspend is false for an organizer who was never admitted, so the UI cannot
 * offer a kill-switch for someone the gate is already refusing.
 */

export type OrganizerApproval = 'PENDING' | 'APPROVED' | 'REJECTED'
export type OrganizerOperating = 'ACTIVE' | 'SUSPENDED' | 'NOT_ADMITTED'

/** The two raw DB facts the view-model reads. Nothing derived, nothing cached. */
export interface OrganizerRowFacts {
  approvalStatus: OrganizerApproval
  suspendedAt: string | Date | null
}

export interface OrganizerRowView {
  approval: OrganizerApproval
  operating: OrganizerOperating
  /** May an admin admit them? (PENDING, or reconsidering a REJECTED application.) */
  canApprove: boolean
  /** May an admin decline them? (Anyone not already REJECTED — including an operating org.) */
  canReject: boolean
  /** ⛔ Only an ADMITTED, un-suspended organizer can be suspended. You cannot "stop" someone
   *  who was never let in — offering that button is the confusion this guards against. */
  canSuspend: boolean
  /** Only something actually suspended can be un-suspended, and only once they're admitted —
   *  so an admin can never "restore" an organizer who has no approval to be restored to. */
  canUnsuspend: boolean
}

export function organizerRowView(facts: OrganizerRowFacts): OrganizerRowView {
  const approval = facts.approvalStatus
  const suspended = facts.suspendedAt !== null && facts.suspendedAt !== undefined
  const admitted = approval === 'APPROVED'

  // NOT_ADMITTED is deliberately distinct from SUSPENDED. A pending organizer is not
  // "stopped" — they were never started. Rendering them as suspended would tell the admin
  // a plain falsehood about what happened.
  const operating: OrganizerOperating = !admitted
    ? 'NOT_ADMITTED'
    : suspended
      ? 'SUSPENDED'
      : 'ACTIVE'

  return {
    approval,
    operating,
    canApprove: approval !== 'APPROVED',
    canReject: approval !== 'REJECTED',
    canSuspend: admitted && !suspended,
    canUnsuspend: admitted && suspended,
  }
}
