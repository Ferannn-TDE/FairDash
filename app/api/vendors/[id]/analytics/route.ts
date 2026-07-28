import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { sumVendorEarnings } from '@/lib/vendor-earnings'
import { logger } from '@/lib/logger'
import { requireVendorMembershipById } from '@/lib/auth'
import { isCompleted, isFailed } from '@/lib/order-status'
import { IN_MODEL_ORDERS } from '@/lib/order-scope'

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

function subDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - days)
  d.setHours(0, 0, 0, 0)
  return d
}

function buildDateRange(searchParams: URLSearchParams): { startDate: Date; endDate: Date } {
  const now   = new Date()
  const range = searchParams.get('range')
  const from  = searchParams.get('from')
  const to    = searchParams.get('to')

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const presets: Record<string, Date> = {
    today: startOfToday,
    '7d':  subDays(now, 7),
    '30d': subDays(now, 30),
    '90d': subDays(now, 90),
  }

  if (range && presets[range]) return { startDate: presets[range], endDate: now }
  if (from) return { startDate: new Date(from), endDate: to ? new Date(to) : now }

  // Default: today
  return { startDate: startOfToday, endDate: now }
}

// ─── Cached queries ────────────────────────────────────────────────────────────

// ─── Raw query functions (used directly on ?bust= requests) ───────────────────

async function queryRevenueByDay(vendorId: string, startDate: Date, endDate: Date) {
  // Only count items whose vendor portion reached COMPLETED or DELIVERED.
  // Joining VendorOrderStatus prevents declined/cancelled revenue from inflating totals.
  const rows = await db.$queryRaw<{ day: Date; revenue: number; orderCount: bigint }[]>`
    SELECT
      DATE_TRUNC('day', oi."createdAt") AS day,
      SUM(oi."totalPrice")              AS revenue,
      COUNT(DISTINCT oi."orderId")      AS "orderCount"
    FROM "OrderItem" oi
    JOIN "VendorOrderStatus" vos
      ON vos."orderId"  = oi."orderId"
     AND vos."vendorId" = oi."vendorId"
    WHERE oi."vendorId" = ${vendorId}
      AND oi."createdAt" >= ${startDate}
      AND oi."createdAt" <= ${endDate}
      AND vos.status IN ('COMPLETED', 'DELIVERED')
    GROUP BY DATE_TRUNC('day', oi."createdAt")
    ORDER BY day DESC
    LIMIT 90
  `
  return rows.map(r => ({
    day:        r.day.toISOString(),
    revenue:    Number(r.revenue),
    orderCount: Number(r.orderCount),
  }))
}

async function queryTopItems(vendorId: string, startDate: Date, endDate: Date) {
  return db.orderItem.groupBy({
    by: ['menuItemId', 'itemName'],
    where: {
      vendorId,
      createdAt: { gte: startDate, lte: endDate },
      order: { ...IN_MODEL_ORDERS, vendorOrderStatuses: { some: { vendorId, status: { in: ['COMPLETED', 'DELIVERED'] } } } },
    },
    _sum: { totalPrice: true, quantity: true },
    orderBy: { _sum: { totalPrice: 'desc' } },
    take: 10,
  })
}

async function queryStatusBreakdown(vendorId: string, startDate: Date, endDate: Date) {
  // Query VendorOrderStatus — not Order — so we count this vendor's portion
  // correctly even in multi-vendor orders where Order.vendorId is a different vendor.
  return db.vendorOrderStatus.groupBy({
    by: ['status'],
    where: {
      vendorId,
      order: { placedAt: { gte: startDate, lte: endDate } },
    },
    _count: { orderId: true },
  })
}

async function querySummary(vendorId: string, startDate: Date, endDate: Date) {
  return db.orderItem.aggregate({
    where: {
      vendorId,
      createdAt: { gte: startDate, lte: endDate },
      order: { ...IN_MODEL_ORDERS, vendorOrderStatuses: { some: { vendorId, status: { in: ['COMPLETED', 'DELIVERED'] } } } },
    },
    _sum: { totalPrice: true },
    _count: { id: true },
  })
}

// ─── Cached wrappers (10s TTL) ────────────────────────────────────────────────

