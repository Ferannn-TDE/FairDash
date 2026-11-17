// WHO SEES A VENDOR DECISION'S REVIEWER (Jordan, Nov 16). The one place that turns an
// ApprovalAction row into the words a viewer is shown, so no screen or email decides it alone.
//
//   admin screens — the reviewer's full name (as recorded when they decided).
//   organizers    — a name only when the reviewer is from their OWN organization; any decision by
//                   FairSynq staff shows as "FairSynq".
//   vendors       — never a person's name: "FairSynq", or the organizer's organization name.
//
// Import-free on purpose (pure), so tests and every reader share it without a database.

export type ReviewViewer =
  | { kind: 'admin' }
  | { kind: 'organizer'; organizerId: string }
  | { kind: 'vendor' }

/** The ApprovalAction columns a label needs. `detail.organizerId` / `detail.organizerName` are
 *  written on organizer decisions (sub-step B). */
export interface ReviewRecord {
  actorType: string
  actorName: string | null
  detail?: unknown
}

export const FAIRSYNQ_LABEL = 'FairSynq'
/** Admin view of a FairSynq decision recorded before names were (rows older than Nov 16). */
export const UNRECORDED_LABEL = 'FairSynq (before names were recorded)'
const ORGANIZER_FALLBACK = 'The event organizer'

function detailString(detail: unknown, key: string): string | null {
  if (!detail || typeof detail !== 'object') return null
  const v = (detail as Record<string, unknown>)[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function reviewerLabel(viewer: ReviewViewer, rec: ReviewRecord): string {
  const byOrganizer = rec.actorType === 'organizer'
  const orgId = detailString(rec.detail, 'organizerId')
  const orgName = detailString(rec.detail, 'organizerName')
  const name = rec.actorName?.trim() ? rec.actorName.trim() : null

  if (viewer.kind === 'admin') {
    if (byOrganizer) {
      const org = orgName ? `organizer, ${orgName}` : 'organizer'
      return name ? `${name} (${org})` : (orgName ?? ORGANIZER_FALLBACK)
    }
    return name ?? UNRECORDED_LABEL
  }

  if (viewer.kind === 'organizer') {
    if (byOrganizer && orgId !== null && orgId === viewer.organizerId) return name ?? orgName ?? ORGANIZER_FALLBACK
    if (byOrganizer) return orgName ?? ORGANIZER_FALLBACK
    return FAIRSYNQ_LABEL
  }

  // Vendors: an organization, never a person.
  return byOrganizer ? (orgName ?? ORGANIZER_FALLBACK) : FAIRSYNQ_LABEL
}

/**
 * The name recorded on a decision: the sign-in name (full name, else first + last), else the
 * account's name on file, else the part of the email before the @. Null only when none exist.
 */
export function reviewerNameFrom(parts: {
  fullName?: string | null
  firstName?: string | null
  lastName?: string | null
  dbName?: string | null
  email?: string | null
}): string | null {
  const clean = (s: string | null | undefined) => (typeof s === 'string' && s.trim() ? s.trim() : null)
  const full = clean(parts.fullName) ?? clean([clean(parts.firstName), clean(parts.lastName)].filter(Boolean).join(' '))
  if (full) return full.slice(0, 200)
  const db = clean(parts.dbName)
  if (db) return db.slice(0, 200)
  const local = clean(parts.email?.split('@')[0])
  return local ? local.slice(0, 200) : null
}
