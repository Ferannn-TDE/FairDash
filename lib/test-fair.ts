// The hidden B1.17 test fair (docs/BATCH-1.md B1.17, design approved 2026-11-21). With lib/signup-event.ts, the
// only code that writes Event.listing (scripts/event-listing-test.ts allows exactly these two).
//
// CREATE: one UNLISTED, ACTIVE fair owned by an approved organizer, booth pickup on, curbside only with
// `curbside: true`, delivery off, no venue. UNLISTED = reachable and orderable by direct URL while ACTIVE and in
// its dates, but never listed, never in the sitemap, never indexed (lib/event-listing.ts).
// Refuses, writing nothing, when: the organizer is unknown / not APPROVED / suspended; the slug is taken; another
// unarchived UNLISTED fair exists (one test fair at a time); the dates are reversed or span more than 14 days.
// Never reads the clock: the dates are always given.
//
// ARCHIVE: sets archivedAt only (the same write as the organizer's own archive), and only on an UNLISTED fair, so
// it can never archive a real fair or the sign-up event. Orders, payouts and refunds are kept.

import { EventListing, EventStatus, type PrismaClient } from '@prisma/client'

export const TEST_FAIR_DEFAULTS = { name: 'FairSynq Test Fair', slug: 'fairsynq-test-fair' } as const
export const TEST_FAIR_MAX_DAYS = 14
/** Matches the platform curbside setting (fees.curbsideRunnerFeeCents = 399). Read by pre-stage-3 code only;
 *  new-fee orders price curbside from the platform setting. */
const LEGACY_CURBSIDE_FEE = 3.99

export interface TestFairInput {
  organizerEmail: string
  name: string
  slug: string
  startDate: Date
  endDate: Date
  curbside: boolean
}

export class TestFairRefused extends Error {
  constructor(
    public code: 'NO_ORGANIZER' | 'NOT_APPROVED' | 'SUSPENDED' | 'SLUG_TAKEN' | 'ALREADY_EXISTS' | 'BAD_DATES' | 'NOT_FOUND' | 'NOT_UNLISTED' | 'ALREADY_ARCHIVED',
    message: string,
  ) {
    super(message)
    this.name = 'TestFairRefused'
  }
}

type Db = Pick<PrismaClient, 'event' | 'orgMember' | 'order' | 'payout' | 'refund' | '$transaction'>

const LIVE_TEST_FAIR_WHERE = { listing: EventListing.UNLISTED, archivedAt: null }

/** Everything the create needs, checked. Throws TestFairRefused; writes nothing. */
export async function planTestFair(db: Db, input: TestFairInput) {
  if (!(input.startDate <= input.endDate)) throw new TestFairRefused('BAD_DATES', 'Start date must be on or before end date')
  const days = (input.endDate.getTime() - input.startDate.getTime()) / 864e5
  if (days > TEST_FAIR_MAX_DAYS) throw new TestFairRefused('BAD_DATES', `The test fair may span at most ${TEST_FAIR_MAX_DAYS} days`)

  const email = input.organizerEmail.trim().toLowerCase()
  const member = await db.orgMember.findFirst({
    where: { user: { email: { equals: email, mode: 'insensitive' } } },
    select: { organizer: { select: { id: true, name: true, approvalStatus: true, suspendedAt: true } } },
    orderBy: { createdAt: 'asc' },
  })
  if (!member) throw new TestFairRefused('NO_ORGANIZER', `No organizer has a member with email ${email}`)
  const org = member.organizer
  if (org.approvalStatus !== 'APPROVED') throw new TestFairRefused('NOT_APPROVED', `Organizer "${org.name}" is ${org.approvalStatus}, not APPROVED`)
  if (org.suspendedAt) throw new TestFairRefused('SUSPENDED', `Organizer "${org.name}" is suspended`)

  const slugTaken = await db.event.findUnique({ where: { urlSlug: input.slug }, select: { id: true } })
  if (slugTaken) throw new TestFairRefused('SLUG_TAKEN', `Slug ${input.slug} is already used by another event`)
  const existing = await db.event.findFirst({ where: LIVE_TEST_FAIR_WHERE, select: { urlSlug: true } })
  if (existing) throw new TestFairRefused('ALREADY_EXISTS', `A test fair already exists: ${existing.urlSlug} (archive it first)`)

  return { organizer: org }
}

export async function createTestFair(db: Db, input: TestFairInput) {
  const { organizer } = await planTestFair(db, input)
  return db.$transaction(async (tx) => {
    // Re-check inside the transaction so a concurrent run can't add a second test fair.
    const again = await tx.event.findFirst({ where: LIVE_TEST_FAIR_WHERE, select: { urlSlug: true } })
    if (again) throw new TestFairRefused('ALREADY_EXISTS', `A test fair already exists: ${again.urlSlug}`)
    return tx.event.create({
      data: {
        organizerId: organizer.id,
        name: input.name,
        urlSlug: input.slug,
        status: EventStatus.ACTIVE,
        listing: EventListing.UNLISTED,
        startDate: input.startDate,
        endDate: input.endDate,
        timezone: 'America/Chicago',
        // No venue on purpose: ordering doesn't need one, and the organizer Go Live path isn't used.
        fulfillmentConfig: {
          create: {
            boothPickupEnabled: true,
            homeDeliveryEnabled: false,
            curbsideEnabled: input.curbside,
            ...(input.curbside ? { curbsideFee: LEGACY_CURBSIDE_FEE, curbsideZoneDescription: 'Test curbside area' } : {}),
          },
        },
      },
      select: {
        id: true, name: true, urlSlug: true, status: true, listing: true, organizerId: true, startDate: true, endDate: true,
        fulfillmentConfig: { select: { boothPickupEnabled: true, curbsideEnabled: true, homeDeliveryEnabled: true } },
      },
    })
  })
}

/** What archiving would touch, checked. Throws TestFairRefused; writes nothing. */
export async function planArchiveTestFair(db: Db, slug: string) {
  const ev = await db.event.findUnique({ where: { urlSlug: slug }, select: { id: true, name: true, listing: true, archivedAt: true } })
  if (!ev) throw new TestFairRefused('NOT_FOUND', `No event with slug ${slug}`)
  if (ev.listing !== EventListing.UNLISTED) throw new TestFairRefused('NOT_UNLISTED', `${slug} is ${ev.listing}; only an UNLISTED test fair can be archived here`)
  if (ev.archivedAt) throw new TestFairRefused('ALREADY_ARCHIVED', `${slug} is already archived`)
  const [orders, payouts, refunds] = await Promise.all([
    db.order.count({ where: { eventId: ev.id } }),
    db.payout.count({ where: { eventId: ev.id } }),
    db.refund.count({ where: { order: { eventId: ev.id } } }),
  ])
  return { event: ev, kept: { orders, payouts, refunds } }
}

export async function archiveTestFair(db: Db, slug: string) {
  const plan = await planArchiveTestFair(db, slug)
  // Conditional write: only an UNLISTED, unarchived row can change, whatever happened since the plan.
  const w = await db.event.updateMany({ where: { id: plan.event.id, listing: EventListing.UNLISTED, archivedAt: null }, data: { archivedAt: new Date() } })
  return { ...plan, archived: w.count }
}
