import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireStrictAdminAuth } from '@/lib/auth'
import { decideVendor } from '@/lib/approvals'
import { settingsActorRole } from '@/lib/roles'
import { reviewerNameFrom } from '@/lib/reviewer-label'
import { currentUser } from '@clerk/nextjs/server'

// PATCH /api/admin/vendors/[id]/reject   Body: { reason: string }
// The fair Vendors page's reject button. Same single decision as the approvals page
// (lib/approvals.ts decideVendor): reason required and emailed to the applicant; the owner row is
// rejected only if it was still PENDING. Strict admins only since item 9 (C-9).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireStrictAdminAuth()
    const user = await currentUser()
    const { id } = await params
    let reason: unknown
    try { reason = (await req.json()).reason } catch { /* validated below */ }

    await decideVendor(id, 'reject', reason, {
      clerkId, actorType: settingsActorRole(user?.publicMetadata) ?? 'admin',
      name: reviewerNameFrom({ fullName: user?.fullName, firstName: user?.firstName, lastName: user?.lastName }),
    })
    const updated = await db.vendor.findUnique({ where: { id }, select: { id: true, name: true, status: true } })

    // No longer ACTIVE → must drop from the cached customer discovery list ('vendors').
    revalidateTag('vendors', 'default')
    return success({ vendor: updated, reason })
  } catch (err) {
    return handleApiError(err)
  }
}
