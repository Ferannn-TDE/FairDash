import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireSettingsAdmin } from '@/lib/auth'
import { listSettings, saveSetting, SettingError } from '@/lib/settings'
import { listEventsWithDeliveryOn } from '@/lib/delivery'
import { revalidateTag } from 'next/cache'
import { VIDEOS_CACHE_TAG } from '@/lib/videos'
import { HOMEPAGE_BANNER_CACHE_TAG } from '@/lib/homepage-banner'
import { runAfterResponse } from '@/lib/after-response'

// GET   /api/admin/settings  → every registry setting (value, version, note) + the latest 50 changes
// PATCH /api/admin/settings  { key, value, expectedVersion, reason? } → save or clear ONE setting
//
// Gate: requireSettingsAdmin (admin | super_admin | platform_manager). This is the only API
// platform_manager can reach in item 5; scripts/platform-settings-test.ts proves every other
// /api/admin route refuses it. MONEY keys (fees.*) additionally need admin | super_admin:
// saveSetting refuses platform_manager → 403 (item 10 stage 2, S2-Q1). GET returns viewerRole so
// the page shows the money cards read-only to platform_manager.
export async function GET(_req: NextRequest) {
  try {
    const { actorType } = await requireSettingsAdmin()
    const [data, deliveryEventsOn] = await Promise.all([listSettings(), listEventsWithDeliveryOn()])
    // Shown before delivery.enabled is switched on: these events start offering it immediately.
    return success({ ...data, deliveryEventsOn, viewerRole: actorType })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { clerkId, actorType } = await requireSettingsAdmin()
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw new ApiError('Invalid JSON body', 400, 'VALIDATION_ERROR')

    try {
      const result = await saveSetting({
        key: body.key,
        raw: body.value,
        expectedVersion: body.expectedVersion,
        reason: body.reason,
        actorId: clerkId,
        actorType,
        // A money change posts a Slack notice after the response (Next's after()), never blocking it.
        afterResponse: runAfterResponse,
      })
      // Fair pages cache which fulfillment modes are offered; delivery depends on this switch.
      if (body.key === 'delivery.enabled' && result.outcome !== 'unchanged') revalidateTag('fair', 'default')
      // Pages with a video slot cache the link; refresh them when one changes.
      if (typeof body.key === 'string' && body.key.startsWith('video.') && result.outcome !== 'unchanged') revalidateTag(VIDEOS_CACHE_TAG, 'default')
      // The homepage caches the vendor sign-up banner; refresh it when either banner setting changes.
      if (typeof body.key === 'string' && body.key.startsWith('homepage.') && result.outcome !== 'unchanged') revalidateTag(HOMEPAGE_BANNER_CACHE_TAG, 'default')
      return success(result)
    } catch (err) {
      if (err instanceof SettingError) {
        if (err.kind === 'unknown_key') throw new ApiError(err.message, 400, 'UNKNOWN_SETTING')
        if (err.kind === 'invalid') throw new ApiError(err.message, 400, 'VALIDATION_ERROR', err.details)
        if (err.kind === 'forbidden') throw new ApiError(err.message, 403, 'FORBIDDEN')
        throw new ApiError(err.message, 409, 'SETTING_CONFLICT', err.details)
      }
      throw err
    }
  } catch (err) {
    return handleApiError(err)
  }
}
