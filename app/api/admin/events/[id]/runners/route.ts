import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'

// GET /api/admin/events/[id]/runners
// Returns the runner roster for the event.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminAuth()

    const { id: eventId } = await params
    const { searchParams } = new URL(req.url)
    const take = Math.min(Math.max(1, parseInt(searchParams.get('take') ?? '200', 10)), 500)

    const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true } })
    if (!event) throw new ApiError('Event not found', 404, 'EVENT_NOT_FOUND')

    const runners = await db.runner.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
      take,
      select: {
        id: true,
        status: true,
        createdAt: true,
        eventId: true,
        user: { select: { name: true, email: true } },
      },
    })

    return success({ runners })
  } catch (err) {
    return handleApiError(err)
  }
}
