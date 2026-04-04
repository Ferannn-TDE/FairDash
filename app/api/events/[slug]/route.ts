import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'

// GET /api/events/:slug
// Returns a single event by its URL slug, with active vendor count.
export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  try {
    // Accept both URL slug and raw UUID so callers with only an eventId can also use this route
    const event = await db.event.findFirst({
      where: { OR: [{ urlSlug: params.slug }, { id: params.slug }] },
      include: {
        fulfillmentConfig: true,
        _count: {
          select: {
            vendors: {
              where: { status: 'ACTIVE', isOffline: false },
            },
          },
        },
      },
    })

    if (!event) return apiError('Event not found', 404, 'NOT_FOUND')
    return success(event)
  } catch (err) {
    return handleApiError(err)
  }
}
