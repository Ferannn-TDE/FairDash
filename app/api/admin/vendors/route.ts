import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'
import { VendorStatus } from '@prisma/client'

// GET /api/admin/vendors?eventId=...&status=PENDING|ACTIVE|...
// Returns the vendor list for an event, optionally filtered by status.
// Requires admin or event_operator role.

export async function GET(req: NextRequest) {
  try {
    await requireAdminAuth()

    const { searchParams } = new URL(req.url)
    const eventId = searchParams.get('eventId')
    const statusParam = searchParams.get('status')

    if (!eventId) throw new ApiError('eventId query param is required', 400, 'VALIDATION_ERROR')

    const status = statusParam && Object.values(VendorStatus).includes(statusParam as VendorStatus)
      ? (statusParam as VendorStatus)
      : undefined

    const vendors = await db.vendor.findMany({
      where: { eventId, ...(status && { status }) },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        cuisineType: true,
        boothNumber: true,
        status: true,
        isOffline: true,
        isBusy: true,
        stripeVerified: true,
        stripeAccountId: true,
        // Admin list: presence is all a list needs. Viewing a document goes through the
        // brokered, audit-logged read (GET /api/organizer/vendors/[id]/documents).
        foodHandlerPermitPath: true,
        insurancePath: true,
        insuranceExpiryDate: true,
        insuranceExpired: true,
        lastHeartbeatAt: true,
        createdAt: true,
      },
    })

    return success({ vendors })
  } catch (err) {
    return handleApiError(err)
  }
}
