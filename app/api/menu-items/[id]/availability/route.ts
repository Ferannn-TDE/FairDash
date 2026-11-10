import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorMenuItemAccess, requireVendorMayEditMenu } from '@/lib/auth'

import { revalidateTag } from 'next/cache'

// PATCH /api/menu-items/:id/availability — instant sold-out toggle (no approval needed)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { userId, item } = await requireVendorMenuItemAccess(id, req)
    await requireVendorMayEditMenu(userId, item.vendorId)

    const { isAvailable } = await req.json()

    if (typeof isAvailable !== 'boolean') {
      return apiError('isAvailable must be a boolean', 400, 'VALIDATION_ERROR')
    }

    const updated = await db.menuItem.update({
      where: { id },
      data: { isAvailable },
    })

    revalidateTag(`vendor-menu-${item.vendorId}`, 'default')

    return success({ id: updated.id, isAvailable: updated.isAvailable })
  } catch (err) {
    return handleApiError(err)
  }
}
