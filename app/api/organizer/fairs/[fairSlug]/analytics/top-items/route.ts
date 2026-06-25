import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'

// GET /api/organizer/fairs/[fairSlug]/analytics/top-items?take=10
// Top-selling items across all vendors in the fair by revenue.
// Cached 60s — invalidated on fair-analytics-{eventId} tag.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    const event = await db.event.findFirst({
      where: { urlSlug: fairSlug, organizerId },
      select: { id: true },
    })
    if (!event) return apiError('Fair not found or access denied', 404, 'NOT_FOUND')

    const take = Math.min(Math.max(1, parseInt(req.nextUrl.searchParams.get('take') ?? '10', 10)), 25)

    const getTopItems = unstable_cache(
      async () => {
        const rows = await db.orderItem.groupBy({
          by: ['itemName'],
          where: {
            order: {
              eventId: event.id,
              status: { in: ['COMPLETED', 'DELIVERED'] },
            },
          },
          _sum:  { quantity: true, totalPrice: true },
          _count: { id: true },
          orderBy: { _sum: { totalPrice: 'desc' } },
          take,
        })
        return rows.map(r => ({
          name:     r.itemName,
          quantity: r._sum.quantity ?? 0,
          revenue:  parseFloat((r._sum.totalPrice ?? 0).toFixed(2)),
          orders:   r._count.id,
        }))
      },
      [`fair-top-items-${event.id}-${take}`],
      { revalidate: 60, tags: [`fair-analytics-${event.id}`] }
    )

    const items = await getTopItems()
    return success({ items })
  } catch (err) {
    return handleApiError(err)
  }
}
