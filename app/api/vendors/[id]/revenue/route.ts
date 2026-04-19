import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorAuth } from '@/lib/auth'

// GET /api/vendors/:id/revenue?period=7d|30d|90d
// Returns daily revenue aggregated for the Recharts bar chart.
// Response: { data: [{ date: 'Mon', revenue: 342.50 }, ...] }
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireVendorAuth()

    const { searchParams } = new URL(req.url)
    const rawPeriod = searchParams.get('period') ?? '7d'
    const days = rawPeriod === '30d' ? 30 : rawPeriod === '90d' ? 90 : 7

    const periodStart = new Date()
    periodStart.setUTCHours(0, 0, 0, 0)
    periodStart.setUTCDate(periodStart.getUTCDate() - (days - 1))

    if (!['7d', '30d', '90d'].includes(rawPeriod)) {
      return apiError('period must be 7d, 30d, or 90d', 400, 'VALIDATION_ERROR')
    }

    const orders = await db.order.findMany({
      where: {
        vendorId: params.id,
        status: { in: ['COMPLETED', 'DELIVERED'] },
        placedAt: { gte: periodStart },
      },
      select: { subtotal: true, placedAt: true },
    })

    // Build a map of date → revenue
    const revenueMap = new Map<string, number>()

    // Pre-fill all days with 0 so chart has no gaps
    for (let i = 0; i < days; i++) {
      const d = new Date(periodStart)
      d.setUTCDate(periodStart.getUTCDate() + i)
      revenueMap.set(d.toISOString().slice(0, 10), 0)
    }

    for (const o of orders) {
      const key = o.placedAt.toISOString().slice(0, 10)
      revenueMap.set(key, (revenueMap.get(key) ?? 0) + o.subtotal)
    }

    // Format date keys into display labels
    const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const data = Array.from(revenueMap.entries()).map(([isoDate, revenue]) => {
      const d = new Date(isoDate + 'T00:00:00Z')
      const label = days <= 7
        ? DAY_ABBR[d.getUTCDay()]
        : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
      return { day: label, revenue: parseFloat(revenue.toFixed(2)) }
    })

    return success({ data, period: rawPeriod, days })
  } catch (err) {
    return handleApiError(err)
  }
}
