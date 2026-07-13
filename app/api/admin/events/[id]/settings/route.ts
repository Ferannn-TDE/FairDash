import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { buildSafeSettingsUpdate } from '@/lib/admin-event-settings'
import { logger } from '@/lib/logger'

// GET  /api/admin/events/[id]/settings — the fair's editable settings (real values)
// PATCH same — persist them
//
// Both ride requireAdminFairContext (the proven chokepoint) — the SAME gate as the money
// panel. The GET resolves the Event through the chokepoint (no second unscoped resolve, so
// the grep invariant holds); the PATCH uses db.event.update (allowed — the invariant governs
// unscoped RESOLVES, not updates; pause/status/featured already update this way).
//
// SAFE-FIELD ALLOWLIST — the load-bearing rule. This route persists ONLY presentation and
// logistics fields. It must NEVER write status, isPaused, archivedAt, organizerId, or
// urlSlug: those are identity/ownership or have their own gated routes (pause, status), and
// a general settings PATCH that could set them would be a boundary hole. The data object is
// built by explicitly PICKING known-safe fields — the request body is never spread, so an
// extra field in the payload is silently ignored, not written.

const toDateStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '')

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { event } = await requireAdminFairContext(id)
    return success({
      slug: event.urlSlug,
      name: event.name,
      startDate: toDateStr(event.startDate),
      endDate: toDateStr(event.endDate),
      eventLat: event.eventLat,
      eventLng: event.eventLng,
      serviceChargeEnabled: event.serviceChargeEnabled,
      serviceChargeAmount: event.serviceChargeAmount,
    })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { event, adminClerkId } = await requireAdminFairContext(id)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    // The allowlist lives in lib/admin-event-settings (buildSafeSettingsUpdate) so the
    // "a malicious body cannot write status/isPaused/…" property is proven directly.
    const data = buildSafeSettingsUpdate(body, { startDate: event.startDate, endDate: event.endDate })

    await db.event.update({ where: { id: event.id }, data })

    // name / dates / location appear on the customer discovery card, cached under the 'fair'
    // tag (lib/fairs.ts). Bust it so an edit shows promptly, not after the 300s TTL.
    revalidateTag('fair', 'default')

    logger.info('[AdminSettings] fair settings updated', {
      admin: adminClerkId, eventId: event.id, fields: Object.keys(data),
    })

    // Return the RE-READ values (from the same chokepoint) so the client can trust the
    // response as the new truth, not echo back what it optimistically sent.
    const { event: fresh } = await requireAdminFairContext(id)
    return success({
      slug: fresh.urlSlug,
      name: fresh.name,
      startDate: toDateStr(fresh.startDate),
      endDate: toDateStr(fresh.endDate),
      eventLat: fresh.eventLat,
      eventLng: fresh.eventLng,
      serviceChargeEnabled: fresh.serviceChargeEnabled,
      serviceChargeAmount: fresh.serviceChargeAmount,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
