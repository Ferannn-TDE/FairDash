// WHO MAY APPROVE OR REJECT A VENDOR (Jordan, Nov 16; locked decision 2 + the override change).
//
//   The event HAS an organizer → that organizer decides. FairSynq staff get 409
//     APPROVAL_BY_ORGANIZER, EXCEPT a strict admin (admin | super_admin; never platform_manager or
//     event_operator), who may decide anyway as an OVERRIDE with a required reason. The override is
//     recorded (ApprovalAction.detail.override + the reason) and the organizer is emailed
//     (lib/approvals.ts).
//   The event has NO organizer → FairSynq decides (the approvals roles: admin, super_admin,
//     platform_manager). An organizer can never decide a booth on another organization's event.
//
// Applies to approve AND reject, on every door (lib/approvals.ts calls it for each decision). The
// same checklist and Stripe payouts check run however the decision is made.
//
// Import-free apart from ApiError, so the rule is one small function every door shares.

import { ApiError } from './api-error'

export const STRICT_ADMIN_ACTOR_TYPES = ['admin', 'super_admin'] as const

export interface ApproverInput {
  /** Event.organizerId of the booth's event (null: no organizer). */
  eventOrganizerId: string | null
  /** 'organizer' for an organizer decision; otherwise the FairSynq role the decision is recorded under. */
  actorType: string
  /** The deciding organizer's organization (organizer decisions only). */
  actorOrganizerId?: string | null
  /** The reason sent with the decision (required for an override). */
  reason: unknown
}

export interface ApproverOutcome {
  /** True when a strict admin decides on an organizer's event. */
  override: boolean
}

export const APPROVAL_BY_ORGANIZER_MESSAGE = "This event's organizer approves its vendors."
export const OVERRIDE_REASON_MESSAGE =
  'This event has an organizer. To decide as FairSynq anyway, give a reason. It is recorded and the organizer is emailed.'

/** Throws when this caller may not decide this booth; otherwise says whether it is an override. */
export function vendorApproverCheck(input: ApproverInput): ApproverOutcome {
  if (input.actorType === 'organizer') {
    if (!input.eventOrganizerId || !input.actorOrganizerId || input.eventOrganizerId !== input.actorOrganizerId) {
      throw new ApiError('Access denied', 403, 'FORBIDDEN')
    }
    return { override: false }
  }
  if (!input.eventOrganizerId) return { override: false }
  if (!(STRICT_ADMIN_ACTOR_TYPES as readonly string[]).includes(input.actorType)) {
    throw new ApiError(APPROVAL_BY_ORGANIZER_MESSAGE, 409, 'APPROVAL_BY_ORGANIZER')
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (!reason) throw new ApiError(OVERRIDE_REASON_MESSAGE, 400, 'OVERRIDE_REASON_REQUIRED')
  return { override: true }
}
