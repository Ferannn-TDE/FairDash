import { NextRequest } from 'next/server'
import { OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { resolveOrder } from '@/lib/resolve-order'

// GET /api/orders/:id/runner-location — THE PRIVACY BOUNDARY.
//
// Returns the live coordinates of the runner assigned to THIS order, and only to
// the CUSTOMER who owns this order. A different signed-in customer requesting this
// order id gets 404 (existence-hiding, mirroring the customer scoping in
// app/api/orders/[id]/route.ts). Vendors are intentionally NOT granted the read
// here — runner GPS is customer-facing tracking only.
//
// Returns one of:
//   { runnerAssigned:false }                              — no runner claimed yet
//   { runnerAssigned:true, enRoute:false }                — claimed but not RUNNER_COLLECTED
//   { runnerAssigned:true, enRoute:true, hasLocation:false } — en route, no fix yet
//   { runnerAssigned:true, enRoute:true, hasLocation:true, lat, lng, accuracy, updatedAt }
// updatedAt is ALWAYS present when a coord is — never a coordinate without a timestamp.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAuth()

    const rawId = (await params).id
    const order = await resolveOrder(rawId, {
      select: {
        id: true,
        customerId: true,
        status: true,
        runnerId: true,
      },
    })

    if (!order) return apiError('Order not found', 404, 'ORDER_NOT_FOUND')

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    // BOUNDARY: only the owning customer. Anyone else → 404 (don't confirm existence).
    if (order.customerId !== dbUser.id) {
      return apiError('Order not found', 404, 'ORDER_NOT_FOUND')
    }

    if (!order.runnerId) {
      return success({ runnerAssigned: false })
    }

    // Live sharing only happens while the order is RUNNER_COLLECTED (see the write route).
    const enRoute = order.status === OrderStatus.RUNNER_COLLECTED
    if (!enRoute) {
      return success({ runnerAssigned: true, enRoute: false })
    }

    // Order has no `runner` relation field — resolve the assigned runner's live coords.
    const runner = await db.runner.findUnique({
      where: { id: order.runnerId },
      select: { currentLat: true, currentLng: true, currentAccuracy: true, locationUpdatedAt: true },
    })
    const currentLat = runner?.currentLat ?? null
    const currentLng = runner?.currentLng ?? null
    const currentAccuracy = runner?.currentAccuracy ?? null
    const locationUpdatedAt = runner?.locationUpdatedAt ?? null
    if (currentLat == null || currentLng == null || locationUpdatedAt == null) {
      return success({ runnerAssigned: true, enRoute: true, hasLocation: false })
    }

    return success({
      runnerAssigned: true,
      enRoute: true,
      hasLocation: true,
      lat: currentLat,
      lng: currentLng,
      accuracy: currentAccuracy,
      updatedAt: locationUpdatedAt.toISOString(),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
