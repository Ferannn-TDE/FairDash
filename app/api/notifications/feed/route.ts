// BELL FEED: the signed-in person's own bell notifications (audit H5, step 3c).
// lib/menu-notify/digest.ts writes the rows (InAppNotification); the bell in the admin and
// organizer portals (app/_components/NotificationBell.tsx) reads and marks them here.
//
// WHO: anyone signed in with a FairSynq account. Every read and write is limited to the caller's
//   own rows (userId from the sign-in, never from the request), so no role check is needed and the
//   same feed can later serve vendor and runner bells. Signed out 401; no User row 404.
// WHAT: GET lists newest first with the unread count; PATCH marks rows read. The stored payload is
//   not sent to the browser. PATCH accepts only application/json (400 otherwise).

import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'

// Not exported: a Next.js route file may export only its handlers.
const FEED_DEFAULT_LIMIT = 20
const FEED_MAX_LIMIT = 50
const MARK_READ_MAX_IDS = 100

/** The caller's User id, or a refusal. */
async function requireFeedUser(): Promise<string> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')
  const user = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
  if (!user) throw new ApiError('No FairSynq account record for this sign-in', 404, 'USER_NOT_FOUND')
  return user.id
}

function unreadCountOf(userId: string) {
  return db.inAppNotification.count({ where: { userId, readAt: null } })
}

// GET /api/notifications/feed?limit=20&before=<id>
export async function GET(req: NextRequest) {
  try {
    const userId = await requireFeedUser()
    const params = req.nextUrl.searchParams

    let limit = FEED_DEFAULT_LIMIT
    const rawLimit = params.get('limit')
    if (rawLimit !== null) {
      if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) {
        return apiError('limit must be a whole number from 1', 400, 'VALIDATION_ERROR')
      }
      limit = Math.min(Number(rawLimit), FEED_MAX_LIMIT)
    }

    // Paging: rows older than the `before` row (same time: smaller id). It must be the caller's own.
    let olderThan: { createdAt: Date; id: string } | null = null
    const before = params.get('before')
    if (before !== null) {
      const anchor = await db.inAppNotification.findFirst({
        where: { id: before, userId },
        select: { createdAt: true, id: true },
      })
      if (!anchor) return apiError('Unknown notification for before', 400, 'VALIDATION_ERROR')
      olderThan = anchor
    }

    const rows = await db.inAppNotification.findMany({
      where: {
        userId,
        ...(olderThan && {
          OR: [
            { createdAt: { lt: olderThan.createdAt } },
            { createdAt: olderThan.createdAt, id: { lt: olderThan.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
    })
    const items = rows.slice(0, limit)
    const nextBefore = rows.length > limit ? items[items.length - 1].id : null

    return success({ items, unreadCount: await unreadCountOf(userId), nextBefore })
  } catch (err) {
    return handleApiError(err)
  }
}

// PATCH /api/notifications/feed  { ids: string[] } | { all: true }: mark the caller's rows read.
export async function PATCH(req: NextRequest) {
  try {
    const userId = await requireFeedUser()

    const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (contentType !== 'application/json') {
      return apiError('Send Content-Type: application/json', 400, 'VALIDATION_ERROR')
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiError('Send a JSON body: { ids } or { all: true }', 400, 'VALIDATION_ERROR')
    }
    const { ids, all } = (body ?? {}) as { ids?: unknown; all?: unknown }

    const now = new Date()
    if (all === true && ids === undefined) {
      await db.inAppNotification.updateMany({ where: { userId, readAt: null }, data: { readAt: now } })
    } else if (
      all === undefined &&
      Array.isArray(ids) &&
      ids.length >= 1 &&
      ids.length <= MARK_READ_MAX_IDS &&
      ids.every(id => typeof id === 'string' && id.length > 0)
    ) {
      // Other people's ids match nothing (userId filter); rows already read keep their first readAt.
      await db.inAppNotification.updateMany({
        where: { userId, readAt: null, id: { in: ids as string[] } },
        data: { readAt: now },
      })
    } else {
      return apiError(`Send { ids: [1 to ${MARK_READ_MAX_IDS} ids] } or { all: true }`, 400, 'VALIDATION_ERROR')
    }

    return success({ unreadCount: await unreadCountOf(userId) })
  } catch (err) {
    return handleApiError(err)
  }
}
