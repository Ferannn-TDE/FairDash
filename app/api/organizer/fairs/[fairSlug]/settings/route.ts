import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { resolveOwnedFair } from '@/lib/organizer-fair-context'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { EventStatus } from '@prisma/client'
import { organizerFairScope } from '@/lib/organizer-fair-context'
import { parseStatementNameInput } from '@/lib/statement-descriptor'
import { markupCacheTags, markupStarted, requireMarkupBps, setEventMarkup, type MarkupChange } from '@/lib/event-markup'

// ONLINE PRICE MARKUP (audit H5, step 2h): `onlineMarkupBps` is deliberately NOT in ALLOWED_FIELDS
// or NUMERIC_RANGES. It is a money setting: refused out of range (never clamped), locked for
// organizers once the event has started (409 MARKUP_LOCKED), and written only through
// lib/event-markup.ts, which logs every change in the same transaction as this save.

const ALLOWED_FIELDS = new Set([
  // Operational timing
  'orderAcceptanceWindowSec',
  'vendorOfflineHideSec',
  'maxVendorsPerOrder',
  // Branding / UX
  'welcomeMessage',
  'statementName',
  'showVendorWaitTimes',
  'allowGuestBrowse',
  'primaryColor',
  // Platform
  'isPaused',
  'status',
  // Vendor rules
  'serviceChargeEnabled',
  'serviceChargeAmount',
])

const NUMERIC_RANGES: Record<string, [number, number]> = {
  orderAcceptanceWindowSec: [30, 600],
  vendorOfflineHideSec:     [60, 1800],
  maxVendorsPerOrder:       [1, 10],
  serviceChargeAmount:      [0, 50],
}

const BOOLEAN_FIELDS = new Set([
  'showVendorWaitTimes',
  'allowGuestBrowse',
  'isPaused',
  'serviceChargeEnabled',
])

// Containment gate (until the admin approval workflow lands): an organizer may set
// their fair UPCOMING (prep) or INACTIVE (take offline) themselves, but NOT ACTIVE —
// ACTIVE is what makes a fair publicly discoverable/orderable, so self-publishing is
// disallowed. Going live becomes a deliberate approval step outside organizer self-serve.
const ALLOWED_STATUSES: EventStatus[] = ['UPCOMING', 'INACTIVE']

// GET /api/organizer/fairs/[fairSlug]/settings
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const { organizerId, clerkId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    const event = await db.event.findFirst({
      // Archived fair's settings are not viewable, and neither are a DRAFT's — the fragment
      // carries both exclusions so this relation-heavy read cannot drift from resolveOwnedFair.
      where: { ...organizerFairScope(organizerId), urlSlug: fairSlug },
      include: { fulfillmentConfig: true },
    })
    if (!event) return apiError('Fair not found', 404, 'NOT_FOUND')

    // Determine if caller is org owner (for Danger Zone visibility)
    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    const isOwner = dbUser
      ? !!(await db.orgMember.findFirst({
          where: { organizerId, userId: dbUser.id, role: 'owner' },
          select: { id: true },
        }))
      : false

    // markupLocked: the settings screen shows the markup read-only once the event has started.
    return success({ ...event, isOwner, markupLocked: markupStarted(event) })
  } catch (err) {
    return handleApiError(err)
  }
}

// PATCH /api/organizer/fairs/[fairSlug]/settings
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const { organizerId, clerkId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    const event = await resolveOwnedFair(fairSlug, organizerId)

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return apiError('Send a JSON object of settings', 400, 'VALIDATION_ERROR')
    }

    // Markup first: an invalid value refuses the WHOLE request, before anything is written.
    const hasMarkup = 'onlineMarkupBps' in body
    const markupBps = hasMarkup ? requireMarkupBps(body.onlineMarkupBps) : null

    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body)) {
      if (ALLOWED_FIELDS.has(key)) data[key] = value
    }
    if (Object.keys(data).length === 0 && !hasMarkup) {
      return apiError('No valid fields to update', 400, 'VALIDATION_ERROR')
    }

    // Validate status transitions
    if ('status' in data) {
      if (!ALLOWED_STATUSES.includes(data.status as EventStatus)) {
        return apiError('Invalid status', 400, 'VALIDATION_ERROR')
      }
    }

    // Clamp numeric fields
    for (const [field, [min, max]] of Object.entries(NUMERIC_RANGES)) {
      if (field in data && typeof data[field] === 'number') {
        data[field] = Math.min(Math.max(data[field] as number, min), max)
      }
    }

    // Coerce boolean fields
    for (const field of BOOLEAN_FIELDS) {
      if (field in data) data[field] = Boolean(data[field])
    }

    if ('welcomeMessage' in data && data.welcomeMessage) {
      data.welcomeMessage = String(data.welcomeMessage).slice(0, 120)
    }

    // Card statement name (readiness 1.6): stored already cleaned; no letter left → refused.
    if ('statementName' in data) {
      const parsed = parseStatementNameInput(data.statementName)
      if (!parsed.ok) return apiError(parsed.message, 400, 'VALIDATION_ERROR')
      data.statementName = parsed.value
    }

    // The actor's User id for the markup log (null if the sign-in has no User row).
    const actorUserId = markupBps === null
      ? null
      : (await db.user.findUnique({ where: { clerkId }, select: { id: true } }))?.id ?? null

    // One transaction: the markup change (with its log row and the lock check) and the other
    // settings commit together, or not at all.
    const { updated, markup } = await db.$transaction(async tx => {
      let markup: MarkupChange | null = null
      if (markupBps !== null) {
        markup = await setEventMarkup(tx, {
          eventId: event.id,
          newBps: markupBps,
          actor: { role: 'ORGANIZER', clerkId, userId: actorUserId },
        })
      }
      const updated = Object.keys(data).length > 0
        ? await tx.event.update({ where: { id: event.id }, data, include: { fulfillmentConfig: true } })
        : await tx.event.findUniqueOrThrow({ where: { id: event.id }, include: { fulfillmentConfig: true } })
      return { updated, markup }
    })

    revalidateTag(`organizer-fairs-${organizerId}`, 'default')
    revalidateTag('fair', 'default')
    if (markup?.changed) {
      for (const tag of markupCacheTags(markup.urlSlug)) revalidateTag(tag, 'default')
    }

    return success({ ...updated, markupLocked: markupStarted(updated) })
  } catch (err) {
    return handleApiError(err)
  }
}
