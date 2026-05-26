import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/favorites
// Returns the authenticated user's favorited menu items with vendor + event context.
export async function GET() {
  try {
    const clerkId = await requireAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return success({ favorites: [] })

    const favorites = await db.favoriteItem.findMany({
      where: { userId: dbUser.id },
      take: 100,
      orderBy: { createdAt: 'desc' },
      include: {
        menuItem: {
          include: {
            vendor: {
              select: {
                id: true, name: true, boothNumber: true, eventId: true,
                event: { select: { urlSlug: true, name: true } },
              },
            },
          },
        },
      },
    })

    return success({ favorites })
  } catch (err) {
    return handleApiError(err)
  }
}

// POST /api/favorites  { menuItemId }
// Adds a menu item to the user's favorites. Idempotent (upsert).
export async function POST(req: Request) {
  try {
    const clerkId = await requireAuth()
    const { menuItemId } = await req.json()

    if (!menuItemId) return apiError('menuItemId is required', 400, 'VALIDATION_ERROR')

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const item = await db.menuItem.findUnique({ where: { id: menuItemId } })
    if (!item) return apiError('Menu item not found', 404, 'NOT_FOUND')

    const favorite = await db.favoriteItem.upsert({
      where: { userId_menuItemId: { userId: dbUser.id, menuItemId } },
      create: { userId: dbUser.id, menuItemId },
      update: {},
    })

    return success(favorite, 201)
  } catch (err) {
    return handleApiError(err)
  }
}

// DELETE /api/favorites?menuItemId=...
// Removes a menu item from the user's favorites.
export async function DELETE(req: Request) {
  try {
    const clerkId = await requireAuth()
    const { searchParams } = new URL(req.url)
    const menuItemId = searchParams.get('menuItemId')

    if (!menuItemId) return apiError('menuItemId query param is required', 400, 'VALIDATION_ERROR')

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    await db.favoriteItem.deleteMany({
      where: { userId: dbUser.id, menuItemId },
    })

    return success({ removed: true })
  } catch (err) {
    return handleApiError(err)
  }
}
