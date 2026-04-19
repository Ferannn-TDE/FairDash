import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/vendors/me
// Returns the vendor record associated with the currently authenticated user.
// Used by the vendor dashboard on mount to discover vendorId and eventId.
export async function GET() {
  try {
    const clerkId = await requireAuth()

    const user = await db.user.findUnique({ where: { clerkId } })
    if (!user) return apiError('User not found', 404, 'NOT_FOUND')

    const membership = await db.vendorMember.findFirst({
      where: { userId: user.id },
      include: {
        vendor: {
          include: {
            menuItems: {
              orderBy: [{ category: 'asc' }, { name: 'asc' }],
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!membership) return apiError('No vendor found for this user', 404, 'NO_VENDOR')

    return success({ vendor: membership.vendor, role: membership.role })
  } catch (err) {
    return handleApiError(err)
  }
}
