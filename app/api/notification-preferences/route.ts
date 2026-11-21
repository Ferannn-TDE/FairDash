// MENU-ALERT PREFERENCES — each organizer member and each strict admin picks their own channel per
// alert type (audit H5, step 3b). lib/menu-notify/digest.ts reads what is saved here.
//
// WHO: a strict admin (admin | super_admin, read fresh), otherwise an approved, not-suspended
//   organizer member (requireOrganizerAuth: 401 signed out, 403 for everyone else, with its own
//   codes for a pending or suspended organizer). event_operator and platform_manager get no menu
//   alerts, so they are refused too. Every read and write is the caller's own row.
// WHAT: the allowed channels per type come from lib/menu-notify/constants.ts, the one list the
//   worker and the settings screen also read. NONE is allowed for deletes only (Jordan, Nov 15).

import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { hasStrictAdminAuth, requireOrganizerAuth } from '@/lib/auth'
import {
  ALLOWED_CHANNELS,
  MENU_ALERT_TYPES,
  effectiveChannel,
  isAllowedChannel,
  isMenuAlertType,
  type MenuAlertType,
} from '@/lib/menu-notify/constants'

const LABEL: Record<MenuAlertType, string> = {
  MENU_ITEMS_DELETED:        'Menu items deleted',
  MENU_PRICE_CHANGE_PENDING: 'Price increases awaiting approval',
}

/** The caller's User id, or a refusal. Strict admins first; everyone else must be an organizer. */
async function requirePreferenceUser(): Promise<string> {
  if (!(await hasStrictAdminAuth())) await requireOrganizerAuth()
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')
  const user = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
  if (!user) throw new ApiError('No FairSynq account record for this sign-in', 404, 'USER_NOT_FOUND')
  return user.id
}

async function preferencesOf(userId: string) {
  const saved = await db.notificationPreference.findMany({
    where: { userId, eventType: { in: [...MENU_ALERT_TYPES] } },
    select: { eventType: true, channel: true },
  })
  const byType = new Map(saved.map(s => [s.eventType, s.channel]))
  return {
    preferences: MENU_ALERT_TYPES.map(eventType => ({
      eventType,
      label: LABEL[eventType],
      channel: effectiveChannel(eventType, byType.get(eventType)),
      allowed: [...ALLOWED_CHANNELS[eventType]],
      saved: isAllowedChannel(eventType, byType.get(eventType)),
    })),
  }
}

// GET /api/notification-preferences: the caller's settings, defaults filled in.
export async function GET() {
  try {
    const userId = await requirePreferenceUser()
    return success(await preferencesOf(userId))
  } catch (err) {
    return handleApiError(err)
  }
}

// PUT /api/notification-preferences  { eventType, channel }: save one setting.
export async function PUT(req: NextRequest) {
  try {
    const userId = await requirePreferenceUser()

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiError('Send a JSON body: { eventType, channel }', 400, 'VALIDATION_ERROR')
    }
    const { eventType, channel } = (body ?? {}) as { eventType?: unknown; channel?: unknown }

    if (!isMenuAlertType(eventType)) {
      return apiError('Unknown alert type', 400, 'VALIDATION_ERROR')
    }
    if (!isAllowedChannel(eventType, channel)) {
      const message = eventType === 'MENU_PRICE_CHANGE_PENDING' && channel === 'NONE'
        ? "Price increases waiting for your approval can't be switched off"
        : `Choose one of: ${ALLOWED_CHANNELS[eventType].join(', ')}`
      return apiError(message, 400, 'CHANNEL_NOT_ALLOWED')
    }

    await db.notificationPreference.upsert({
      where: { userId_eventType: { userId, eventType } },
      create: { userId, eventType, channel },
      update: { channel },
    })
    return success(await preferencesOf(userId))
  } catch (err) {
    return handleApiError(err)
  }
}
