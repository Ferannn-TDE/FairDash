import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

const ALLOWED_FIELDS = new Set([
  'name', 'phone',
  'notifNewOrder', 'notifVendorOffline',
  'notifMenuRequests', 'notifDailySummary',
])

// GET /api/user/preferences
export async function GET() {
  try {
    const clerkId = await requireAuth()
    const user = await db.user.findUnique({
      where: { clerkId },
      select: {
        name: true,
        email: true,
        phone: true,
        notifNewOrder: true,
        notifVendorOffline: true,
        notifMenuRequests: true,
        notifDailySummary: true,
      },
    })
    if (!user) return apiError('User not found', 404, 'NOT_FOUND')
    return success(user)
  } catch (err) {
    return handleApiError(err)
  }
}

// PATCH /api/user/preferences
export async function PATCH(req: NextRequest) {
  try {
    const clerkId = await requireAuth()
    const body = await req.json() as Record<string, unknown>

    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body)) {
      if (ALLOWED_FIELDS.has(key)) data[key] = value
    }

    if (Object.keys(data).length === 0) {
      return apiError('No valid fields to update', 400, 'VALIDATION_ERROR')
    }

    const user = await db.user.update({
      where: { clerkId },
      data,
      select: {
        name: true,
        email: true,
        phone: true,
        notifNewOrder: true,
        notifVendorOffline: true,
        notifMenuRequests: true,
        notifDailySummary: true,
      },
    })
    return success(user)
  } catch (err) {
    return handleApiError(err)
  }
}
