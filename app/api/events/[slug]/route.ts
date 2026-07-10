import { EventStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { readinessWhereIfEnforced } from '@/lib/vendor-readiness'

// GET /api/events/:slug
// Returns a single event by its URL slug, with active vendor count.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    // Accept both URL slug and raw UUID so callers with only an eventId can also use this route
    const event = await db.event.findFirst({
      // Detail hydration for the public fair page — gate to live, non-archived so a
      // non-live fair is unreachable by slug OR raw id (matches getFairBySlugCached).
      where: { OR: [{ urlSlug: (await params).slug }, { id: (await params).slug }], status: EventStatus.ACTIVE, archivedAt: null },
      include: {
        fulfillmentConfig: true,
        _count: {
          select: {
            vendors: {
              // Aligns with the marketplace gate: when enforcement is on the badge
              // counts only orderable (ready) vendors — never "17" while 2 show.
              where: { status: 'ACTIVE', isOffline: false, ...readinessWhereIfEnforced() },
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
