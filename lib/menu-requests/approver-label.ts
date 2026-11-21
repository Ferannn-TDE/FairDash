// WHO A VENDOR'S PENDING MENU REQUEST IS WAITING FOR (audit H5, Step 2g).
//
// The approver rule (lib/menu-requests/apply-decision.ts): the event's organizer, or FairSynq (a
// strict platform admin) when the event has no organizer. The vendor's screen must name the right
// one: "waiting for the organizer" on a fair that has none would point them at nobody.
//
// Import-free: the API stamps the label on each request row, and the vendor menu page words its
// toast, banner and chips from it.

export type MenuApproverLabel = 'organizer' | 'FairSynq'

/** The approver for a fair, from its organizerId. */
export function menuApproverLabel(organizerId: string | null | undefined): MenuApproverLabel {
  return organizerId ? 'organizer' : 'FairSynq'
}

/** "Waiting for the organizer" / "Waiting for FairSynq". Unknown falls back to the organizer. */
export function waitingFor(approver: MenuApproverLabel | null | undefined): string {
  return approver === 'FairSynq' ? 'Waiting for FairSynq' : 'Waiting for the organizer'
}
