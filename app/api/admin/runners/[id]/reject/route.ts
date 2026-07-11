import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'

// PATCH /api/admin/runners/[id]/reject
// Sets a runner's approvalStatus to REJECTED (records the acting admin + reason).
// Mirrors the vendor reject route: only a PENDING runner can be rejected (409
// otherwise), and a reason is required. Shared shape with organizer #7.

export async function PATCH(
  req: NextRequest,
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
      throw new ApiError('Only PENDING runners can be rejected', 409, 'INVALID_STATUS')
    }

    let reason: string | undefined
    try {
      const body = await req.json()
      reason = body.reason
    } catch { /* body optional */ }

    if (!reason?.trim()) {
      throw new ApiError('A rejection reason is required', 400, 'VALIDATION_ERROR')
    }

    const updated = await db.runner.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        approvedBy: admin.id,
        rejectionReason: reason.trim(),
      },
      select: {
        id: true,
        approvalStatus: true,
        approvedBy: true,
        rejectionReason: true,
        user: { select: { name: true, email: true } },
      },
    })

    // TODO: send rejection email/notification to runner with reason
    return success({ runner: updated, reason: reason.trim() })
  } catch (err) {
    return handleApiError(err)
  }
}
