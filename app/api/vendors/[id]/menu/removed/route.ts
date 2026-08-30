import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { IS_REMOVED } from '@/lib/menu/on-menu'

// GET /api/vendors/:id/menu/removed — the vendor's REMOVED items.
//
// A SEPARATE ROUTE, not a `?removed=true` on the sibling menu endpoint, because the audiences
// differ: that one is customer-facing (it serves the storefront and only bypasses the offline /
// readiness gates for members), whereas removed items are vendor-only by definition — they are
// off the menu, and no customer surface should ever be able to ask for them. Membership is
// required outright here, so loosening a gate over there can never leak this.
//
// The complement of the active list: that reads ...ON_MENU, this reads ...IS_REMOVED, and
// IS_REMOVED is derived from ON_MENU so the two partition the vendor's items exactly
// (scripts/menu-item-removal-guard.ts [6]).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const clerkId = await requireAuth()

    const user = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!user) return apiError('User not found', 404, 'NOT_FOUND')

    const isMember = await getVendorAuth(user.id, id, req)
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

    const items = await db.menuItem.findMany({
      where: { vendorId: id, ...IS_REMOVED },
      orderBy: { removedAt: 'desc' },   // most recently removed first
      select: {
        id: true, name: true, description: true, price: true, category: true,
        imageUrl: true, prepTime: true, isAvailable: true, removedAt: true,
      },
    })

    return success({ items })
  } catch (err) {
    return handleApiError(err)
  }
}
