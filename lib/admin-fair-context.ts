import { Prisma } from '@prisma/client'
import { db } from './db'
import { ApiError } from './api-error'
import { requireStrictAdminAuth } from './auth'
import { logger } from './logger'

// The columns every admin-portal route needs from the resolved fair. Kept
// generous (all scalars the 7 admin routes read) so NO route ever has to
// re-resolve the Event — the chokepoint is the single Event resolution on the
// admin surface. Relations (vendors, fulfillmentConfig, runners) are fetched by
// routes via their own models keyed by the resolved event.id, so they never
// re-hit Event.
const ADMIN_FAIR_SELECT = {
  id: true,
  name: true,
  urlSlug: true,
  status: true,
  isPaused: true,
  startDate: true,
  endDate: true,
  eventLat: true,
  eventLng: true,
  serviceChargeEnabled: true,
  serviceChargeAmount: true,
  featuredVendorIds: true,
  featuredLabel: true,
  featuredEnabled: true,
  organizerId: true,
} satisfies Prisma.EventSelect

export type AdminFair = Prisma.EventGetPayload<{ select: typeof ADMIN_FAIR_SELECT }>

export interface AdminFairContext {
  event: AdminFair
  adminClerkId: string
}

/**
 * THE single admin cross-fair chokepoint.
 *
 * Order of operations is the whole security contract:
 *   1. Authenticated?  (Clerk session)
 *   2. STRICT platform admin?  (admin | super_admin — NOT event_operator; D2),
 *      read via a FRESH currentUser() call, NOT JWT sessionClaims — so a revoked
 *      admin loses access on the very next request (A5, no stale token).
 *      A pure organizer has no admin role and is structurally rejected here
 *      BEFORE any fair is resolved (A3).
 *   3. Resolve the fair UNSCOPED by ownership. Admins are cross-fair by design;
 *      the unscoped resolve is SAFE only because (2) already proved the caller is
 *      a platform admin. This is the ONLY unscoped Event resolve permitted on the
 *      admin surface — the grep invariant: no `event.findFirst/findUnique` may
 *      exist under app/api/admin/* outside this helper.
 *   4. Audit (D6): one line per cross-fair resolution.
 *
 * @param idOrSlug  Event UUID or urlSlug (admin pages pass the slug).
 */
export async function requireAdminFairContext(idOrSlug: string): Promise<AdminFairContext> {
  // Steps 1–2 (authenticated + STRICT admin, fresh currentUser() read) live in the
  // shared gate so the chokepoint and the kill-switch write can't drift.
  const adminClerkId = await requireStrictAdminAuth()

  const event = await db.event.findFirst({
    where: { OR: [{ id: idOrSlug }, { urlSlug: idOrSlug }] },
    select: ADMIN_FAIR_SELECT,
  })
  if (!event) throw new ApiError('Event not found', 404, 'EVENT_NOT_FOUND')

  // D6 — audit every admin cross-fair access. One line, in the chokepoint, so it
  // cannot be forgotten by an individual route.
  logger.info('[AdminFairAccess]', {
    userId: adminClerkId,
    eventId: event.id,
    urlSlug: event.urlSlug,
  })

  return { event, adminClerkId }
}
