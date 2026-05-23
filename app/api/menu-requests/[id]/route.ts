import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

import { revalidateTag } from 'next/cache'

// PATCH /api/menu-requests/:id — organizer approves or rejects a request
// On APPROVED: applies the change to MenuItem table
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAuth()
    const { id } = await params
    const { status, reviewNote } = await req.json()

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return apiError('status must be APPROVED or REJECTED', 400, 'VALIDATION_ERROR')
    }

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const menuRequest = await db.menuRequest.findUnique({ where: { id } })
    if (!menuRequest) return apiError('Request not found', 404, 'NOT_FOUND')
    if (menuRequest.status !== 'PENDING') return apiError('Request already reviewed', 409, 'CONFLICT')

    // Verify reviewer is an OrgMember of the organizer that owns the vendor's event
    const vendor = await db.vendor.findUnique({
      where: { id: menuRequest.vendorId },
      select: { event: { select: { organizerId: true } } },
    })
    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')

    const { organizerId } = vendor.event
    if (!organizerId) return apiError('Event has no organizer', 403, 'FORBIDDEN')

    const isOrganizer = await db.orgMember.findFirst({
      where: { organizerId, userId: dbUser.id },
    })
    if (!isOrganizer) return apiError('Access denied', 403, 'FORBIDDEN')

    // Apply change if approved
    if (status === 'APPROVED') {
      if (menuRequest.type === 'ADD') {
        await db.menuItem.create({
          data: {
            vendorId: menuRequest.vendorId,
            name: menuRequest.name!,
            description: menuRequest.description ?? undefined,
            price: menuRequest.price!,
            category: menuRequest.category!,
            prepTime: menuRequest.prepTime ?? 15,
            imageUrl: menuRequest.imageUrl ?? undefined,
          },
        })
      } else if (menuRequest.type === 'EDIT' && menuRequest.menuItemId) {
        await db.menuItem.update({
          where: { id: menuRequest.menuItemId },
          data: {
            ...(menuRequest.name        !== null && { name: menuRequest.name }),
            ...(menuRequest.description !== null && { description: menuRequest.description }),
            ...(menuRequest.price       !== null && { price: menuRequest.price }),
            ...(menuRequest.category    !== null && { category: menuRequest.category }),
            ...(menuRequest.prepTime    !== null && { prepTime: menuRequest.prepTime }),
            ...(menuRequest.imageUrl    !== null && { imageUrl: menuRequest.imageUrl }),
          },
        })
      } else if (menuRequest.type === 'DELETE' && menuRequest.menuItemId) {
        await db.menuItem.delete({ where: { id: menuRequest.menuItemId } })
      }

      revalidateTag(`vendor-menu-${menuRequest.vendorId}`)
    }

    const updated = await db.menuRequest.update({
      where: { id },
      data: {
        status,
        reviewedBy: dbUser.id,
        reviewedAt: new Date(),
        reviewNote: reviewNote ?? null,
      },
    })

    return success(updated)
  } catch (err) {
    return handleApiError(err)
  }
}
