import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireApprovalsAdmin } from '@/lib/auth'
import { vendorDocumentPathForReview } from '@/lib/approvals'
import { signVendorDocumentUrl } from '@/lib/vendor-document-storage'

// GET /api/admin/approvals/vendors/{id}/documents/{foodHandler|insurance|businessLicense}
// A short-lived signed link to a PENDING vendor's document, for review. Every view is audited
// (ApprovalAction VIEW_DOCUMENT: actor, role, document, time).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; doc: string }> }) {
  try {
    const actor = await requireApprovalsAdmin()
    const { id, doc } = await params
    const path = await vendorDocumentPathForReview(id, doc, actor)
    return success({ url: await signVendorDocumentUrl(path) })
  } catch (err) {
    return handleApiError(err)
  }
}
