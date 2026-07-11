import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'

// PATCH /api/admin/runners/[id]/approve
// Sets a runner's approvalStatus to APPROVED (records the acting admin + time,
// clears any prior rejectionReason). Mirrors the vendor approve route: only a
// PENDING runner can be approved (409 otherwise). Shared shape with organizer #7.

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAdminAuth()
    const admin = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!admin) throw new ApiError('Admin user not found', 404, 'USER_NOT_FOUND')

    const { id } = await params
    const runner = await db.runner.findUnique({ where: { id } })
    if (!runner) throw new ApiError('Runner not found', 404, 'RUNNER_NOT_FOUND')

    if (runner.approvalStatus !== 'PENDING') {
      throw new ApiError('Only PENDING runners can be approved', 409, 'INVALID_STATUS')
    }

    const updated = await db.runner.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: admin.id,
        rejectionReason: null,
      },
      select: {
        id: true,
        approvalStatus: true,
        approvedAt: true,
        approvedBy: true,
        user: { select: { name: true, email: true } },
      },
    })

    return success({ runner: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
