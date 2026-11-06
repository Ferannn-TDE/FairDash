// Event listing (Batch 1 item 5b) — where an event may appear, and THE two scope fragments.
//
// Both fragments are spread INTO a query's existing where, alongside its status/archived
// filters. They never replace them: an UPCOMING PUBLIC fair still 404s and still refuses orders,
// exactly as before. scripts/event-listing-test.ts proves both halves.
//
//   publicFairScope()         listing = PUBLIC        lists, /api/fairs, sitemap, SEO / JSON-LD
//   customerReachableScope()  listing ≠ SIGNUP_ONLY   the fair page, its vendors and menu, ordering
//
// SIGNUP_ONLY is the vendor sign-up holding event: joinable, never listed, never reachable by a
// customer, never orderable, never live. UNLISTED is the B1.17 test fair: reachable and orderable
// by direct URL when ACTIVE, but never listed, never in the sitemap, never indexed.
//
// `listing` is written ONLY by scripts/create-signup-event.ts. No route or UI sets it; the test
// fails if one ever does.

import { EventListing, EventStatus, type Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export function publicFairScope() {
  return { listing: EventListing.PUBLIC } satisfies Prisma.EventWhereInput
}

export function customerReachableScope() {
  return { listing: { not: EventListing.SIGNUP_ONLY } } satisfies Prisma.EventWhereInput
}

/** Indexable by search engines and eligible for JSON-LD: PUBLIC only. */
export function isIndexableListing(listing: EventListing): boolean {
  return listing === EventListing.PUBLIC
}

// ── The sign-up holding event ──────────────────────────────────────────────────────────────
/** The where for "a live sign-up event": SIGNUP_ONLY, not archived, not a draft. UNLISTED and
 *  PUBLIC events can never match, so the test fair can't break the exactly-one rule. */
export const LIVE_SIGNUP_EVENT_WHERE = {
  listing: EventListing.SIGNUP_ONLY,
  archivedAt: null,
  status: { not: EventStatus.DRAFT },
} satisfies Prisma.EventWhereInput

export type SignupEventResult =
  | { kind: 'none' }
  | { kind: 'one'; event: { name: string; slug: string } }
  | { kind: 'many'; count: number }

/** Exactly one → that event. None → the wizard falls back to its fair picker. Two or more →
 *  'many', and the caller refuses rather than guessing which event a vendor joins. */
export async function findSignupEvent(): Promise<SignupEventResult> {
  const events = await db.event.findMany({
    where: LIVE_SIGNUP_EVENT_WHERE,
    select: { name: true, urlSlug: true },
    take: 2,
  })
  if (events.length === 0) return { kind: 'none' }
  if (events.length > 1) return { kind: 'many', count: await db.event.count({ where: LIVE_SIGNUP_EVENT_WHERE }) }
  return { kind: 'one', event: { name: events[0].name, slug: events[0].urlSlug } }
}

