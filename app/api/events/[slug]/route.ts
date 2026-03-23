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
    const event = await db.event.findUnique({
      where: { urlSlug: params.slug },
      include: {
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
