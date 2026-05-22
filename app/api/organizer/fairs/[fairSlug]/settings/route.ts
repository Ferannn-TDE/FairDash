import { NextRequest } from 'next/server'
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

// GET /api/organizer/fairs/[fairSlug]/settings
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const clerkId = await requireAuth()
    const { fairSlug } = await params

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const orgMember = await db.orgMember.findFirst({ where: { userId: dbUser.id } })
    if (!orgMember) return apiError('Not an organizer', 403, 'FORBIDDEN')

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
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const orgMember = await db.orgMember.findFirst({ where: { userId: dbUser.id } })
    if (!orgMember) return apiError('Not an organizer', 403, 'FORBIDDEN')

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

    const updated = await db.event.update({
      where: { id: event.id },
      data,
      include: { fulfillmentConfig: true },
    })

    return success(updated)
  } catch (err) {
    return handleApiError(err)
  }
}
