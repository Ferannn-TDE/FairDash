import { EventStatus } from '@prisma/client'
import { ApiError } from './api-error'

/**
 * THE ACQUISITION GATE — a DRAFT fair may never acquire a Vendor or a Runner.
 *
 * WHY THIS IS A SAFETY PRECONDITION, NOT A NICETY. Discarding a draft is a HARD DELETE, and the
 * Event relations do not all behave the same way under one:
 *
 *   Vendor   → onDelete: Cascade   — silently deleted with the fair
 *   Runner   → onDelete: Cascade   — silently deleted with the fair
 *   Order    → Restrict (no rule)  — Postgres REFUSES the delete. Money is safe by construction.
 *   FulfillmentConfig → Cascade    — created with every fair; correct to remove with it
 *
 * So the Order relation protects money for free, but a Vendor or Runner attached to a draft would
 * be a real person's record destroyed without a trace when the organizer clicks "Delete draft".
 * Hard delete is only defensible while a draft provably cannot hold either. This function is what
 * makes that "provably".
 *
 * WHERE THE LEAK WAS. The public entry points filter status: ACTIVE and are safe already. The two
 * paths that actually mint these rows resolve the fair by SLUG ALONE, with no status filter:
 *   app/api/vendors/route.ts   — vendor signup   (findFirst { urlSlug, archivedAt: null })
 *   app/api/drivers/route.ts   — runner minting  (findUnique { urlSlug })
 * A leaked or guessed draft slug was enough to attach to one. Both now call this.
 *
 * (lib/resolve-vendor.ts resolves by slug too, but only READS existing vendors — a draft has none
 * to find, so it cannot acquire anything and is deliberately not gated here.)
 */

/** Distinct code so the UI can say "this fair isn't published yet" rather than a generic 403. */
export const FAIR_NOT_JOINABLE = 'FAIR_NOT_JOINABLE'

/**
 * Throws when `status` belongs to a fair that must not gain vendors or runners.
 * Call immediately after resolving the fair and BEFORE any create.
 */
export function assertFairAcceptsJoins(status: EventStatus, fairLabel = 'This fair'): void {
  if (status === EventStatus.DRAFT) {
    throw new ApiError(
      `${fairLabel} has not been published yet and is not accepting applications.`,
      404,
      FAIR_NOT_JOINABLE,
    )
  }
}

/** Non-throwing form, for callers that degrade rather than error (e.g. best-effort minting). */
export function fairAcceptsJoins(status: EventStatus): boolean {
  return status !== EventStatus.DRAFT
}
