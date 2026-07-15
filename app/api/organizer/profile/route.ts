import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/organizer/profile
export async function GET(_req: NextRequest) {
  try {
    const clerkId = await requireAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('Forbidden', 403, 'FORBIDDEN')

    const orgMember = await db.orgMember.findFirst({
      where: { userId: dbUser.id },
      include: { organizer: true },
    })

    // This route is deliberately UNGATED (plain requireAuth, not requireOrganizerAuth) so a
    // pending organizer can still load their own status rather than 403-ing. It therefore
    // surfaces the approval/suspension state — the enabling piece the layout's gate screen and
    // any "your account status" UI read. Same fields, same meaning, as the gate helpers.
    const org = orgMember?.organizer
    return success({
      name: dbUser.name,
      email: dbUser.email,
      phone: dbUser.phone,
      organizationName: org?.name ?? null,
      contactEmail: org?.contactEmail ?? null,
      approvalStatus: org?.approvalStatus ?? null,
      rejectionReason: org?.rejectionReason ?? null,
      suspended: !!org?.suspendedAt,
      suspendedReason: org?.suspendedReason ?? null,
    })
  } catch (err) {
    return handleApiError(err)
  }
}

// PATCH /api/organizer/profile
export async function PATCH(req: NextRequest) {
  try {
    const clerkId = await requireAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('Forbidden', 403, 'FORBIDDEN')

    const body = await req.json()
    const { name, phone, organizationName } = body as {
      name?: string
      phone?: string
      organizationName?: string
    }

    // Update User fields
    const updatedUser = await db.user.update({
      where: { id: dbUser.id },
      data: {
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
      },
    })

    // Update FairOrganizer name if applicable
    if (organizationName !== undefined) {
      const orgMember = await db.orgMember.findFirst({
        where: { userId: dbUser.id },
      })
      if (orgMember) {
        await db.fairOrganizer.update({
          where: { id: orgMember.organizerId },
          data: { name: organizationName },
        })
      }
    }

    return success({
      name: updatedUser.name,
      email: updatedUser.email,
      phone: updatedUser.phone,
    })
  } catch (err) {
    return handleApiError(err)
  }
}

// DELETE /api/organizer/profile — organizers cannot delete their own organization.
// Org deletion is a platform-admin action handled out-of-band (support ticket).
export async function DELETE(_req: NextRequest) {
  return apiError('Organization deletion must be requested via support', 403, 'FORBIDDEN')
}
