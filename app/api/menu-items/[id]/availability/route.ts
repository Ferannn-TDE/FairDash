import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

import { revalidateTag } from 'next/cache'

// PATCH /api/menu-items/:id/availability — instant sold-out toggle (no approval needed)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAuth()
    const { id } = await params
    const { isAvailable } = await req.json()

    if (typeof isAvailable !== 'boolean') {
      return apiError('isAvailable must be a boolean', 400, 'VALIDATION_ERROR')
    }

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const item = await db.menuItem.findUnique({ where: { id }, select: { vendorId: true } })
    if (!item) return apiError('Menu item not found', 404, 'NOT_FOUND')

    const isMember = await db.vendorMember.findFirst({ where: { vendorId: item.vendorId, userId: dbUser.id } })
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

    const updated = await db.menuItem.update({
      where: { id },
      data: { isAvailable },
    })

    revalidateTag(`vendor-menu-${item.vendorId}`)

    return success({ id: updated.id, isAvailable: updated.isAvailable })
  } catch (err) {
    return handleApiError(err)
  }
}
