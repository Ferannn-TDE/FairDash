import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { EventStatus } from '@prisma/client'

// PATCH /api/admin/events/[id]/pause
// Toggles event.isPaused.
// Can only pause/resume an ACTIVE event.
// Body: { isPaused: boolean }

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { event } = await requireAdminFairContext(id)

    const { isPaused }: { isPaused: boolean } = await req.json()

    if (typeof isPaused !== 'boolean') {
      throw new ApiError('isPaused must be a boolean', 400, 'VALIDATION_ERROR')
    }

    if (event.status !== EventStatus.ACTIVE) {
      throw new ApiError('Only ACTIVE events can be paused or resumed', 409, 'EVENT_NOT_ACTIVE')
    }

    const updated = await db.event.update({
      where: { id: event.id },
      data: { isPaused },
      select: { id: true, name: true, status: true, isPaused: true },
    })

    return success({ event: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
