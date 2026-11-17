import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireStrictAdminAuth } from '@/lib/auth'
import { settingsActorRole } from '@/lib/roles'
import { reviewerNameFrom } from '@/lib/reviewer-label'

// PATCH /api/admin/vendors/[id]/demo   Body: { demo: boolean }
//
// The demo switch (Jordan, Nov 16; sub-step D; lib/demo-vendor.ts). STRICT admins only
// (admin | super_admin): not platform_manager, event_operator, organizers or vendors. This is the
// ONLY route that writes Vendor.isDemo (the local dev-fair seed is the only other writer); the
// organizer and vendor routes take explicit field lists and never accept it.
//
// Logged: every change writes an ApprovalAction (DEMO_ON / DEMO_OFF, the admin's name and role)
// in the SAME transaction as the change, status-conditional on the old value, so the log and the
// flag can never disagree. Setting the value it already has changes nothing and logs nothing.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const clerkId = await requireStrictAdminAuth()
    const { id } = await params

    let demo: unknown
    try { demo = (await req.json())?.demo } catch { /* validated below */ }
    if (typeof demo !== 'boolean') throw new ApiError('demo must be true or false', 400, 'VALIDATION_ERROR')

    const vendor = await db.vendor.findUnique({ where: { id }, select: { id: true, isDemo: true, event: { select: { urlSlug: true } } } })
    if (!vendor) throw new ApiError('Vendor not found', 404, 'VENDOR_NOT_FOUND')
    if (vendor.isDemo === demo) return success({ id, isDemo: demo, changed: false })

    const user = await currentUser()
    const actorType = settingsActorRole(user?.publicMetadata) ?? 'admin'
    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { name: true, email: true } })
    const actorName = reviewerNameFrom({
      fullName: user?.fullName, firstName: user?.firstName, lastName: user?.lastName, dbName: dbUser?.name, email: dbUser?.email,
    })

    await db.$transaction(async tx => {
      const flip = await tx.vendor.updateMany({ where: { id, isDemo: !demo }, data: { isDemo: demo } })
      if (flip.count === 0) throw new ApiError('Changed by someone else just now; reload and try again', 409, 'ALREADY_CHANGED')
      await tx.approvalAction.create({
        data: {
          action: demo ? 'DEMO_ON' : 'DEMO_OFF', applicationType: 'vendor', applicationId: id,
          actorId: clerkId, actorType, actorName, detail: { from: !demo, to: demo },
        },
      })
    })

    // Who sees the booth changes (customer lists, counts, menus, the fair page).
    revalidateTag('vendors', 'default')
    revalidateTag('fair', 'default')
    revalidateTag('vendor-menu', 'default')
    revalidateTag(`vendor-${id}`, 'default')
    revalidateTag(`event-menu-${vendor.event.urlSlug}`, 'default')

    return success({ id, isDemo: demo, changed: true })
  } catch (err) {
    return handleApiError(err)
  }
}
