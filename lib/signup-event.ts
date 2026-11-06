// Creates the vendor sign-up holding event (Batch 1 item 5b). With the creation script, this is
// the ONLY code that writes Event.listing (scripts/event-listing-test.ts enforces that).
//
// Refuses, writing nothing, when:
//   - no organizer has a member with that email, or the organizer isn't APPROVED, or is suspended
//   - a live SIGNUP_ONLY event already exists (exactly-one rule; UNLISTED/PUBLIC never count)
//   - the slug is taken
// Production creation waits until the client has an approved organizer account on www and you
// say go (docs/BATCH-1.md §B1.18).

import { EventListing, EventStatus, type PrismaClient } from '@prisma/client'
import { LIVE_SIGNUP_EVENT_WHERE } from '@/lib/event-listing'

export interface SignupEventInput {
  organizerEmail: string
  name: string
  slug: string
  startDate: Date
  endDate: Date
}

export const SIGNUP_EVENT_DEFAULTS = {
  name: 'FairSynq Vendor Sign-up 2027',
  slug: 'vendor-signup-2027',
  start: '2026-11-09',
  end: '2027-12-31',
} as const

export class SignupEventRefused extends Error {
  constructor(public code: 'NO_ORGANIZER' | 'NOT_APPROVED' | 'SUSPENDED' | 'ALREADY_EXISTS' | 'SLUG_TAKEN' | 'BAD_DATES', message: string) {
    super(message)
    this.name = 'SignupEventRefused'
  }
}

type Db = Pick<PrismaClient, 'event' | 'orgMember' | '$transaction'>

/** Everything the write needs, checked. Throws SignupEventRefused; writes nothing. */
export async function planSignupEvent(db: Db, input: SignupEventInput) {
  const email = input.organizerEmail.trim().toLowerCase()
  if (!(input.startDate < input.endDate)) throw new SignupEventRefused('BAD_DATES', 'Start date must be before end date')

  const member = await db.orgMember.findFirst({
    where: { user: { email: { equals: email, mode: 'insensitive' } } },
    select: { organizer: { select: { id: true, name: true, approvalStatus: true, suspendedAt: true } } },
    orderBy: { createdAt: 'asc' },
  })
  if (!member) throw new SignupEventRefused('NO_ORGANIZER', `No organizer has a member with email ${email}`)
  const org = member.organizer
  if (org.approvalStatus !== 'APPROVED') throw new SignupEventRefused('NOT_APPROVED', `Organizer "${org.name}" is ${org.approvalStatus}, not APPROVED`)
  if (org.suspendedAt) throw new SignupEventRefused('SUSPENDED', `Organizer "${org.name}" is suspended`)

  const existing = await db.event.findFirst({ where: LIVE_SIGNUP_EVENT_WHERE, select: { urlSlug: true } })
  if (existing) throw new SignupEventRefused('ALREADY_EXISTS', `A sign-up event already exists: ${existing.urlSlug}`)

  const slugTaken = await db.event.findUnique({ where: { urlSlug: input.slug }, select: { id: true } })
  if (slugTaken) throw new SignupEventRefused('SLUG_TAKEN', `Slug ${input.slug} is already used by another event`)

  return { organizer: org, email }
}

export async function createSignupEvent(db: Db, input: SignupEventInput) {
  const { organizer } = await planSignupEvent(db, input)
  return db.$transaction(async (tx) => {
    // Re-check inside the transaction so a concurrent run can't slip a second one in between.
    const again = await tx.event.findFirst({ where: LIVE_SIGNUP_EVENT_WHERE, select: { urlSlug: true } })
    if (again) throw new SignupEventRefused('ALREADY_EXISTS', `A sign-up event already exists: ${again.urlSlug}`)
    return tx.event.create({
      data: {
        organizerId: organizer.id,
        name: input.name,
        urlSlug: input.slug,
        status: EventStatus.UPCOMING,
        listing: EventListing.SIGNUP_ONLY,
        startDate: input.startDate,
        endDate: input.endDate,
        timezone: 'America/Chicago',
        // No venue on purpose: a sign-up event has no place, and Go Live refuses it anyway.
        fulfillmentConfig: {
          create: { boothPickupEnabled: false, homeDeliveryEnabled: false, curbsideEnabled: false },
        },
      },
      select: { id: true, name: true, urlSlug: true, status: true, listing: true, organizerId: true },
    })
  })
}
