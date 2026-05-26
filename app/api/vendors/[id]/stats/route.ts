import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorAuth, requireVendorMembership } from '@/lib/auth'
import { FLAGS } from '@/lib/feature-flags'

// GET /api/vendors/:id/stats?range=24h|7d|30d
// Revenue and order counts computed entirely in SQL — no JS aggregation.
// Scoped to this vendor's OrderItems so multi-vendor orders are split correctly.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireVendorAuth()
    const vendorId = (await params).id
    await requireVendorMembership(clerkId, vendorId)

    // ── Feature flag fallback ──────────────────────────────────────────────────
    if (!FLAGS.USE_SQL_VENDOR_STATS) {
      const todayStart = new Date()
      todayStart.setUTCHours(0, 0, 0, 0)

      const [allItems, todayItems] = await Promise.all([
        db.orderItem.findMany({
          where: { vendorId },
          select: {
            unitPrice: true,
            quantity: true,
            order: { select: { id: true, status: true } },
          },
        }),
        db.orderItem.findMany({
          where: { vendorId, order: { placedAt: { gte: todayStart } } },
          select: {
            unitPrice: true,
            quantity: true,
            order: { select: { id: true, status: true } },
          },
        }),
      ])

      function groupByOrder(items: typeof allItems) {
        const map = new Map<string, { status: string; revenue: number }>()
        for (const item of items) {
          const { id, status } = item.order
          if (!map.has(id)) map.set(id, { status, revenue: 0 })
          map.get(id)!.revenue += item.unitPrice * item.quantity
        }
        return [...map.values()]
      }

      const allOrders   = groupByOrder(allItems)
      const todayOrders = groupByOrder(todayItems)

      const todayCompleted   = todayOrders.filter(o => o.status === 'COMPLETED' || o.status === 'DELIVERED')
      const todayRevenue     = parseFloat(todayCompleted.reduce((s, o) => s + o.revenue, 0).toFixed(2))
      const todayOrderCount  = todayOrders.length
      const avgOrderValue    = todayCompleted.length > 0 ? parseFloat((todayRevenue / todayCompleted.length).toFixed(2)) : 0
      const totalOrders      = allOrders.length
      const cancelledOrders  = allOrders.filter(o => o.status === 'CANCELLED').length
      const cancellationRate = totalOrders > 0 ? parseFloat((cancelledOrders / totalOrders).toFixed(4)) : 0
      const acceptanceRate   = totalOrders > 0 ? parseFloat(((totalOrders - cancelledOrders) / totalOrders).toFixed(4)) : 1
      const pendingOrders    = todayOrders.filter(o => ['PLACED', 'ACCEPTED', 'PREPARING'].includes(o.status)).length

      return success({ todayRevenue, todayOrders: todayOrderCount, avgOrderValue, cancellationRate, acceptanceRate, pendingOrders })
    }

    // ── SQL implementation ─────────────────────────────────────────────────────

    const { searchParams } = new URL(req.url)
    const range = searchParams.get('range') ?? '30d'

    const now = new Date()
    const since: Date = (() => {
      if (range === '24h') return new Date(now.getTime() - 24 * 60 * 60 * 1000)
      if (range === '7d')  return new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000)
      return                      new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    })()

    const t0 = Date.now()

    const getCachedStats = unstable_cache(
      async (vid: string, sinceIso: string) => {
        const sinceDate = new Date(sinceIso)

        const [revenueAgg, [totalOrders, cancelledOrders], avgOrder, topItems, pendingCount] = await Promise.all([
          // Total revenue from COMPLETED items within range
          db.orderItem.aggregate({
            where: {
              vendorId: vid,
              createdAt: { gte: sinceDate },
              order: { status: { in: ['COMPLETED', 'DELIVERED'] } },
            },
            _sum:   { totalPrice: true },
            _count: { id: true },
          }),

          // Total and cancelled order counts within range (for rates)
          Promise.all([
            db.order.count({ where: { vendorId: vid, placedAt: { gte: sinceDate } } }),
            db.order.count({ where: { vendorId: vid, status: 'CANCELLED', placedAt: { gte: sinceDate } } }),
          ]),

          // Average order value (COMPLETED only)
          db.order.aggregate({
            where:  { vendorId: vid, status: { in: ['COMPLETED', 'DELIVERED'] }, placedAt: { gte: sinceDate } },
            _avg:   { total: true },
          }),

          // Top 5 selling items by revenue
          db.orderItem.groupBy({
            by:    ['menuItemId', 'itemName'],
            where: { vendorId: vid, createdAt: { gte: sinceDate } },
            _sum:  { quantity: true, totalPrice: true },
            orderBy: { _sum: { totalPrice: 'desc' } },
            take: 5,
          }),

          // Currently active orders (real-time — not cached separately)
          db.order.count({
            where: { vendorId: vid, status: { in: ['PLACED', 'ACCEPTED', 'PREPARING'] } },
          }),
        ])

        // Derive rates from SQL counts
        const cancellationRate = totalOrders > 0
          ? parseFloat((cancelledOrders / totalOrders).toFixed(4))
          : 0
        const acceptanceRate = totalOrders > 0
          ? parseFloat(((totalOrders - cancelledOrders) / totalOrders).toFixed(4))
          : 1

        const todayRevenue  = parseFloat((revenueAgg._sum.totalPrice ?? 0).toFixed(2))
        const avgOrderValue = parseFloat((avgOrder._avg.total ?? 0).toFixed(2))

        // Count orders (all statuses) within range
        const todayOrders = totalOrders

        return {
          todayRevenue,
          todayOrders,
          avgOrderValue,
          cancellationRate,
          acceptanceRate,
          pendingOrders: pendingCount,
          topItems: topItems.map(i => ({
            menuItemId: i.menuItemId,
            itemName:   i.itemName,
            quantity:   i._sum.quantity ?? 0,
            revenue:    parseFloat((i._sum.totalPrice ?? 0).toFixed(2)),
          })),
          range,
        }
      },
      ['vendor-stats'],
      { revalidate: 60, tags: [`stats-${vendorId}`] }
    )

    const stats = await getCachedStats(vendorId, since.toISOString())

    if (process.env.NODE_ENV === 'development') {
      console.log('[Stats]', { vendorId, range, durationMs: Date.now() - t0 })
    }

    return success(stats)
  } catch (err) {
    return handleApiError(err)
  }
}
