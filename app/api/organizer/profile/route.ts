import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { checkPhone, INVALID_PHONE } from '@/lib/phone'

// THE ORGANIZER'S PHONE lives on FairOrganizer.contactPhone (sign-up-fixes): the same number the
// admin approval screens show and the sign-up form saves. GET falls back to the sign-in phone
// (User.phone) only while contactPhone is blank; PATCH writes contactPhone. User.phone itself is
// left alone here.

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
      phone: org?.contactPhone || dbUser.phone,
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

    const orgMember = await db.orgMember.findFirst({
      where: { userId: dbUser.id },
      select: { organizerId: true, organizer: { select: { contactPhone: true } } },
    })

    // The phone shown in Settings — the same value GET returns. Compared against it so an
    // unchanged number is never rewritten, and checked BEFORE any write so a bad number
    // changes nothing at all.
    const shownPhone = orgMember?.organizer.contactPhone || dbUser.phone
    let phoneToSave: { value: string | null } | null = null
    if (phone !== undefined) {
      const checked = checkPhone(phone, { required: false, previous: shownPhone })
      if (!checked.ok) return apiError(checked.error, 400, INVALID_PHONE)
      if (!checked.unchanged) phoneToSave = { value: checked.value }
    }

    // Update User fields. The phone goes to User.phone only for a user with no organizer record
    // (where it went before); an organizer's phone goes to FairOrganizer.contactPhone below.
    const updatedUser = await db.user.update({
      where: { id: dbUser.id },
      data: {
        ...(name !== undefined && { name }),
        ...(phoneToSave && !orgMember && { phone: phoneToSave.value }),
      },
    })

    if (orgMember && (organizationName !== undefined || phoneToSave)) {
      await db.fairOrganizer.update({
        where: { id: orgMember.organizerId },
        data: {
          ...(organizationName !== undefined && { name: organizationName }),
          ...(phoneToSave && { contactPhone: phoneToSave.value }),
        },
      })
    }

    const savedPhone = phoneToSave
      ? (phoneToSave.value || (orgMember ? updatedUser.phone : null))
      : shownPhone

    return success({
      name: updatedUser.name,
      email: updatedUser.email,
      phone: savedPhone,
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
