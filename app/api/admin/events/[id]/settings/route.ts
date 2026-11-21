import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { buildSafeSettingsUpdate, hasSafeSettingsField } from '@/lib/admin-event-settings'
import { logger } from '@/lib/logger'
import { markupCacheTags, requireMarkupBps, setEventMarkup, type MarkupChange } from '@/lib/event-markup'

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
//
// ONLINE PRICE MARKUP (audit H5, step 2h): `onlineMarkupBps` is handled apart from the allowlist,
// through lib/event-markup.ts: refused out of range (never clamped), logged in the same transaction
// as this save, and NOT locked for strict admins once the event has started (organizers are).

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
      onlineMarkupBps: event.onlineMarkupBps,
    })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { event, adminClerkId } = await requireAdminFairContext(id)
    const raw = await req.json().catch(() => ({}))
    const body = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>

    // Markup first: an invalid value refuses the WHOLE request, before anything is written.
    const markupBps = body.onlineMarkupBps !== undefined ? requireMarkupBps(body.onlineMarkupBps) : null

    // The allowlist lives in lib/admin-event-settings (buildSafeSettingsUpdate) so the
    // "a malicious body cannot write status/isPaused/…" property is proven directly. A body that
    // carries only the markup skips it (it would refuse "no editable fields").
    const data = markupBps !== null && !hasSafeSettingsField(body)
      ? {}
      : buildSafeSettingsUpdate(body, { startDate: event.startDate, endDate: event.endDate })

    const actorUserId = markupBps === null
      ? null
      : (await db.user.findUnique({ where: { clerkId: adminClerkId }, select: { id: true } }))?.id ?? null

    // One transaction: the markup change (with its log row) and the other settings commit together.
    const markup = await db.$transaction(async tx => {
      let markup: MarkupChange | null = null
      if (markupBps !== null) {
        markup = await setEventMarkup(tx, {
          eventId: event.id,
          newBps: markupBps,
          actor: { role: 'ADMIN', clerkId: adminClerkId, userId: actorUserId },
        })
      }
      if (Object.keys(data).length > 0) await tx.event.update({ where: { id: event.id }, data })
      return markup
    })

    // name / dates / location appear on the customer discovery card, cached under the 'fair'
    // tag (lib/fairs.ts). Bust it so an edit shows promptly, not after the 300s TTL.
    revalidateTag('fair', 'default')
    if (markup?.changed) {
      for (const tag of markupCacheTags(markup.urlSlug)) revalidateTag(tag, 'default')
    }

    logger.info('[AdminSettings] fair settings updated', {
      admin: adminClerkId, eventId: event.id, fields: Object.keys(data),
      ...(markup && { markup: { changed: markup.changed, oldBps: markup.oldBps, newBps: markup.newBps } }),
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
      onlineMarkupBps: fresh.onlineMarkupBps,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
