import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { resolveOwnedFair } from '@/lib/organizer-fair-context'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { IN_MODEL_ORDERS } from '@/lib/order-scope'

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

    const event = await resolveOwnedFair(fairSlug, organizerId)

    const take = Math.min(Math.max(1, parseInt(req.nextUrl.searchParams.get('take') ?? '10', 10)), 25)

    const getTopItems = unstable_cache(
      async () => {
        const rows = await db.orderItem.groupBy({
          by: ['itemName'],
          where: {
            order: {
              // IN_MODEL_ORDERS — a voided order KEEPS its status, so without this a struck
              // test order's items still count toward top-item quantity and revenue. Found by
              // the ghost-guard walk; this surface was never on the old fixed file list.
              ...IN_MODEL_ORDERS,
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
