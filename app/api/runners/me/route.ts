import { NextRequest } from 'next/server'
import { RunnerStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET  /api/runners/me  — return the authenticated user's Runner record + event
// PATCH /api/runners/me — update runner status (ACTIVE | OFFLINE)

export async function GET() {
  try {
    const clerkId = await requireAuth()
    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    const runner = await db.runner.findUnique({
      where: { userId: dbUser.id },
      include: {
        event: {
          select: { id: true, name: true, urlSlug: true, status: true },
        },
      },
    })

    if (!runner) return apiError('No runner record found for this user', 404, 'RUNNER_NOT_FOUND')

    return success({ runner })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const clerkId = await requireAuth()
    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    const runner = await db.runner.findUnique({ where: { userId: dbUser.id } })
    if (!runner) return apiError('No runner record found', 404, 'RUNNER_NOT_FOUND')

    const body = await req.json()
    const { status } = body as { status: RunnerStatus }

    if (!status || !Object.values(RunnerStatus).includes(status)) {
      throw new ApiError(
        `status must be one of: ${Object.values(RunnerStatus).join(', ')}`,
        400,
        'VALIDATION_ERROR'
      )
    }

    // Runners on active delivery cannot go OFFLINE
    if (runner.status === RunnerStatus.ON_DELIVERY && status === RunnerStatus.OFFLINE) {
      throw new ApiError(
        'Cannot go offline while on an active delivery',
        409,
        'RUNNER_ON_DELIVERY'
      )
    }

    const updated = await db.runner.update({
      where: { id: runner.id },
      data: { status },
      include: { event: { select: { id: true, name: true, urlSlug: true } } },
    })

    return success({ runner: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
