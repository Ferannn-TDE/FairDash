import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

const ALLOWED_FIELDS = new Set([
  'orderAcceptanceWindowSec',
  'vendorOfflineHideSec',
  'maxVendorsPerOrder',
  'welcomeMessage',
  'showVendorWaitTimes',
  'allowGuestBrowse',
  'primaryColor',
  'isPaused',
])

const NUMERIC_RANGES: Record<string, [number, number]> = {
  orderAcceptanceWindowSec: [30, 600],
  vendorOfflineHideSec:     [60, 1800],
  maxVendorsPerOrder:       [1, 10],
}

const BOOLEAN_FIELDS = new Set([
  'showVendorWaitTimes',
  'allowGuestBrowse',
  'isPaused',
])

// GET /api/organizer/fairs/[fairSlug]/settings
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const clerkId = await requireAuth()
    const { fairSlug } = await params

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('Forbidden', 403, 'FORBIDDEN')

    const orgMember = await db.orgMember.findFirst({ where: { userId: dbUser.id } })
    if (!orgMember) return apiError('Forbidden', 403, 'FORBIDDEN')

    const event = await db.event.findFirst({
      where: { urlSlug: fairSlug, organizerId: orgMember.organizerId },
      include: { fulfillmentConfig: true },
    })
    if (!event) return apiError('Fair not found', 404, 'NOT_FOUND')

    return success(event)
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
    const clerkId = await requireAuth()
    const { fairSlug } = await params

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('Forbidden', 403, 'FORBIDDEN')

    const orgMember = await db.orgMember.findFirst({ where: { userId: dbUser.id } })
    if (!orgMember) return apiError('Forbidden', 403, 'FORBIDDEN')

    const event = await db.event.findFirst({
      where: { urlSlug: fairSlug, organizerId: orgMember.organizerId },
    })
    if (!event) return apiError('Fair not found', 404, 'NOT_FOUND')

    const body = await req.json() as Record<string, unknown>

    // Whitelist fields to prevent mass-assignment
    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body)) {
      if (ALLOWED_FIELDS.has(key)) data[key] = value
    }

    if (Object.keys(data).length === 0) {
      return apiError('No valid fields to update', 400, 'VALIDATION_ERROR')
    }

    // Clamp numeric fields to safe ranges
    for (const [field, [min, max]] of Object.entries(NUMERIC_RANGES)) {
      if (field in data && typeof data[field] === 'number') {
        data[field] = Math.min(Math.max(data[field] as number, min), max)
      }
    }

    // Coerce boolean fields
    for (const field of BOOLEAN_FIELDS) {
      if (field in data) data[field] = Boolean(data[field])
    }

    // Clamp welcomeMessage to 120 chars
    if ('welcomeMessage' in data && data.welcomeMessage) {
      data.welcomeMessage = String(data.welcomeMessage).slice(0, 120)
    }

    const updated = await db.event.update({
      where: { id: event.id },
      data,
      include: { fulfillmentConfig: true },
    })

    // Bust the organizer fairs sidebar cache so the update is reflected immediately
    revalidateTag(`organizer-fairs-${orgMember.organizerId}`)

    return success(updated)
  } catch (err) {
    return handleApiError(err)
  }
}
