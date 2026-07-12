import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'
import { VendorStatus } from '@prisma/client'

// PATCH /api/admin/vendors/[id]/approve
// Sets vendor status to ACTIVE.
// Body: { boothNumber?: string }

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminAuth()

    const vendor = await db.vendor.findUnique({ where: { id: (await params).id } })
    if (!vendor) throw new ApiError('Vendor not found', 404, 'VENDOR_NOT_FOUND')

    if (vendor.status !== VendorStatus.PENDING) {
      throw new ApiError('Only PENDING vendors can be approved', 409, 'INVALID_STATUS')
    }

    let boothNumber: string | undefined
    try {
      const body = await req.json()
      boothNumber = body.boothNumber
    } catch { /* body is optional */ }

    const updated = await db.vendor.update({
      where: { id: (await params).id },
      data: {
        status: VendorStatus.ACTIVE,
        ...(boothNumber && { boothNumber }),
      },
      select: { id: true, name: true, status: true, boothNumber: true },
    })

    // Now ACTIVE → orderable. Bust the cached customer discovery list ('vendors', 120s in
    // lib/fairs.ts) so the approved vendor appears promptly, not after the TTL.
    revalidateTag('vendors', 'default')

    return success({ vendor: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
