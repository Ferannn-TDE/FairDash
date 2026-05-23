import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/favorites/ids
// Returns only the array of favorited menuItemIds for the current user.
// Collapses N per-card requests into one bulk check.
export async function GET() {
  try {
    const clerkId = await requireAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return success([])

    const favs = await db.favoriteItem.findMany({
      where: { userId: dbUser.id },
      select: { menuItemId: true },
    })

    return success(favs.map((f) => f.menuItemId))
  } catch (err) {
    return handleApiError(err)
  }
}
