import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { EventStatus } from '@prisma/client'

const ALLOWED_FIELDS = new Set([
  // Operational timing
  'orderAcceptanceWindowSec',
  'vendorOfflineHideSec',
  'maxVendorsPerOrder',
  // Branding / UX
  'welcomeMessage',
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

const ALLOWED_STATUSES: EventStatus[] = ['UPCOMING', 'ACTIVE', 'INACTIVE']

// GET /api/organizer/fairs/[fairSlug]/settings
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const { organizerId, clerkId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    const event = await db.event.findFirst({
      where: { urlSlug: fairSlug, organizerId },
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

    return success({ ...event, isOwner })
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
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    const event = await db.event.findFirst({
      where: { urlSlug: fairSlug, organizerId },
      select: { id: true },
    })
    if (!event) return apiError('Fair not found', 404, 'NOT_FOUND')

    const body = await req.json() as Record<string, unknown>

    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body)) {
      if (ALLOWED_FIELDS.has(key)) data[key] = value
    }
    if (Object.keys(data).length === 0) {
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

    const updated = await db.event.update({
      where: { id: event.id },
      data,
      include: { fulfillmentConfig: true },
    })

    revalidateTag(`organizer-fairs-${organizerId}`, 'default')
    revalidateTag('fair', 'default')

    return success(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

// POST /api/organizer/fairs/[fairSlug]/settings — archive disabled for organizers.
// Fair archival is a platform-admin action handled out-of-band (support ticket).
export async function POST() {
  return apiError('Fair archival must be requested via support', 403, 'FORBIDDEN')
}
