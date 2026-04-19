import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'
import { RunnerStatus } from '@prisma/client'

// PATCH /api/admin/runners/[id]
// Activate or deactivate a runner.
// Body: { status: 'ACTIVE' | 'OFFLINE' | 'ON_DELIVERY' }

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdminAuth()

    const { status }: { status: RunnerStatus } = await req.json()

    if (!Object.values(RunnerStatus).includes(status)) {
      throw new ApiError(
        `Invalid status: ${status}. Must be one of: ${Object.values(RunnerStatus).join(', ')}`,
        400,
        'VALIDATION_ERROR'
      )
    }

    const runner = await db.runner.findUnique({ where: { id: params.id } })
    if (!runner) throw new ApiError('Runner not found', 404, 'RUNNER_NOT_FOUND')

    const updated = await db.runner.update({
      where: { id: params.id },
      data: { status },
      include: { user: { select: { name: true, email: true } } },
    })

    return success({ runner: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
