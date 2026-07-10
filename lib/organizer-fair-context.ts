import { Prisma } from '@prisma/client'
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

export interface ResolveOwnedFairOpts {
  // ⚠️ MONEY CARVE-OUT. When true, the `archivedAt: null` clause is OMITTED so the
  // route can still resolve a SOFT-DELETED fair. Reserved for the money/audit
  // paths (organizer refund + chargeback routes) that MUST keep settling after a
  // fair is deleted. NEVER pass this from a customer-facing or list route.
  includeArchived?: boolean
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
    },
    select: OWNED_FAIR_SELECT,
  })
  if (!event) throw new ApiError('Fair not found or access denied', 404, 'NOT_FOUND')
  return event
}
