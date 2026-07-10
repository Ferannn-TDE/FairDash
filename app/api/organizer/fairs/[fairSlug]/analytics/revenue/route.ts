import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { resolveOwnedFair } from '@/lib/organizer-fair-context'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { OrderStatus } from '@prisma/client'

async function computeRevenueSeries(eventId: string, days: number) {
  const periodStart = new Date()
  periodStart.setUTCHours(0, 0, 0, 0)
  periodStart.setUTCDate(periodStart.getUTCDate() - (days - 1))

  const orders = await db.order.findMany({
    where: {
      eventId,
      status: { in: [OrderStatus.COMPLETED, OrderStatus.DELIVERED] },
      placedAt: { gte: periodStart },
    },
    select: { subtotal: true, placedAt: true },
  })

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
  return Array.from(revenueMap.entries()).map(([isoDate, revenue]) => {
    const d = new Date(isoDate + 'T00:00:00Z')
    const label = days <= 7 ? DAY_ABBR[d.getUTCDay()] : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
    return { day: label, revenue: parseFloat(revenue.toFixed(2)) }
  })
}

// GET /api/organizer/fairs/[fairSlug]/analytics/revenue?period=7d|30d|90d
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    const { searchParams } = new URL(req.url)
    const rawPeriod = searchParams.get('period') ?? '7d'
    if (!['7d', '30d', '90d'].includes(rawPeriod)) {
      return apiError('period must be 7d, 30d, or 90d', 400, 'VALIDATION_ERROR')
    }

    const event = await resolveOwnedFair(fairSlug, organizerId)

    const days = rawPeriod === '90d' ? 90 : rawPeriod === '30d' ? 30 : 7

    const todayKey = new Date().toISOString().slice(0, 10)
    const cached = unstable_cache(
      () => computeRevenueSeries(event.id, days),
      [`org-analytics-revenue-${event.id}-${rawPeriod}-${todayKey}`],
      { revalidate: 60, tags: [`event-stats-${event.id}`] }
    )

    return success({ data: await cached(), period: rawPeriod, days })
  } catch (err) {
    return handleApiError(err)
  }
}