const getCachedRevenueByDay    = unstable_cache(queryRevenueByDay,    ['vendor-analytics-revenue'],  { revalidate: 10, tags: [] })
const getCachedTopItems        = unstable_cache(queryTopItems,         ['vendor-analytics-top-items'], { revalidate: 10, tags: [] })
const getCachedStatusBreakdown = unstable_cache(queryStatusBreakdown, ['vendor-analytics-status'],    { revalidate: 10, tags: [] })
const getCachedSummary         = unstable_cache(querySummary,          ['vendor-analytics-summary'],   { revalidate: 10, tags: [] })

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await requireVendorMembershipById(id, req)

    const { startDate, endDate } = buildDateRange(req.nextUrl.searchParams)
    const bust = req.nextUrl.searchParams.has('bust')

    const start = performance.now()

    // ?bust bypasses unstable_cache — used by the manual refresh button so vendors
    // get an authoritative live DB read without waiting for cache expiry.
    const [revenueByDay, topItemsByRevenue, statusBreakdown, summary] = await Promise.all([
      bust ? queryRevenueByDay(id, startDate, endDate)    : getCachedRevenueByDay(id, startDate, endDate),
      bust ? queryTopItems(id, startDate, endDate)        : getCachedTopItems(id, startDate, endDate),
      bust ? queryStatusBreakdown(id, startDate, endDate) : getCachedStatusBreakdown(id, startDate, endDate),
      bust ? querySummary(id, startDate, endDate)         : getCachedSummary(id, startDate, endDate),
    ])

    logger.debug('[Analytics] served', {
      vendorId: id,
      range: req.nextUrl.searchParams.get('range') ?? 'today',
      durationMs: Math.round(performance.now() - start),
    })

    // ── Derived totals from SQL results ──────────────────────────────────────
    const totalRevenue    = parseFloat((summary._sum.totalPrice ?? 0).toFixed(2))
    const totalItemsSold  = summary._count.id

    // statusBreakdown now comes from VendorOrderStatus — counts are per-vendor.
    // _count.orderId is the correct field name after the groupBy change.
    let completedCount  = 0
    let failedCount     = 0
    let totalOrderCount = 0

    for (const row of statusBreakdown) {
      const n = row._count.orderId
      totalOrderCount += n
      if (isCompleted(row.status)) completedCount += n
      if (isFailed(row.status))    failedCount    += n
    }

    // terminal = completed + all failure modes (DECLINED, CANCELLED, etc.)
    const terminal = completedCount + failedCount
    // No data → 0%, not 100%. One decimal place (e.g. 83.3).
    const completionRate = terminal > 0
      ? Math.round((completedCount / terminal) * 100 * 10) / 10
      : 0

    // avgOrderValue: average of per-vendor item subtotals on completed orders only.
    // Raw SQL because Prisma groupBy can't express SUM-then-AVG in one query.
    // Filters on VendorOrderStatus.status = COMPLETED so we only average fulfilled orders.
    const avgResult = await db.$queryRaw<{ avg: number }[]>`
      SELECT COALESCE(AVG(sub."vendorSubtotal"), 0) AS avg
      FROM (
        SELECT SUM(oi."totalPrice") AS "vendorSubtotal"
        FROM "OrderItem" oi
        JOIN "Order" o ON o.id = oi."orderId"
        JOIN "VendorOrderStatus" vos
          ON vos."orderId"  = oi."orderId"
         AND vos."vendorId" = oi."vendorId"
        WHERE oi."vendorId" = ${id}
          AND o."placedAt"  >= ${startDate}
          AND o."placedAt"  <= ${endDate}
          AND vos.status    = 'COMPLETED'
        GROUP BY oi."orderId"
      ) sub
    `
    const avgOrderValue = parseFloat(Number(avgResult[0]?.avg ?? 0).toFixed(2))

    // ── TAKE-HOME earnings (the one shared helper) — settled vs estimated split.
    // NOT blended with the gross "revenue/sales" totals above. settled =
    // Payout.netAmount; estimated = slice − conservative Stripe-fee share.
    const earningsOrders = await db.order.findMany({
      where: { ...IN_MODEL_ORDERS, orderItems: { some: { vendorId: id } }, placedAt: { gte: startDate, lte: endDate } },
      select: {
        total: true,
        vendorOrderStatuses: { where: { vendorId: id }, select: { vendorId: true, status: true } },
        payouts: { where: { vendorId: id }, select: { vendorId: true, netAmount: true, reversedAt: true, stripeTransferId: true } },
        refunds: { where: { vendorId: id }, select: { vendorId: true, status: true, amountCents: true } },
        orderItems: { select: { vendorId: true, subtotal: true } },
      },
      take: 2000,
    })
    const earn = sumVendorEarnings(earningsOrders, id)

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
    // VendorOrderStatus has no total/revenue field — count only.
    const ordersByStatus = Object.fromEntries(
      statusBreakdown.map(r => [r.status, { count: r._count.orderId }])
    )

    return success({
      chartData,
      topItems,
      ordersByStatus,
      totalRevenue,          // GROSS sales volume (customer-paid subtotals) — NOT take-home
      totalOrders: totalOrderCount,
      totalItemsSold,
      avgOrderValue,
      completionRate,
      // Take-home, split (never blended). earned = settled cash in Stripe balance;
      // pending = conservative estimate not yet transferred.
      earned:   parseFloat((earn.settledCents / 100).toFixed(2)),
      pending:  parseFloat((earn.estimatedCents / 100).toFixed(2)),
      refunded: parseFloat((earn.refundedCents / 100).toFixed(2)),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
