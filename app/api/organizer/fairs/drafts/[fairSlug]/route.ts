import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { EventStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { resolveOwnedFair } from '@/lib/organizer-fair-context'
import { logger } from '@/lib/logger'

// DELETE /api/organizer/fairs/drafts/[fairSlug]
//
// HARD DELETE — the row is removed and its slug is freed for reuse. This is the ONLY hard delete
// of an Event in the codebase, and it is a DIFFERENT operation from
// DELETE /api/organizer/fairs/[fairSlug], which soft-deletes (archives) a real fair so its orders,
// payouts and vendor records survive and keep settling. Two verbs, two routes, no shared handler:
// nothing here should ever be reachable by a caller that meant "archive my fair".
//
// WHY A HARD DELETE IS DEFENSIBLE HERE, stated as the invariant it depends on:
//   A DRAFT fair can only ever own a FulfillmentConfig (created with it, CASCADE — correct to
//   remove). It can NEVER own a Vendor or a Runner, because both attach paths refuse a draft
//   (lib/fair-join-gate.ts), and both of those relations CASCADE — a person's record would
//   otherwise vanish silently. It can never own an Order, because orders require a vendor.
//
// TWO INDEPENDENT BACKSTOPS, because the invariant above is enforced by code that a future edit
// could weaken:
//   1. The status check below refuses anything that is not DRAFT, with a named error.
//   2. Order.event is a RESTRICT relation (schema.prisma) with no onDelete rule, so if a fair
//      somehow held an order, Postgres REFUSES the delete outright. Money cannot be destroyed by
//      this route even if every check above it were removed.
// GET /api/organizer/fairs/drafts/[fairSlug]
// Prefill payload for "Continue editing" — the wizard reopens with this draft's saved values.
// NOT step-resume: there is no persisted wizard step and no partial payload, so the wizard always
// opens at step 1 with a COMPLETE fair loaded. Resume is a separate future feature.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> },
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params
    const event = await resolveOwnedFair(fairSlug, organizerId, { includeDraft: true })
    if (event.status !== EventStatus.DRAFT) {
      throw new ApiError('Not a draft fair', 409, 'CANNOT_DELETE_NON_DRAFT')
    }

    const full = await db.event.findUniqueOrThrow({
      where: { id: event.id },
      select: {
        name: true, urlSlug: true, description: true, startDate: true, endDate: true,
        venueAddress: true, venueCity: true, venueState: true, venueZip: true,
        openTime: true, closeTime: true, timezone: true, primaryColor: true,
        maxVendors: true, admissionFree: true,
        fulfillmentConfig: { select: { boothPickupEnabled: true, homeDeliveryEnabled: true } },
      },
    })
    return success({ draft: full })
  } catch (err) {
    return handleApiError(err)
  }
}

// PATCH /api/organizer/fairs/drafts/[fairSlug]   body: { ...wizard fields, publish?: boolean }
//
// Updates a draft in place and, with publish: true, PROMOTES it to UPCOMING — the moment a draft
// stops being a draft and becomes a real fair, visible to organizerFairScope and countable.
//
// UPDATE, NEVER CREATE. "Continue editing → Publish" must promote THIS row; creating a second
// Event would leave the draft orphaned and burn another slug. The slug itself is never rewritten:
// it was reserved at creation and stays frozen, exactly like any other fair's.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> },
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params
    const event = await resolveOwnedFair(fairSlug, organizerId, { includeDraft: true })

    if (event.status !== EventStatus.DRAFT) {
      throw new ApiError(
        'Only draft fairs can be edited here. Published fairs use the fair settings page.',
        409,
        'CANNOT_DELETE_NON_DRAFT',
      )
    }

    const body = await req.json()
    const {
      name, description, startDate, endDate,
      venueAddress, venueCity, venueState, venueZip,
      openTime, closeTime, timezone, accentColor,
      maxVendors, deliveryEnabled, pickupEnabled, admissionFree, publish,
    } = body

    // Publishing enforces the same floor as creating: a real fair always has a name and dates.
    if (!name || !String(name).trim()) throw new ApiError('Fair name is required', 400, 'VALIDATION_ERROR')
    if (!startDate || !endDate)        throw new ApiError('Start and end dates are required', 400, 'VALIDATION_ERROR')

    const updated = await db.event.update({
      where: { id: event.id },
      data: {
        name: String(name).trim(),
        description: description ?? null,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        timezone: timezone || 'America/Chicago',
        primaryColor: accentColor || '#FF0077',
        venueAddress: venueAddress ?? null,
        venueCity:    venueCity ?? null,
        venueState:   venueState ?? null,
        venueZip:     venueZip ?? null,
        openTime:     openTime ?? null,
        closeTime:    closeTime ?? null,
        maxVendors:   typeof maxVendors === 'number' ? maxVendors : null,
        admissionFree: admissionFree ?? true,
        ...(publish === true ? { status: EventStatus.UPCOMING } : {}),
        fulfillmentConfig: {
          update: {
            boothPickupEnabled:  pickupEnabled ?? true,
            homeDeliveryEnabled: deliveryEnabled ?? false,
          },
        },
      },
      select: { id: true, name: true, urlSlug: true, status: true },
    })

    if (publish === true) {
      logger.info('[DraftFair] PUBLISHED', { organizerId, eventId: updated.id, urlSlug: updated.urlSlug })
    }

    revalidateTag(`organizer-fairs-${organizerId}`, 'default')
    revalidateTag('fair', 'default')

    return success(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> },
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    // includeDraft — one of only two callers permitted to set it (this route and the drafts list).
    // Ownership is enforced by the resolver: an organizer can only ever delete their OWN draft.
    const event = await resolveOwnedFair(fairSlug, organizerId, { includeDraft: true })

    // NOT a silent no-op. Deleting a published fair must fail loudly and by name, so a mis-wired
    // caller is a visible error rather than an archive that never happened — or worse, a real
    // fair destroyed by a route the UI only ever points at drafts.
    if (event.status !== EventStatus.DRAFT) {
      throw new ApiError(
        'Only draft fairs can be deleted. Published fairs are archived instead.',
        409,
        'CANNOT_DELETE_NON_DRAFT',
      )
    }

    await db.event.delete({ where: { id: event.id } })

    logger.info('[DraftFair] DELETED', {
      organizerId, eventId: event.id, urlSlug: fairSlug,
    })

    // Same cache pair the create/settings/archive routes touch. The drafts list is not cached, but
    // the organizer fair list is, and a freed slug must not be served from a stale public cache.
    revalidateTag(`organizer-fairs-${organizerId}`, 'default')
    revalidateTag('fair', 'default')

    return success({ deleted: true, slugFreed: fairSlug })
  } catch (err) {
    return handleApiError(err)
  }
}
