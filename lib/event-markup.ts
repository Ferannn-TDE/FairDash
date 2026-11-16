// EVENT ONLINE MARKUP — the one writer of Event.onlineMarkupBps (audit H5, step 2h).
//
// Decisions (Jordan, Nov 15):
//   - Per event, basis points 0–1000 (0%–10%); the cap is a code constant (lib/menu/price.ts).
//   - Set by that event's organizer or a strict FairSynq admin (the routes do the access checks).
//   - Organizers only before the event starts. Started = status ACTIVE, or now ≥ startDate. After
//     that an organizer CHANGE is refused with 409 MARKUP_LOCKED; strict admins can still change it.
//     Sending the value it already has is not a change, so a settings form that re-sends every
//     field still saves its other settings after the event starts.
//   - Every change is logged (EventMarkupChange: who, old, new, when) in the SAME transaction as the
//     change. No row when the value is unchanged.
//   - A change clears the cached menus and fair data: vendor-menu, fair and event-menu-{slug}.
//
// Callers pass their own transaction so a settings save and its markup change commit or fail together.

import { Prisma, EventStatus } from '@prisma/client'
import { ApiError } from './api-error'
import { parseMarkupBps, MARKUP_LOCKED_MESSAGE } from './menu/price'

// The locked sentence lives in lib/menu/price.ts (import-free) so the organizer settings screen
// shows exactly what this 409 says. Re-exported for existing importers.
export { MARKUP_LOCKED_MESSAGE }

export type MarkupActor = {
  role: 'ORGANIZER' | 'ADMIN'
  clerkId: string
  userId: string | null
}

/** True once the event has started: status ACTIVE, or now at or after its start date. */
export function markupStarted(event: { status: EventStatus | string; startDate: Date }, now: Date = new Date()): boolean {
  return event.status === EventStatus.ACTIVE || now.getTime() >= event.startDate.getTime()
}

/** The cache tags a markup change must clear (menus show the online price; the fair payload carries the markup). */
export function markupCacheTags(urlSlug: string): string[] {
  return ['vendor-menu', 'fair', `event-menu-${urlSlug}`]
}

/** Parse the request value, or throw 400. Refused, never clamped. */
export function requireMarkupBps(input: unknown): number {
  const parsed = parseMarkupBps(input)
  if (!parsed.ok) throw new ApiError(parsed.message, 400, 'VALIDATION_ERROR')
  return parsed.bps
}

export type MarkupChange = { changed: boolean; oldBps: number; newBps: number; urlSlug: string }

/**
 * Set an event's markup inside the caller's transaction.
 *
 * Locks the event row first (SELECT … FOR UPDATE) so two simultaneous changes are applied one after
 * the other and each log row records the value it really replaced. Throws 404 if the event is gone,
 * 409 MARKUP_LOCKED for an organizer changing a started event.
 */
export async function setEventMarkup(
  tx: Prisma.TransactionClient,
  input: { eventId: string; newBps: number; actor: MarkupActor; now?: Date },
): Promise<MarkupChange> {
  const newBps = requireMarkupBps(input.newBps)

  const rows = await tx.$queryRaw<Array<{ onlineMarkupBps: number; status: string; startDate: Date; urlSlug: string }>>`
    SELECT "onlineMarkupBps", "status"::text AS "status", "startDate", "urlSlug"
    FROM "Event" WHERE "id" = ${input.eventId} FOR UPDATE`
  const current = rows[0]
  if (!current) throw new ApiError('Event not found', 404, 'NOT_FOUND')

  const oldBps = current.onlineMarkupBps
  if (oldBps === newBps) return { changed: false, oldBps, newBps, urlSlug: current.urlSlug }

  if (input.actor.role === 'ORGANIZER' && markupStarted(current, input.now)) {
    throw new ApiError(MARKUP_LOCKED_MESSAGE, 409, 'MARKUP_LOCKED')
  }

  await tx.event.update({ where: { id: input.eventId }, data: { onlineMarkupBps: newBps } })
  await tx.eventMarkupChange.create({
    data: {
      eventId: input.eventId,
      actorRole: input.actor.role,
      actorClerkId: input.actor.clerkId,
      actorUserId: input.actor.userId,
      oldBps,
      newBps,
    },
  })
  return { changed: true, oldBps, newBps, urlSlug: current.urlSlug }
}
