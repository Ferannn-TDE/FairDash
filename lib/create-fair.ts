// CREATE A FAIR — the ONE place an organizer's Event row is created (sign-up-fixes commit 4).
//
// Moved here UNCHANGED from POST /api/organizer/fairs (the create-fair wizard), so the organizer
// sign-up form can save the organizer's first event as a hidden DRAFT with the very same code, and
// the wizard later opens that draft prefilled (/organizer/fairs/new?draft=<slug>). Callers own
// their own checks (who may create, required fields, venue address on publish); this function only
// writes the row.
//
// A DRAFT is excluded from every list, count and public surface until it is published (see
// lib/organizer-fair-context.ts organizerFairScope / organizerDraftScope, lib/fairs.ts ACTIVE-only
// reads). It ALWAYS gets its FulfillmentConfig here: the draft PATCH updates that row, and would
// fail on a draft created without one.

import { EventStatus, type Prisma, type PrismaClient } from '@prisma/client'

type Client = Prisma.TransactionClient | PrismaClient

/** The wizard's slug rule: lower-case words joined by dashes, at most 60 characters. */
export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

/** A free urlSlug: the slugified base, then base-2, base-3 … (archived and draft rows still count). */
export async function uniqueEventSlug(client: Client, base: string): Promise<string> {
  const root = slugify(base) || 'fair'
  let slug = root
  for (let i = 2; await client.event.findUnique({ where: { urlSlug: slug }, select: { id: true } }); i++) {
    slug = `${root}-${i}`
  }
  return slug
}

/** What the wizard (and the sign-up form) send. Venue fields are already checked by the caller. */
export interface CreateFairInput {
  name: string
  slug?: string | null
  description?: string | null
  startDate: string | Date
  endDate: string | Date
  timezone?: string | null
  accentColor?: string | null
  venueAddress?: string | null
  venueCity?: string | null
  venueState?: string | null
  venueZip?: string | null
  openTime?: string | null
  closeTime?: string | null
  maxVendors?: unknown
  admissionFree?: boolean | null
  pickupEnabled?: boolean | null
  deliveryEnabled?: boolean | null
}

/** Create the Event (and its FulfillmentConfig). DRAFT when `asDraft`, otherwise UPCOMING. */
export async function createFairRecord(client: Client, organizerId: string, input: CreateFairInput, opts: { asDraft: boolean }) {
  const urlSlug = await uniqueEventSlug(client, input.slug || input.name)
  return client.event.create({
    data: {
      organizerId,
      name: String(input.name).trim(),
      urlSlug,
      description: input.description ?? null,
      // "Save Draft" parks the fair as DRAFT; "Create" publishes it as UPCOMING. A DRAFT is
      // excluded from every list/count/public surface by organizerFairScope until published.
      status: opts.asDraft ? EventStatus.DRAFT : EventStatus.UPCOMING,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      // The wizard's default timezone (app/organizer/fairs/new/page.tsx) and the column default.
      timezone: input.timezone || 'America/Chicago',
      primaryColor: input.accentColor || '#FF0077',
      venueAddress: input.venueAddress ?? null,
      venueCity:    input.venueCity ?? null,
      venueState:   input.venueState ?? null,
      venueZip:     input.venueZip ?? null,
      openTime:     input.openTime ?? null,
      closeTime:    input.closeTime ?? null,
      maxVendors:   typeof input.maxVendors === 'number' ? input.maxVendors : null,
      admissionFree: input.admissionFree ?? true,
      // Fulfillment toggles → the 1:1 FulfillmentConfig.
      fulfillmentConfig: {
        create: {
          boothPickupEnabled:  input.pickupEnabled ?? true,
          homeDeliveryEnabled: input.deliveryEnabled ?? false,
          curbsideEnabled:     false,
        },
      },
    },
    select: { id: true, name: true, urlSlug: true, status: true },
  })
}
