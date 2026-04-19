import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'

// GET /api/admin/events/[id]/runners
// Returns the runner roster for the event.

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdminAuth()

    const event = await db.event.findUnique({ where: { id: params.id } })
    if (!event) throw new ApiError('Event not found', 404, 'EVENT_NOT_FOUND')

    const runners = await db.runner.findMany({
      where: { eventId: params.id },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { name: true, email: true } },
      },
    })

    return success({ runners })
  } catch (err) {
    return handleApiError(err)
  }
}
