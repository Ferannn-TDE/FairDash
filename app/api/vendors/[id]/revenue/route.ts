import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { logger } from '@/lib/logger'
import { requireVendorAuth, requireVendorMembership } from '@/lib/auth'
import { FLAGS } from '@/lib/feature-flags'
import { IN_MODEL_ORDERS } from '@/lib/order-scope'

// GET /api/vendors/:id/revenue?range=7d|30d|90d
//                            ?from=ISO&to=ISO   (custom range)
//                            ?period=7d|30d|90d (legacy alias, still accepted)
//
// Returns per-day revenue aggregated in SQL from OrderItem.totalPrice
// (vendor-scoped — correct for multi-vendor orders).
// Response: { revenueByDay, totalRevenue, avgOrderValue, period }
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireVendorAuth()
    const vendorId = (await params).id
    await requireVendorMembership(clerkId, vendorId)

    const { searchParams } = new URL(req.url)

    // ── Feature flag fallback ──────────────────────────────────────────────────
    if (!FLAGS.USE_SQL_VENDOR_REVENUE) {
      const rawPeriod = searchParams.get('period') ?? searchParams.get('range') ?? '7d'
      const days = rawPeriod === '30d' ? 30 : rawPeriod === '90d' ? 90 : 7

      const periodStart = new Date()
      periodStart.setUTCHours(0, 0, 0, 0)
      periodStart.setUTCDate(periodStart.getUTCDate() - (days - 1))

      if (!['7d', '30d', '90d'].includes(rawPeriod)) {
        return apiError('period must be 7d, 30d, or 90d', 400, 'VALIDATION_ERROR')
      }

      const orders = await db.order.findMany({
        where: {
          ...IN_MODEL_ORDERS,
          vendorId,
          status: { in: ['COMPLETED', 'DELIVERED'] },
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
      const data = Array.from(revenueMap.entries()).map(([isoDate, revenue]) => {
        const d = new Date(isoDate + 'T00:00:00Z')
        const label = days <= 7
          ? DAY_ABBR[d.getUTCDay()]
          : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
        return { day: label, revenue: parseFloat(revenue.toFixed(2)) }
      })

      return success({ data, period: rawPeriod, days })
    }

    // ── SQL implementation ─────────────────────────────────────────────────────

    // Resolve date range — custom ?from/to takes precedence over ?range/?period
    const fromParam  = searchParams.get('from')
    const toParam    = searchParams.get('to')
    const rangeParam = searchParams.get('range') ?? searchParams.get('period') ?? '30d'

    let startDate: Date
    let endDate: Date
    let period: string

    if (fromParam && toParam) {
      startDate = new Date(fromParam)
      endDate   = new Date(toParam)
      period    = 'custom'
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return apiError('Invalid from/to date format — use ISO 8601', 400, 'VALIDATION_ERROR')
      }
    } else {
      if (!['7d', '30d', '90d'].includes(rangeParam)) {
        return apiError('range must be 7d, 30d, or 90d', 400, 'VALIDATION_ERROR')
      }
      const days = rangeParam === '90d' ? 90 : rangeParam === '30d' ? 30 : 7
      endDate   = new Date()
      startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000)
      startDate.setUTCHours(0, 0, 0, 0)
      period = rangeParam
    }

    const t0 = Date.now()

    const getCachedRevenue = unstable_cache(
      async (vid: string, startIso: string, endIso: string) => {
        const startDate = new Date(startIso)
        const endDate   = new Date(endIso)

        // Revenue per day — uses OrderItem.totalPrice scoped to vendorId
        // so multi-vendor orders are split correctly (unlike order.subtotal).
        // $queryRaw tagged template: all interpolated values are parameterized.
        const rows = await db.$queryRaw<{ day: Date; revenue: number; orderCount: bigint }[]>`
          SELECT
            DATE_TRUNC('day', o."placedAt") AS day,
            SUM(oi."totalPrice")            AS revenue,
            COUNT(DISTINCT o.id)            AS "orderCount"
          FROM "Order" o
          JOIN "OrderItem" oi ON oi."orderId" = o.id
          WHERE oi."vendorId"  = ${vid}
            AND o.status       IN ('COMPLETED', 'DELIVERED')
            AND o."placedAt"  >= ${startDate}
            AND o."placedAt"  <= ${endDate}
          GROUP BY DATE_TRUNC('day', o."placedAt")
          ORDER BY day DESC
          LIMIT 90
        `

        // Normalize: Prisma returns BigInt for COUNT
        const revenueByDay = rows.map(r => ({
          day:        r.day.toISOString().slice(0, 10),
          revenue:    parseFloat(Number(r.revenue).toFixed(2)),
          orderCount: Number(r.orderCount),
        }))

        const totalRevenue  = parseFloat(revenueByDay.reduce((s, r) => s + r.revenue, 0).toFixed(2))
        const totalOrders   = revenueByDay.reduce((s, r) => s + r.orderCount, 0)
        const avgOrderValue = totalOrders > 0
          ? parseFloat((totalRevenue / totalOrders).toFixed(2))
          : 0

        return { revenueByDay, totalRevenue, totalOrders, avgOrderValue }
      },
      ['vendor-revenue'],
      { revalidate: 60, tags: [`revenue-${vendorId}`] }
    )

    const data = await getCachedRevenue(vendorId, startDate.toISOString(), endDate.toISOString())

    logger.debug('[Revenue] served', { vendorId, period, durationMs: Date.now() - t0 })

    return success({ ...data, period })
  } catch (err) {
    return handleApiError(err)
  }
}
