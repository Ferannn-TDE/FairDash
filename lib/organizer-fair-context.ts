import { Prisma, EventStatus } from '@prisma/client'
import { db } from './db'
import { ApiError } from './api-error'

// The organizer-side mirror of requireAdminFairContext (lib/admin-fair-context.ts).
// ONE place that resolves a fair scoped to its owner AND, by default, hides
// soft-deleted (archived) fairs. The ~15 EXCLUDE organizer sub-routes adopt the
// default so a deleted fair vanishes from every organizer view.
//
// Auth is NOT done here — organizer routes already call requireOrganizerAuth()
// and pass the resulting organizerId in. This helper only SCOPES + ARCHIVE-FILTERS.
//
// Generous scalar select so a route rarely has to re-resolve the Event; relations
// (fulfillmentConfig, vendors, …) are fetched by routes keyed by the returned
// event.id — same pattern as the admin chokepoint.
const OWNED_FAIR_SELECT = {
  id: true,
  name: true,
  urlSlug: true,
  status: true,
  isPaused: true,
  startDate: true,
  endDate: true,
  primaryColor: true,
  organizerId: true,
  archivedAt: true,
} satisfies Prisma.EventSelect

export type OwnedFair = Prisma.EventGetPayload<{ select: typeof OWNED_FAIR_SELECT }>

/**
 * THE ORGANIZER FAIR-LIST SCOPE. One definition; every list read uses it.
 *
 * WHY THIS EXISTS AS A FRAGMENT AND NOT A CLAUSE YOU TYPE. Four organizer readers each carried a
 * hand-written `{ organizerId, archivedAt: null }` — the My Fairs list, the stats counts, the
 * order scope and the vendor scope. Four copies of one predicate, with no shared source. That is
 * exactly why they all leaked the moment a new status existed: there was no single place to add
 * the exclusion to. Adding `status: { not: 'DRAFT' }` inline in four routes would relocate that
 * trap rather than close it, and the NEXT status value would leak the same way.
 *
 * Carries BOTH exclusions, so a caller cannot remember one and forget the other:
 *   archivedAt: null        — soft-deleted fairs vanish from the organizer's view
 *   status: not DRAFT       — half-built fairs are not fairs yet
 *
 * NOT for money/audit paths (they need archived fairs — see resolveOwnedFair's includeArchived),
 * and NOT for the drafts list or draft-delete, which are the only reads that WANT drafts.
 *
 * FREEBIE worth knowing: the My Fairs list previously filtered on archivedAt only, so ENDED
 * (INACTIVE) empty fairs cluttered it. That is unchanged by this fragment — INACTIVE is still
 * listed, by design. Only DRAFT is newly hidden.
 */
export function organizerFairScope(organizerId: string) {
  return {
    organizerId,
    archivedAt: null,
    status: { not: EventStatus.DRAFT },
  } satisfies Prisma.EventWhereInput
}

/** The drafts-only counterpart. The ONLY read that returns drafts, besides draft-delete. */
export function organizerDraftScope(organizerId: string) {
  return {
    organizerId,
    archivedAt: null,
    status: EventStatus.DRAFT,
  } satisfies Prisma.EventWhereInput
}

export interface ResolveOwnedFairOpts {
  // ⚠️ MONEY CARVE-OUT. When true, the `archivedAt: null` clause is OMITTED so the
  // route can still resolve a SOFT-DELETED fair. Reserved for the money/audit
  // paths (organizer refund + chargeback routes) that MUST keep settling after a
  // fair is deleted. NEVER pass this from a customer-facing or list route.
  includeArchived?: boolean

  // ⚠️ DRAFT CARVE-OUT. By default resolveOwnedFair REFUSES a DRAFT fair — every per-fair
  // organizer surface (dashboard, analytics, settings, orders, money) would otherwise happily
  // open a half-built fair. Set true ONLY on the two routes whose subject IS the draft: the
  // drafts list and draft-delete. Anything else passing this is a bug.
  includeDraft?: boolean
}

/**
 * Resolve a fair owned by `organizerId`, hiding archived fairs by default.
 *
 * Default (no opts): scopes to `{ urlSlug, organizerId, archivedAt: null }` — an
 * archived fair 404s. Pass `{ includeArchived: true }` ONLY on the money-response
 * routes so a soft-deleted fair's refund/chargeback paths stay reachable.
 *
 * Throws ApiError(404) when nothing matches (caught by each route's handleApiError).
 */
export async function resolveOwnedFair(
  fairSlug: string,
  organizerId: string,
  opts: ResolveOwnedFairOpts = {},
): Promise<OwnedFair> {
  const event = await db.event.findFirst({
    where: {
      urlSlug: fairSlug,
      organizerId,
      ...(opts.includeArchived ? {} : { archivedAt: null }),
      // Default-refuse DRAFT: a half-built fair must not open the per-fair organizer surfaces.
      ...(opts.includeDraft ? {} : { status: { not: EventStatus.DRAFT } }),
    },
    select: OWNED_FAIR_SELECT,
  })
  if (!event) throw new ApiError('Fair not found or access denied', 404, 'NOT_FOUND')
  return event
}
