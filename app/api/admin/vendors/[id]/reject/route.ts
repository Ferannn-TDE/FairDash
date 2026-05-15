import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'
import { VendorStatus } from '@prisma/client'

// PATCH /api/admin/vendors/[id]/reject
// Sets vendor status to REJECTED.
// Body: { reason: string }

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminAuth()

    const vendor = await db.vendor.findUnique({ where: { id: (await params).id } })
    if (!vendor) throw new ApiError('Vendor not found', 404, 'VENDOR_NOT_FOUND')

    if (vendor.status !== VendorStatus.PENDING) {
      throw new ApiError('Only PENDING vendors can be rejected', 409, 'INVALID_STATUS')
    }

    let reason: string | undefined
    try {
      const body = await req.json()
      reason = body.reason
    } catch { /* body optional */ }

    if (!reason?.trim()) {
      throw new ApiError('A rejection reason is required', 400, 'VALIDATION_ERROR')
    }

    const updated = await db.vendor.update({
      where: { id: (await params).id },
      data: { status: VendorStatus.REJECTED },
      select: { id: true, name: true, status: true },
    })

    // TODO: send rejection email/notification to vendor with reason
    // await sendVendorRejectionEmail(vendor, reason)

    return success({ vendor: updated, reason })
  } catch (err) {
    return handleApiError(err)
  }
}
