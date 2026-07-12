import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth, hasStrictAdminAuth } from '@/lib/auth'
import { resolveVendorWhere } from '@/lib/resolve-vendor'
import { logger } from '@/lib/logger'
import {
  StorageNotConfiguredError,
  signVendorDocumentUrl,
} from '@/lib/vendor-document-storage'

// GET /api/organizer/vendors/:id/documents?fair=<fairSlug>
//
// The BROKERED read of a vendor's compliance documents for the OWNING ORGANIZER (or a
// platform admin). Mirrors the runner-licence pattern: the stored value is an object path
// in a PRIVATE bucket, and this route mints a SHORT-LIVED SIGNED URL for a caller it has
// authorised. It never returns a path, and there is no public URL to return.
//
// AUTHORISATION — two independent gates, neither of which trusts the request:
//   1. requireOrganizerAuth() resolves the organizer from the SESSION. The vendor id in
//      the path cannot promote anyone: a tampered id just fails gate 2.
//   2. The vendor's event must belong to THAT organizer. A platform admin (strict role)
//      bypasses gate 2 only — they still have to be a real admin.
// Anyone else — another vendor, another organizer, anonymous — gets 403/401.
//
// AUDIT — every view is logged. These are legal documents (insurance certificate,
// business licence); "who looked at this vendor's insurance, and when" is a question that
// should have an answer.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { organizerId, clerkId } = await requireOrganizerAuth()
    const { id: vendorParam } = await params
    const fairSlug = req.nextUrl.searchParams.get('fair')

    const vendor = await db.vendor.findFirst({
      where: await resolveVendorWhere(vendorParam, fairSlug),
      select: {
        id: true,
        name: true,
        foodHandlerPermitPath: true,
        insurancePath: true,
        businessLicensePath: true,
        event: { select: { id: true, organizerId: true } },
      },
    })
    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')

    // Gate 2: ownership, unless the caller is a platform admin.
    const isAdmin = await hasStrictAdminAuth()
    if (vendor.event.organizerId !== organizerId && !isAdmin) {
      return apiError('Access denied', 403, 'FORBIDDEN')
    }

    const sign = async (path: string | null) => (path ? await signVendorDocumentUrl(path) : null)
    const [foodHandler, insurance, businessLicense] = await Promise.all([
      sign(vendor.foodHandlerPermitPath),
      sign(vendor.insurancePath),
      sign(vendor.businessLicensePath),
    ])

    // Audit the view — who, whose documents, which ones actually existed to be seen.
    logger.info('[VendorDocs] documents viewed', {
      viewerClerkId: clerkId,
      viewerRole: isAdmin && vendor.event.organizerId !== organizerId ? 'platform_admin' : 'owning_organizer',
      vendorId: vendor.id,
      vendorName: vendor.name,
      eventId: vendor.event.id,
      viewed: [
        vendor.foodHandlerPermitPath && 'foodHandler',
        vendor.insurancePath && 'insurance',
        vendor.businessLicensePath && 'businessLicense',
      ].filter(Boolean),
    })

    return success({
      foodHandler:     { uploaded: !!vendor.foodHandlerPermitPath, url: foodHandler },
      insurance:       { uploaded: !!vendor.insurancePath,         url: insurance },
      businessLicense: { uploaded: !!vendor.businessLicensePath,   url: businessLicense },
    })
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return apiError(err.message, 503, 'STORAGE_NOT_CONFIGURED')
    return handleApiError(err)
  }
}
