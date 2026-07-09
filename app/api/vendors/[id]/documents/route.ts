import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorMembershipById } from '@/lib/auth'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'
import { logger } from '@/lib/logger'

const STORAGE_BUCKET = 'vendor-documents'

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

const DOC_FIELD: Record<string, string> = {
  foodHandler:     'foodHandlerPermitUrl',
  insurance:       'insuranceUrl',
  businessLicense: 'businessLicenseUrl',
}

// POST /api/vendors/:id/documents
// Accepts: multipart/form-data with fields:
//   docType: 'foodHandler' | 'insurance' | 'businessLicense'
//   file: the document file (PDF or image, ≤10 MB)
//
// Storage: configure NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// and replace the placeholder below with your Supabase Storage upload call.
// The route validates MIME + size and updates the Vendor record with the URL.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const vendorId = (await params).id
    const { userId } = await requireVendorMembershipById(vendorId, req)

    const form = await req.formData()
    const docType = form.get('docType')
    const file    = form.get('file')

    if (typeof docType !== 'string' || !DOC_FIELD[docType]) {
      return apiError('docType must be one of: foodHandler, insurance, businessLicense', 400, 'VALIDATION_ERROR')
    }
    if (!(file instanceof Blob)) {
      return apiError('file is required', 400, 'VALIDATION_ERROR')
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return apiError('File must be a PDF or image (JPEG, PNG, WebP)', 400, 'INVALID_MIME')
    }
    if (file.size > MAX_BYTES) {
      return apiError('File must be 10 MB or smaller', 400, 'FILE_TOO_LARGE')
    }

    // ── Storage upload (real — Supabase Storage REST, server-side, service key) ──
    // Uploads the file to the vendor-documents bucket and stores its URL. Never
    // "succeeds" without actually storing the file (the old placeholder wrote an
    // empty URL and silently discarded uploads).
    const supabaseUrl = process.env.SUPABASE_URL
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) {
      return apiError('Document storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.', 503, 'STORAGE_NOT_CONFIGURED')
    }

    const safeName = ((file as File).name ?? docType).replace(/[^a-zA-Z0-9._-]/g, '_')
    const path     = `${vendorId}/${docType}/${Date.now()}_${safeName}`

    const upload = await fetch(`${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': file.type, 'x-upsert': 'true' },
      body:    Buffer.from(await file.arrayBuffer()),
    })
    if (!upload.ok) {
      const body = await upload.text()
      logger.error('[Documents] Supabase upload failed', { vendorId, docType, status: upload.status, body: body.slice(0, 200) })
      return apiError('Upload failed — please try again', 502, 'STORAGE_UPLOAD_FAILED')
    }

    const fileUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`

    const dbField = DOC_FIELD[docType]
    const vendor = await db.vendor.update({
      where: { id: vendorId },
      data: { [dbField]: fileUrl },
      select: {
        foodHandlerPermitUrl: true,
        insuranceUrl:         true,
        businessLicenseUrl:   true,
      },
    })

    logVendorAction(vendorId, userId, AUDIT_ACTIONS.SETTINGS_DOC_UPLOADED, { docType })

    return success({
      docType,
      url: fileUrl,
      documents: {
        foodHandler:     { uploaded: !!vendor.foodHandlerPermitUrl, url: vendor.foodHandlerPermitUrl },
        insurance:       { uploaded: !!vendor.insuranceUrl,         url: vendor.insuranceUrl         },
        businessLicense: { uploaded: !!vendor.businessLicenseUrl,   url: vendor.businessLicenseUrl   },
      },
    })
  } catch (err) {
    return handleApiError(err)
  }
}

// GET /api/vendors/:id/documents — returns current document upload status
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const vendorId = (await params).id
    await requireVendorMembershipById(vendorId, req)

    const vendor = await db.vendor.findUnique({
      where: { id: vendorId },
      select: {
        foodHandlerPermitUrl: true,
        insuranceUrl:         true,
        businessLicenseUrl:   true,
      },
    })
    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')

    return success({
      foodHandler:     { uploaded: !!vendor.foodHandlerPermitUrl, url: vendor.foodHandlerPermitUrl },
      insurance:       { uploaded: !!vendor.insuranceUrl,         url: vendor.insuranceUrl         },
      businessLicense: { uploaded: !!vendor.businessLicenseUrl,   url: vendor.businessLicenseUrl   },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
