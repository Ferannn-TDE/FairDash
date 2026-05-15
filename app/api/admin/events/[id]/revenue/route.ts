import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'
import { OrderStatus } from '@prisma/client'

// GET /api/admin/events/[id]/revenue?period=7d|30d|90d
// Returns daily revenue aggregated across ALL vendors in the event.
// Accepts event UUID or urlSlug as [id]. Used by organizer analytics chart.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminAuth()

    const { searchParams } = new URL(req.url)
    const rawPeriod = searchParams.get('period') ?? '7d'

    if (!['7d', '30d', '90d'].includes(rawPeriod)) {
      return apiError('period must be 7d, 30d, or 90d', 400, 'VALIDATION_ERROR')
    }

    const days = rawPeriod === '90d' ? 90 : rawPeriod === '30d' ? 30 : 7

    // Accept both UUID and urlSlug
    const event = await db.event.findFirst({
      where: { OR: [{ id: (await params).id }, { urlSlug: (await params).id }] },
      select: { id: true },
    })
    if (!event) throw new ApiError('Event not found', 404, 'EVENT_NOT_FOUND')

    const periodStart = new Date()
    periodStart.setUTCHours(0, 0, 0, 0)
    periodStart.setUTCDate(periodStart.getUTCDate() - (days - 1))

    const orders = await db.order.findMany({
      where: {
        eventId: event.id,
        status: { in: [OrderStatus.COMPLETED, OrderStatus.DELIVERED] },
        placedAt: { gte: periodStart },
      },
      select: { subtotal: true, placedAt: true },
    })

    // Pre-fill all days with 0 so chart has no gaps
    const revenueMap = new Map<string, number>()
    for (let i = 0; i < days; i++) {
      const d = new Date(periodStart)
      d.setUTCDate(periodStart.getUTCDate() + i)
      revenueMap.set(d.toISOString().slice(0, 10), 0)
    }

    for (const o of orders) {
      const key = o.placedAt.toISOString().slice(0, 10)
      revenueMap.set(key, (revenueMap.get(key) ?? 0) + o.subtotal)
    }

    const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const data = Array.from(revenueMap.entries()).map(([isoDate, revenue]) => {
      const d = new Date(isoDate + 'T00:00:00Z')
      const label =
        days <= 7
          ? DAY_ABBR[d.getUTCDay()]
          : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
      return { day: label, revenue: parseFloat(revenue.toFixed(2)) }
    })

    return success({ data, period: rawPeriod, days })
  } catch (err) {
    return handleApiError(err)
  }
}
