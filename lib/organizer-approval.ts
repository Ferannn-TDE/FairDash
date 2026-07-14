import { ApiError } from './api-error'

/** The approval shape read on every organizer request (the #7 approval gate). */
export interface OrganizerApprovalState {
  approvalStatus:  string          // ApprovalStatus: PENDING | APPROVED | REJECTED
  rejectionReason: string | null
}

/**
 * The single source of truth for "may this organizer operate?" — used by
 * requireOrganizerAuth (the read boundary) AND the runtime proofs, so the proof exercises the
 * SAME decision the boundary makes. Mirrors organizerSuspensionError (A6) exactly.
 *
 * WHY THIS GATE EXISTS. The organizer is the highest-authority role — creates fairs, approves
 * VENDORS, and acts in the money flow (refunds, disputes, chargebacks) — and was the only
 * ungated one (self-active on signup, while vendors and runners both wait). An unapproved
 * organizer deciding who may sell at a fair, or issuing refunds, is exactly what this stops.
 *
 * Because all 26 organizer routes funnel through requireOrganizerAuth, this ONE check blocks
 * every one of those powers SERVER-SIDE. Fair creation is among them, so a pending organizer
 * can never accumulate a fair — hence no orphaned-fair problem if they are later rejected.
 *
 * DISTINCT from suspension: approval is "may you operate at all"; suspension is "you were
 * approved, but we've stopped you". Distinct codes so the UI can say the right thing.
 *
 * Returns a 403 ApiError (ORGANIZER_NOT_APPROVED / ORGANIZER_REJECTED — never the generic
 * FORBIDDEN) when not approved, or null when clear. Callers throw the returned error.
 */
export function organizerApprovalError(
  org: OrganizerApprovalState | null | undefined,
): ApiError | null {
  if (!org) return null
  if (org.approvalStatus === 'APPROVED') return null

  if (org.approvalStatus === 'REJECTED') {
    return new ApiError(
      org.rejectionReason
        ? `Organizer application declined: ${org.rejectionReason}`
        : 'Organizer application declined',
      403,
      'ORGANIZER_REJECTED',
    )
  }

  return new ApiError(
    'Your organizer account is awaiting admin approval',
    403,
    'ORGANIZER_NOT_APPROVED',
  )
}
