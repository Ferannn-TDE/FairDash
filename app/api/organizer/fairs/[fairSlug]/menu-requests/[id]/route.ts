import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { getRealtimeDb } from '@/lib/firebase-admin'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'
import { logger } from '@/lib/logger'

// PATCH /api/organizer/fairs/[fairSlug]/menu-requests/[id]
// { action: 'APPROVE' | 'REJECT', reason?: string }
// APPROVE: applies the menu change live and revalidates vendor-menu cache.
// REJECT: marks rejected with optional reason.
// Both: writes Firebase vendor notification + audit log entry.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string; id: string }> }
) {
  try {
    const { organizerId, clerkId } = await requireOrganizerAuth()
    const { fairSlug, id: requestId } = await params

    // Verify fair ownership
    const event = await db.event.findFirst({
      where: { urlSlug: fairSlug, organizerId },
      select: { id: true },
    })
    if (!event) return apiError('Fair not found or access denied', 404, 'NOT_FOUND')

    const body = await req.json() as { action?: string; reason?: string }
    const { action, reason } = body

    if (!action || !['APPROVE', 'REJECT'].includes(action)) {
      return apiError('action must be APPROVE or REJECT', 400, 'VALIDATION_ERROR')
    }

    const menuRequest = await db.menuRequest.findUnique({
      where: { id: requestId },
      include: { vendor: { select: { id: true, name: true, eventId: true } } },
    })
    if (!menuRequest) return apiError('Request not found', 404, 'NOT_FOUND')
    if (menuRequest.vendor.eventId !== event.id) return apiError('Request not in this fair', 403, 'FORBIDDEN')
    if (menuRequest.status !== 'PENDING') return apiError('Request already reviewed', 409, 'CONFLICT')

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const vendorId = menuRequest.vendor.id
    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'

    // Apply change if approved
    if (action === 'APPROVE') {
      if (menuRequest.type === 'ADD') {
        if (!menuRequest.name || menuRequest.price === null || !menuRequest.category) {
          return apiError('Malformed ADD request — missing required fields', 422, 'UNPROCESSABLE')
        }
        await db.menuItem.create({
          data: {
            vendorId,
            name: menuRequest.name,
            description: menuRequest.description ?? undefined,
            price: menuRequest.price,
            category: menuRequest.category,
            prepTime: menuRequest.prepTime ?? 15,
            imageUrl: menuRequest.imageUrl ?? undefined,
            isAvailable: true,
          },
        })
      } else if (menuRequest.type === 'EDIT') {
        if (!menuRequest.menuItemId) return apiError('EDIT request missing menuItemId', 422, 'UNPROCESSABLE')
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
      } else if (menuRequest.type === 'DELETE') {
        if (!menuRequest.menuItemId) return apiError('DELETE request missing menuItemId', 422, 'UNPROCESSABLE')
        await db.menuItem.update({
          where: { id: menuRequest.menuItemId },
          data: { isAvailable: false },
        })
      }

      revalidateTag(`vendor-menu-${vendorId}`, 'default')
    }

    revalidateTag(`event-badges-${event.id}`, 'default')

    const updated = await db.menuRequest.update({
      where: { id: requestId },
      data: {
        status: newStatus,
        reviewedBy: dbUser.id,
        reviewedAt: new Date(),
        reviewNote: reason ?? null,
      },
    })

    // Fire-and-forget: Firebase vendor notification + audit log
    void (async () => {
      try {
        const rtdb = getRealtimeDb()
        if (rtdb) {
          await rtdb.ref(`vendors/${vendorId}/notifications`).push({
            type: 'MENU_REQUEST_REVIEWED',
            requestId,
            requestType: menuRequest.type,
            itemName: menuRequest.name ?? null,
            status: newStatus,
            reason: reason ?? null,
            ts: Date.now(),
          })
        }
      } catch (err) {
        logger.warn('[MenuRequest] Firebase notification failed', { requestId, error: String(err) })
      }
    })()

    logVendorAction(vendorId, dbUser.id, AUDIT_ACTIONS.MENU_CHANGE_REVIEWED, {
      requestId,
      requestType: menuRequest.type,
      action,
      itemName: menuRequest.name ?? null,
      menuItemId: menuRequest.menuItemId ?? null,
      reason: reason ?? null,
    })

    return success({
      id: updated.id,
      status: updated.status,
      reviewNote: updated.reviewNote,
      reviewedAt: updated.reviewedAt,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
