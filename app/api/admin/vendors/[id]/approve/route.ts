import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireStrictAdminAuth } from '@/lib/auth'
import { decideVendor } from '@/lib/approvals'
import { settingsActorRole } from '@/lib/roles'
import { currentUser } from '@clerk/nextjs/server'

// PATCH /api/admin/vendors/[id]/approve   Body: { boothNumber?: string }
// The fair Vendors page's approve button. Same single decision as the approvals page
// (lib/approvals.ts decideVendor: documents gate, booth + owner together, owner exceptions, audit,
// applicant email). Strict admins only since item 9: "only the client approves" (C-9), so
// event_operator no longer approves vendors.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireStrictAdminAuth()
    const user = await currentUser()
    const { id } = await params

    let boothNumber: string | undefined
    try {
      const body = await req.json()
      boothNumber = typeof body.boothNumber === 'string' && body.boothNumber.trim() ? body.boothNumber.trim() : undefined
    } catch { /* body is optional */ }

    await decideVendor(id, 'approve', null, { clerkId, actorType: settingsActorRole(user?.publicMetadata) ?? 'admin' })
    if (boothNumber) await db.vendor.update({ where: { id }, data: { boothNumber } })
    const updated = await db.vendor.findUnique({ where: { id }, select: { id: true, name: true, status: true, boothNumber: true } })

    // Now ACTIVE → orderable. Bust the cached customer discovery list ('vendors', 120s in
    // lib/fairs.ts) so the approved vendor appears promptly, not after the TTL.
    revalidateTag('vendors', 'default')
    return success({ vendor: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
