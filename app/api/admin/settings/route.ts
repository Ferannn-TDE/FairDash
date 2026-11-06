import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireSettingsAdmin } from '@/lib/auth'
import { listSettings, saveSetting, SettingError } from '@/lib/settings'
import { listEventsWithDeliveryOn } from '@/lib/delivery'
import { revalidateTag } from 'next/cache'

// GET   /api/admin/settings  → every registry setting (value, version, note) + the latest 50 changes
// PATCH /api/admin/settings  { key, value, expectedVersion, reason? } → save or clear ONE setting
//
// Gate: requireSettingsAdmin (admin | super_admin | platform_manager). This is the only API
// platform_manager can reach in item 5; scripts/platform-settings-test.ts proves every other
// /api/admin route refuses it.
export async function GET(_req: NextRequest) {
  try {
    await requireSettingsAdmin()
    const [data, deliveryEventsOn] = await Promise.all([listSettings(), listEventsWithDeliveryOn()])
    // Shown before delivery.enabled is switched on: these events start offering it immediately.
    return success({ ...data, deliveryEventsOn })
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
      })
      // Fair pages cache which fulfillment modes are offered; delivery depends on this switch.
      if (body.key === 'delivery.enabled' && result.outcome !== 'unchanged') revalidateTag('fair', 'default')
      return success(result)
    } catch (err) {
      if (err instanceof SettingError) {
        if (err.kind === 'unknown_key') throw new ApiError(err.message, 400, 'UNKNOWN_SETTING')
        if (err.kind === 'invalid') throw new ApiError(err.message, 400, 'VALIDATION_ERROR', err.details)
        throw new ApiError(err.message, 409, 'SETTING_CONFLICT', err.details)
      }
      throw err
    }
  } catch (err) {
    return handleApiError(err)
  }
}
