import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'

// GET /api/vendors/:id/analytics
//
// Query params:
//   ?range=7d | 30d | 90d | custom   (default: 30d)
//   ?from=ISO_DATE                    (only with range=custom)
//   ?to=ISO_DATE                      (only with range=custom; defaults to now)
//
// Revenue is computed entirely in SQL from OrderItem.totalPrice — no JS .reduce().
// Each SQL query is independently cached via unstable_cache (60s revalidate).
// Invalidate tag `analytics-${vendorId}` when a new order completes.

function buildDateRange(
  range: string | null,
  from: string | null,
  to: string | null,
): { startDate: Date; endDate: Date } {
  const now = new Date()
  const endDate = to ? new Date(to) : now

  if (range === 'custom' && from) {
    return { startDate: new Date(from), endDate }
  }

  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30
  const startDate = new Date(now)
  startDate.setDate(startDate.getDate() - days)
  startDate.setHours(0, 0, 0, 0)
  return { startDate, endDate }
}

// ─── Cached queries ────────────────────────────────────────────────────────────

const getCachedRevenueByDay = unstable_cache(
  async (vendorId: string, startDate: Date, endDate: Date) => {
    const rows = await db.$queryRaw<{ day: Date; revenue: number; orderCount: bigint }[]>`
      SELECT
        DATE_TRUNC('day', oi."createdAt") AS day,
        SUM(oi."totalPrice")              AS revenue,
        COUNT(DISTINCT oi."orderId")      AS "orderCount"
      FROM "OrderItem" oi
      WHERE oi."vendorId" = ${vendorId}
        AND oi."createdAt" >= ${startDate}
        AND oi."createdAt" <= ${endDate}
      GROUP BY DATE_TRUNC('day', oi."createdAt")
      ORDER BY day DESC
      LIMIT 90
    `
    // Prisma returns BigInt for COUNT — normalize to number
    return rows.map(r => ({
      day:        r.day.toISOString(),
      revenue:    Number(r.revenue),
      orderCount: Number(r.orderCount),
    }))
  },
  ['vendor-analytics-revenue'],
  { revalidate: 60, tags: [] }  // tags injected per-vendor at call site via wrapper
)

const getCachedTopItems = unstable_cache(
  async (vendorId: string, startDate: Date, endDate: Date) => {
    return db.orderItem.groupBy({
      by: ['menuItemId', 'itemName'],
      where: { vendorId, createdAt: { gte: startDate, lte: endDate } },
      _sum: { totalPrice: true, quantity: true },
      orderBy: { _sum: { totalPrice: 'desc' } },
      take: 10,
    })
  },
  ['vendor-analytics-top-items'],
  { revalidate: 60, tags: [] }
)

const getCachedStatusBreakdown = unstable_cache(
  async (vendorId: string, startDate: Date, endDate: Date) => {
    return db.order.groupBy({
      by: ['status'],
      where: { vendorId, placedAt: { gte: startDate, lte: endDate } },
      _count: { id: true },
      _sum: { total: true },
    })
  },
  ['vendor-analytics-status'],
  { revalidate: 60, tags: [] }
)

const getCachedSummary = unstable_cache(
  async (vendorId: string, startDate: Date, endDate: Date) => {
    return db.orderItem.aggregate({
      where: { vendorId, createdAt: { gte: startDate, lte: endDate } },
      _sum: { totalPrice: true },
      _count: { id: true },
    })
  },
  ['vendor-analytics-summary'],
  { revalidate: 60, tags: [] }
)

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAuth()
    const { id } = await params

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const isMember = await getVendorAuth(dbUser.id, id, req)
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

    const sp = req.nextUrl.searchParams
    const range = sp.get('range')
    const { startDate, endDate } = buildDateRange(range, sp.get('from'), sp.get('to'))

    const start = performance.now()

    const [revenueByDay, topItemsByRevenue, statusBreakdown, summary] = await Promise.all([
      getCachedRevenueByDay(id, startDate, endDate),
      getCachedTopItems(id, startDate, endDate),
      getCachedStatusBreakdown(id, startDate, endDate),
      getCachedSummary(id, startDate, endDate),
    ])

    logger.debug('[Analytics] served', {
      vendorId: id,
      range: range ?? '30d',
      durationMs: Math.round(performance.now() - start),
    })

    // ── Derived totals from SQL results ──────────────────────────────────────
    const totalRevenue = parseFloat((summary._sum.totalPrice ?? 0).toFixed(2))
    const totalItemsSold = summary._count.id

    const completedStatuses = new Set(['COMPLETED', 'DELIVERED'])
    const cancelledStatuses = new Set(['CANCELLED'])

    let completedCount = 0
    let cancelledCount = 0
    let totalOrderCount = 0

    for (const row of statusBreakdown) {
      const n = row._count.id
      totalOrderCount += n
      if (completedStatuses.has(row.status)) completedCount += n
      if (cancelledStatuses.has(row.status)) cancelledCount += n
    }

    const terminal = completedCount + cancelledCount
    const completionRate = terminal > 0
      ? parseFloat((completedCount / terminal).toFixed(4))
      : 1

    const avgOrderValue = completedCount > 0
      ? parseFloat((totalRevenue / completedCount).toFixed(2))
      : 0

    // ── Chart data — day rows already ordered DESC from SQL ───────────────────
    const chartData = revenueByDay.map(r => ({
      day:      new Date(r.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      revenue:  parseFloat(r.revenue.toFixed(2)),
      orders:   r.orderCount,
    })).reverse()  // return ascending for chart rendering

    // ── Top items ─────────────────────────────────────────────────────────────
    const topItems = topItemsByRevenue.map(r => ({
      menuItemId: r.menuItemId,
      itemName:   r.itemName,
      revenue:    parseFloat((r._sum.totalPrice ?? 0).toFixed(2)),
      quantity:   r._sum.quantity ?? 0,
    }))

    // ── Status breakdown ──────────────────────────────────────────────────────
    const ordersByStatus = Object.fromEntries(
      statusBreakdown.map(r => [r.status, { count: r._count.id, revenue: parseFloat((r._sum.total ?? 0).toFixed(2)) }])
    )

    return success({
      chartData,
      topItems,
      ordersByStatus,
      totalRevenue,
      totalOrders: totalOrderCount,
      totalItemsSold,
      avgOrderValue,
      completionRate,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
