import { ApiError } from './api-error'

/** The org-suspension shape read on every organizer request (A6 kill-switch). */
export interface OrganizerSuspensionState {
  suspendedAt:     Date | null
  suspendedReason: string | null
}

/**
 * The single source of truth for "is this organizer suspended?" — used by
 * requireOrganizerAuth (the read boundary) AND the runtime proofs, so the proof
 * exercises the SAME decision the boundary makes.
 *
 * Returns a 403 ApiError (distinct ORGANIZER_SUSPENDED code, NOT the generic
 * FORBIDDEN) when suspended, or null when clear. Callers throw the returned error.
 */
export function organizerSuspensionError(
  org: OrganizerSuspensionState | null | undefined
): ApiError | null {
  if (!org?.suspendedAt) return null
  return new ApiError(
    org.suspendedReason
      ? `Organizer account suspended: ${org.suspendedReason}`
      : 'Organizer account suspended',
    403,
    'ORGANIZER_SUSPENDED'
  )
}
