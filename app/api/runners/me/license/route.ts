import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import {
  StorageNotConfiguredError,
  StorageOpError,
  deleteLicenseObject,
  signLicenseUrl,
  uploadLicense,
} from '@/lib/runner-license-storage'
import { ALLOWED_DOC_MIME, assertUploadSize, validateUpload } from '@/lib/upload-limits'

// Driver's licence — SELF-SCOPED. The runner is always resolved from the session
// (db.runner.findUnique by the caller's own userId); no id is ever accepted from the
// request, so a runner can only ever read or write THEIR OWN licence.
//
// GET  /api/runners/me/license — upload status + (if present) a 60s signed view URL
// POST /api/runners/me/license — multipart upload → private bucket, persists the PATH
//
// The response NEVER contains a durable/public URL — only a short-lived signed one.

async function requireOwnRunner() {
  const clerkId = await requireAuth()
  const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
  if (!dbUser) throw new ApiError('User not found', 404, 'USER_NOT_FOUND')

  const runner = await db.runner.findUnique({
    where: { userId: dbUser.id },
    select: { id: true, licensePath: true, licenseUploadedAt: true },
  })
  if (!runner) throw new ApiError('No runner record found', 404, 'RUNNER_NOT_FOUND')
  return runner
}

export async function GET() {
  try {
    const runner = await requireOwnRunner()

    if (!runner.licensePath) {
      return success({ uploaded: false, uploadedAt: null, viewUrl: null })
    }

    // A storage outage must not make the Settings page look like the licence vanished:
    // report uploaded=true with a null viewUrl and let the UI say "can't load preview".
    let viewUrl: string | null = null
    try {
      viewUrl = await signLicenseUrl(runner.licensePath)
    } catch (err) {
      logger.warn('[License] Could not sign view URL', {
        runnerId: runner.id,
        err: err instanceof Error ? err.message : String(err),
      })
    }

    return success({
      uploaded: true,
      uploadedAt: runner.licenseUploadedAt,
      viewUrl, // short-lived; not persisted anywhere
    })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const runner = await requireOwnRunner()

    // Early, pre-buffer reject (see lib/upload-limits.ts) — formData() below materialises the
    // whole body in memory. Auth deliberately stays ahead of it.
    assertUploadSize(req)

    const form = await req.formData()
    const file = form.get('file')

    // Authoritative size + MIME. Throws UploadRejection → FILE_TOO_LARGE / INVALID_MIME.
    validateUpload(file, { allowedMime: ALLOWED_DOC_MIME })

    const filename = (file as File).name ?? 'license'
    const previousPath = runner.licensePath

    // Upload FIRST, persist SECOND. If the upload throws we never write a path, so the
    // record never claims a licence that isn't really stored (the silent-discard bug the
    // old vendor placeholder had: it "succeeded" while writing an empty URL).
    const path = await uploadLicense(runner.id, file, filename)

    await db.runner.update({
      where: { id: runner.id },
      data: { licensePath: path, licenseUploadedAt: new Date() },
    })

    // Replacing an existing licence — drop the superseded object so old ID scans don't
    // linger in the bucket. Best-effort; the DB now points at the new one regardless.
    if (previousPath && previousPath !== path) {
      await deleteLicenseObject(previousPath)
    }

    logger.info('[License] Uploaded', { runnerId: runner.id, replaced: !!previousPath })

    let viewUrl: string | null = null
    try {
      viewUrl = await signLicenseUrl(path)
    } catch {
      /* upload succeeded; a missing preview is not a failed upload */
    }

    return success({ uploaded: true, uploadedAt: new Date().toISOString(), viewUrl })
  } catch (err) {
    // Storage misconfiguration is actionable by the operator, not the runner — surface
    // the real reason (503) rather than a generic 500. A PUBLIC bucket lands here too:
    // uploadLicense refuses rather than storing a licence world-readably.
    if (err instanceof StorageNotConfiguredError) {
      return apiError(err.message, 503, 'STORAGE_NOT_CONFIGURED')
    }
    if (err instanceof StorageOpError) {
      return apiError(err.message, 502, 'STORAGE_ERROR')
    }
    return handleApiError(err)
  }
}
