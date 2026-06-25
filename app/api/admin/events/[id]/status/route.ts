import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'
import { EventStatus, VendorStatus } from '@prisma/client'

// PATCH /api/admin/events/[id]/status
// Transitions event status: UPCOMING→ACTIVE (Go Live) or ACTIVE→INACTIVE (Close).
//
// Go Live checklist (UPCOMING→ACTIVE):
//   1. At least 1 vendor with status = ACTIVE
//   2. At least 1 vendor with stripeVerified = true and status = ACTIVE
//   3. FulfillmentConfig exists with at least one mode enabled
//   4. Event has eventLat and eventLng set
//
// Body: { status: 'ACTIVE' | 'INACTIVE' }

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminAuth()

    const { status: targetStatus }: { status: EventStatus } = await req.json()

    if (!['ACTIVE', 'INACTIVE'].includes(targetStatus)) {
      throw new ApiError('status must be ACTIVE or INACTIVE', 400, 'VALIDATION_ERROR')
    }

    const event = await db.event.findUnique({
      where: { id: (await params).id },
      include: {
        vendors: { where: { status: VendorStatus.ACTIVE } },
        fulfillmentConfig: true,
      },
    })

    if (!event) throw new ApiError('Event not found', 404, 'EVENT_NOT_FOUND')

    // ── Go Live checklist ──────────────────────────────────────────────────────
    if (targetStatus === EventStatus.ACTIVE && event.status === EventStatus.UPCOMING) {
      const checklist = {
        hasActiveVendor: event.vendors.length > 0,
        hasStripeVendor: event.vendors.some(v => v.stripeVerified),
        hasFulfillmentMode: event.fulfillmentConfig
          ? event.fulfillmentConfig.boothPickupEnabled ||
            event.fulfillmentConfig.curbsideEnabled ||
            event.fulfillmentConfig.homeDeliveryEnabled
          : false,
        hasCoords: event.eventLat !== null && event.eventLng !== null,
      }

      const failing = Object.entries(checklist)
        .filter(([, pass]) => !pass)
        .map(([k]) => k)

      if (failing.length > 0) {
        throw new ApiError(
          `Go Live checklist failed: ${failing.join(', ')}`,
          409,
          'GO_LIVE_CHECKLIST_FAILED'
        )
      }
    }

    const updated = await db.event.update({
      where: { id: (await params).id },
      data: { status: targetStatus },
      select: { id: true, name: true, status: true, isPaused: true },
    })

    // Event close (→ INACTIVE) triggers the per-event organizer batch payout: all
    // refund windows have closed by now, so the accrued organizer share is paid as
    // one batch (Part B B3). Idempotent + reconciler-backstopped; never blocks the
    // close response.
    if (targetStatus === EventStatus.INACTIVE) {
      try {
        const { enqueueOrganizerPayout } = await import('@/lib/order-side-effects')
        await enqueueOrganizerPayout({ eventId: updated.id })
      } catch (err) {
        const { logger } = await import('@/lib/logger')
        logger.error('[EventClose] organizer payout enqueue failed (reconciler Pattern Q backstops)', { eventId: updated.id, error: String(err) })
      }
    }

    return success({ event: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
