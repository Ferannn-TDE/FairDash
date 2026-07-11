import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import {
  StorageNotConfiguredError,
  StorageOpError,
  signLicenseUrl,
} from '@/lib/runner-license-storage'

// GET /api/admin/runners/[id]/license
// The ONLY other party permitted to view a runner's licence. Admin-gated; mints the same
// short-lived signed URL the runner gets. Read-only — an admin can look at a licence but
// cannot upload or replace one.
//
// Every view is logged: this is identity-document access, and it should leave a trail.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAdminAuth()
    const { id } = await params

    const runner = await db.runner.findUnique({
      where: { id },
      select: { id: true, licensePath: true, licenseUploadedAt: true },
    })
    if (!runner) throw new ApiError('Runner not found', 404, 'RUNNER_NOT_FOUND')

    if (!runner.licensePath) {
      return success({ uploaded: false, uploadedAt: null, viewUrl: null })
    }

    const viewUrl = await signLicenseUrl(runner.licensePath)

    logger.info('[License] Admin viewed runner licence', { runnerId: runner.id, adminClerkId: clerkId })

    return success({ uploaded: true, uploadedAt: runner.licenseUploadedAt, viewUrl })
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) {
      return apiError(err.message, 503, 'STORAGE_NOT_CONFIGURED')
    }
    if (err instanceof StorageOpError) {
      return apiError(err.message, 502, 'STORAGE_ERROR')
    }
    return handleApiError(err)
  }
}
