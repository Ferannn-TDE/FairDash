import { NextRequest } from 'next/server'
import { OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// POST /api/runners/me/location — the runner's browser reports its live GPS fix.
//
// AUTHORIZATION (not just authentication): a runner may only write location while
// they actually own an ACTIVE delivery. The single qualifying order state is
// RUNNER_COLLECTED (allowed transitions are READY → RUNNER_COLLECTED → DELIVERED;
// a claimed-but-not-yet-delivered order sits in RUNNER_COLLECTED and Order.runnerId
// links the claiming runner). A runner with no such order gets 409 and no write
// happens — so a null customer read means "not sharing", never "GPS silently lost".
//
// Body: { lat, lng, accuracy?, timestamp? }

export async function POST(req: NextRequest) {
  try {
    const clerkId = await requireAuth()
    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    const runner = await db.runner.findUnique({ where: { userId: dbUser.id }, select: { id: true } })
    if (!runner) return apiError('No runner record found', 404, 'RUNNER_NOT_FOUND')

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return apiError('Malformed body', 400, 'VALIDATION_ERROR')
    }

    const { lat, lng, accuracy } = body as { lat?: unknown; lng?: unknown; accuracy?: unknown }

    // Coordinate validation — finite numbers inside the real WGS84 range.
    if (
      typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180
    ) {
      return apiError('Invalid coordinates (lat -90..90, lng -180..180)', 400, 'VALIDATION_ERROR')
    }

    const accuracyVal =
      typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0
        ? accuracy
        : null

    // AUTHORIZATION gate: this runner must own an order currently RUNNER_COLLECTED.
    const activeOrder = await db.order.findFirst({
      where: { runnerId: runner.id, status: OrderStatus.RUNNER_COLLECTED },
      select: { id: true },
    })
    if (!activeOrder) {
      return apiError('No active delivery — location sharing is off', 409, 'NO_ACTIVE_DELIVERY')
    }

    await db.runner.update({
      where: { id: runner.id },
      data: {
        currentLat: lat,
        currentLng: lng,
        currentAccuracy: accuracyVal,
        locationUpdatedAt: new Date(),
      },
    })

    return success({ ok: true, updatedAt: new Date().toISOString() })
  } catch (err) {
    return handleApiError(err)
  }
}
