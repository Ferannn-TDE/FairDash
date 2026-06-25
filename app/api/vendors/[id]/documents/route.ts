import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'

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
    const clerkId  = await requireAuth()
    const vendorId = (await params).id

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const isMember = await getVendorAuth(dbUser.id, vendorId, req)
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

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

    // ── Storage upload ─────────────────────────────────────────────────────────
    // Replace this block with your storage provider:
    //
    // Supabase:
    //   const { createClient } = await import('@supabase/supabase-js')
    //   const supabase = createClient(
    //     process.env.SUPABASE_URL!,
    //     process.env.SUPABASE_SERVICE_ROLE_KEY!
    //   )
    //   const fileName = `${Date.now()}-${(file as File).name ?? docType}`
    //   const path = `vendors/${vendorId}/${docType}/${fileName}`
    //   const { error } = await supabase.storage
    //     .from('vendor-documents')
    //     .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true })
    //   if (error) throw new Error(error.message)
    //   const { data } = supabase.storage.from('vendor-documents').getPublicUrl(path)
    //   const fileUrl = data.publicUrl
    //
    // For now, return 501 until storage is configured.
    const storageConfigured =
      !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!storageConfigured) {
      return apiError(
        'Document storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
        501,
        'STORAGE_NOT_CONFIGURED'
      )
    }

    // Placeholder — replace with actual upload result URL above
    const fileUrl = ''

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

    logVendorAction(vendorId, dbUser.id, AUDIT_ACTIONS.SETTINGS_DOC_UPLOADED, { docType })

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
    const clerkId  = await requireAuth()
    const vendorId = (await params).id

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const isMember = await getVendorAuth(dbUser.id, vendorId, req)
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

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
