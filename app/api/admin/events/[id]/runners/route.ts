import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'

// GET /api/admin/events/[id]/runners
// Returns the runner roster for the event. [id] may be the event UUID or urlSlug.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { event } = await requireAdminFairContext(id)

    const { searchParams } = new URL(req.url)
    const take = Math.min(Math.max(1, parseInt(searchParams.get('take') ?? '200', 10)), 500)

    const runners = await db.runner.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'asc' },
      take,
      select: {
        id: true,
        status: true,
        approvalStatus: true,
        rejectionReason: true,
        createdAt: true,
        eventId: true,
        completionRate: true,
        totalDispatched: true,
        totalCompleted: true,
        user: { select: { name: true, email: true } },
      },
    })

    return success({ runners })
  } catch (err) {
    return handleApiError(err)
  }
}
