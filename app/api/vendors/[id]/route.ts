import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorAuth } from '@/lib/auth'

// GET /api/vendors/:id
// Returns a single vendor with their active menu items.
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const vendor = await db.vendor.findUnique({
      where: { id: params.id },
      include: {
        menuItems: {
          where: { isAvailable: true },
          orderBy: { category: 'asc' },
        },
      },
    })

    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')
    if (vendor.isOffline) return apiError('Vendor is currently offline', 503, 'VENDOR_OFFLINE')

    return success(vendor)
  } catch (err) {
    return handleApiError(err)
  }
}

// PATCH /api/vendors/:id
// Allows a vendor to update their status (isBusy, isOffline).
// Vendor auth required.
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireVendorAuth()
    const body = await req.json()
    const { isBusy, isOffline, boothNumber, description } = body

    const vendor = await db.vendor.update({
      where: { id: params.id },
      data: {
        ...(isBusy !== undefined && {
          isBusy: Boolean(isBusy),
          busyUntil: isBusy ? new Date(Date.now() + 15 * 60 * 1000) : null,
        }),
        ...(isOffline !== undefined && { isOffline: Boolean(isOffline) }),
        ...(boothNumber !== undefined && { boothNumber }),
        ...(description !== undefined && { description }),
      },
    })

    return success(vendor)
  } catch (err) {
    return handleApiError(err)
  }
}
