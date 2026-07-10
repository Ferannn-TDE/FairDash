import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { revalidateTag } from 'next/cache'
import { getGoLiveChecklist, GO_LIVE_KEYS } from '@/lib/go-live-checklist'
import { EventStatus } from '@prisma/client'

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
    const { id } = await params
    const { event } = await requireAdminFairContext(id)

    const { status: targetStatus }: { status: EventStatus } = await req.json()

    if (!['ACTIVE', 'INACTIVE'].includes(targetStatus)) {
      throw new ApiError('status must be ACTIVE or INACTIVE', 400, 'VALIDATION_ERROR')
    }

    // ── Go Live checklist ──────────────────────────────────────────────────────
    // Same shared core the dashboard DISPLAYS — the gate and the UI can't drift.
    if (targetStatus === EventStatus.ACTIVE && event.status === EventStatus.UPCOMING) {
      const checklist = await getGoLiveChecklist(event.id, { eventLat: event.eventLat, eventLng: event.eventLng })
      if (!checklist.canGoLive) {
        const failing = GO_LIVE_KEYS.filter(k => !checklist[k])
        throw new ApiError(
          `Go Live checklist failed: ${failing.join(', ')}`,
          409,
          'GO_LIVE_CHECKLIST_FAILED'
        )
      }
    }

    const updated = await db.event.update({
      where: { id: event.id },
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

    // Status flip is a public-facing change (to/from ACTIVE ⇒ discovery visibility)
    // AND changes the organizer's fair-list card. organizerId comes from the already-
    // resolved event, so no extra query and the response shape is untouched.
    revalidateTag('fair', 'default')
    revalidateTag(`organizer-fairs-${event.organizerId}`, 'default')

    return success({ event: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
