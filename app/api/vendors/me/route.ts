import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'

// GET /api/vendors/me?fairSlug=<slug>
// Resolves the vendor THIS authenticated user owns AT THE GIVEN FAIR.
//
// Fair-scoped + DETERMINISTIC. The vendor portal lives at /vendor/[fairSlug]/*, so
// "which vendor" must be "the one this user owns at THIS fair" — not a global
// guess. The old behavior (findFirst orderBy createdAt desc, fairSlug ignored)
// returned the user's NEWEST vendor everywhere, dropping a multi-vendor user into
// the wrong vendor's portal. Resolution is still by session (clerkId → userId),
// never by email — the API data boundary (per-endpoint requireVendorMembershipById)
// is untouched.
export async function GET(req: Request) {
  try {
    const clerkId = await requireAuth()

    const user = await db.user.findUnique({ where: { clerkId } })
    if (!user) return apiError('User not found', 404, 'NOT_FOUND')

    const fairSlug = new URL(req.url).searchParams.get('fairSlug')

    const memberships = await db.vendorMember.findMany({
      where: {
        userId: user.id,
        ...(fairSlug ? { vendor: { event: { urlSlug: fairSlug } } } : {}),
      },
      include: {
        vendor: {
          include: { menuItems: { orderBy: [{ category: 'asc' }, { name: 'asc' }] } },
        },
      },
      // DETERMINISTIC: the ORIGINAL application (oldest) wins — never "newest".
      orderBy: { createdAt: 'asc' },
    })

    if (memberships.length === 0) {
      // No vendor at this fair → DENY (the layout shows Access Denied). Never fall
      // back to some other vendor the user happens to own elsewhere.
      return apiError(
        fairSlug ? 'No vendor for this user at this fair' : 'No vendor found for this user',
        404,
        'NO_VENDOR',
      )
    }

    // Edge case — a user owns >1 vendor at the SAME fair (duplicate applications /
    // legitimate multiple stalls). We deterministically use the oldest and log it,
    // never arbitrarily. Full multi-stall support (a picker) is a separate follow-up.
    if (fairSlug && memberships.length > 1) {
      logger.warn('[vendors/me] user owns multiple vendors at one fair — using the oldest deterministically', {
        userId: user.id, fairSlug, count: memberships.length,
      })
    }

    const membership = memberships[0]
    return success({ vendor: membership.vendor, role: membership.role })
  } catch (err) {
    return handleApiError(err)
  }
}
