import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireStrictAdminAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'

// PATCH /api/admin/organizers/[id]/suspend
// The A6 kill-switch WRITE. Sets or clears FairOrganizer.suspendedAt (org-wide).
// Body: { suspend: boolean, reason?: string }
//
// Authorization: requireStrictAdminAuth — STRICT platform admin (admin |
// super_admin) ONLY. This gate is the whole point of the kill-switch: an
// organizer identity is structurally rejected here (they have no admin role), so
// a suspended organizer CANNOT un-suspend themselves. Same A3-style exclusion as
// the read boundary, applied to the write. Resolves a FairOrganizer (not an
// Event) → no unscoped Event resolve introduced; the grep invariant is untouched.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminClerkId = await requireStrictAdminAuth()
    const { id } = await params

    const body = await req.json()
    const { suspend, reason } = body as { suspend?: unknown; reason?: unknown }

    if (typeof suspend !== 'boolean') {
      throw new ApiError('suspend must be a boolean', 400, 'VALIDATION_ERROR')
    }
    if (reason !== undefined && reason !== null && typeof reason !== 'string') {
      throw new ApiError('reason must be a string', 400, 'VALIDATION_ERROR')
    }

    const organizer = await db.fairOrganizer.findUnique({ where: { id }, select: { id: true } })
    if (!organizer) throw new ApiError('Organizer not found', 404, 'ORGANIZER_NOT_FOUND')

    const updated = await db.fairOrganizer.update({
      where: { id },
      data: {
        suspendedAt:     suspend ? new Date() : null,
        suspendedReason: suspend ? (reason as string | undefined) ?? null : null,
      },
      select: { id: true, name: true, suspendedAt: true, suspendedReason: true },
    })

    logger.info('[OrganizerSuspension]', {
      userId: adminClerkId,
      organizerId: updated.id,
      action: suspend ? 'SUSPEND' : 'UNSUSPEND',
    })

    return success({ organizer: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
