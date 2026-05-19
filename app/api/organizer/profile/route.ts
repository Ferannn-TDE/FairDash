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
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const orgMember = await db.orgMember.findFirst({
      where: { userId: dbUser.id },
      include: { organizer: true },
    })

    return success({
      name: dbUser.name,
      email: dbUser.email,
      phone: dbUser.phone,
      organizationName: orgMember?.organizer?.name ?? null,
      contactEmail: orgMember?.organizer?.contactEmail ?? null,
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
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

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

// DELETE /api/organizer/profile — stub
export async function DELETE(_req: NextRequest) {
  return apiError('Not implemented', 501, 'NOT_IMPLEMENTED')
}
