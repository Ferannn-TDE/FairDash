import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorMembershipById } from '@/lib/auth'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'
import {
  DOC_PATH_FIELD,
  DOC_TYPES,
  StorageNotConfiguredError,
  StorageOpError,
  signVendorDocumentUrl,
  uploadVendorDocument,
  type VendorDocType,
} from '@/lib/vendor-document-storage'
import { ALLOWED_DOC_MIME, assertUploadSize, validateUpload } from '@/lib/upload-limits'
import { vendorDocsPresence, type VendorDocPaths } from '@/lib/vendor-documents'

const isDocType = (v: unknown): v is VendorDocType =>
  typeof v === 'string' && (DOC_TYPES as readonly string[]).includes(v)

// POST /api/vendors/:id/documents   — upload one document (multipart: docType, file)
// GET  /api/vendors/:id/documents   — the vendor's own documents, as SIGNED view URLs
//
// PRIVATE BY CONSTRUCTION. Documents go to the PRIVATE `vendor-documents` bucket and only
// the object PATH is persisted (Vendor.*Path) — never a URL. Reads are brokered here:
// every response mints a short-lived signed URL. Both verbs are gated by
// requireVendorMembershipById, so a vendor only ever reaches their OWN documents; the
// vendor id comes from the path but membership is proved against the SESSION, so a
// tampered id fails the gate rather than exposing someone else's insurance certificate.
//
// (Organizer/admin access to a vendor's documents is a SEPARATE, separately-authorised
// route: /api/organizer/vendors/[id]/documents.)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const vendorId = (await params).id
    const { userId } = await requireVendorMembershipById(vendorId, req)

    // Size check BEFORE formData(): the parse buffers the entire body in memory, so an
    // oversized POST is already resident by the time file.size exists. Auth stays ahead of
    // both — an anonymous caller must not learn anything from the size of their own request.
    assertUploadSize(req)

    const form = await req.formData()
    const docType = form.get('docType')
    const file    = form.get('file')

    if (!isDocType(docType)) {
      return apiError('docType must be one of: foodHandler, insurance, businessLicense', 400, 'VALIDATION_ERROR')
    }
    // Authoritative: measured bytes, not a caller-declared Content-Length. Throws
    // UploadRejection, rendered as FILE_TOO_LARGE / INVALID_MIME by handleApiError below.
    validateUpload(file, { allowedMime: ALLOWED_DOC_MIME })

    // Uploads to the PRIVATE bucket. assertPrivateBucket() inside will REFUSE the upload
    // (loudly) if the bucket has been made public — a misconfiguration can no longer
    // silently become a breach, which is exactly how the original exposure happened.
    const filename = (file as File).name ?? docType
    const path = await uploadVendorDocument(vendorId, docType, file, filename)

    const vendor = await db.vendor.update({
      where: { id: vendorId },
      data: { [DOC_PATH_FIELD[docType]]: path },
      select: {
        foodHandlerPermitPath: true,
        insurancePath:         true,
        businessLicensePath:   true,
      },
    })

    logVendorAction(vendorId, userId, AUDIT_ACTIONS.SETTINGS_DOC_UPLOADED, { docType })

    return success({
      docType,
      documents: await signAll(vendor),
    })
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return apiError(err.message, 503, 'STORAGE_NOT_CONFIGURED')
    if (err instanceof StorageOpError)            return apiError(err.message, 502, 'STORAGE_UPLOAD_FAILED')
    return handleApiError(err)
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const vendorId = (await params).id
    await requireVendorMembershipById(vendorId, req)

    const vendor = await db.vendor.findUnique({
      where: { id: vendorId },
      select: {
        foodHandlerPermitPath: true,
        insurancePath:         true,
        businessLicensePath:   true,
      },
    })
    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')

    return success(await signAll(vendor))
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return apiError(err.message, 503, 'STORAGE_NOT_CONFIGURED')
    return handleApiError(err)
  }
}

/**
 * Turn the stored PATHS into short-lived signed view URLs. Response shape is unchanged
 * ({ uploaded, url }) so the settings UI needs no rework — but `url` is now a signed link
 * that expires, not a permanent public one.
 */
async function signAll(v: VendorDocPaths) {
  const sign = async (path: string | null) => (path ? await signVendorDocumentUrl(path) : null)
  const [foodHandler, insurance, businessLicense] = await Promise.all([
    sign(v.foodHandlerPermitPath),
    sign(v.insurancePath),
    sign(v.businessLicensePath),
  ])
  // `uploaded` comes from the SSOT rather than a local `!!path`, so this endpoint's
  // notion of "present" cannot disagree with the approve gates' or the checklist's.
  // The { uploaded, url } value shape is deliberately unchanged — the settings page
  // and the onboarding wizard both consume it.
  const present = vendorDocsPresence(v)
  return {
    foodHandler:     { uploaded: present.foodHandler,     url: foodHandler },
    insurance:       { uploaded: present.insurance,       url: insurance },
    businessLicense: { uploaded: present.businessLicense, url: businessLicense },
  }
}
