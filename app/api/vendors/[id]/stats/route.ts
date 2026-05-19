import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorAuth } from '@/lib/auth'

// GET /api/vendors/:id/stats
// Revenue and order counts scoped to this vendor's OrderItems only,
// so multi-vendor orders are split correctly.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireVendorAuth()
    const vendorId = (await params).id

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
        where: {
          vendorId,
          order: { placedAt: { gte: todayStart } },
        },
        select: {
          unitPrice: true,
          quantity: true,
          order: { select: { id: true, status: true } },
        },
      }),
    ])

    // Group by order — one row per order
    function groupByOrder(items: typeof allItems) {
      const map = new Map<string, { status: string; revenue: number }>()
      for (const item of items) {
        const { id, status } = item.order
        if (!map.has(id)) map.set(id, { status, revenue: 0 })
        map.get(id)!.revenue += item.unitPrice * item.quantity
      }
      return [...map.values()]
    }

    const allOrders = groupByOrder(allItems)
    const todayOrders = groupByOrder(todayItems)

    const todayCompleted = todayOrders.filter(
      o => o.status === 'COMPLETED' || o.status === 'DELIVERED'
    )
    const todayRevenue = parseFloat(
      todayCompleted.reduce((s, o) => s + o.revenue, 0).toFixed(2)
    )
    const todayOrderCount = todayOrders.length
    const avgOrderValue =
      todayCompleted.length > 0
        ? parseFloat((todayRevenue / todayCompleted.length).toFixed(2))
        : 0

    const totalOrders = allOrders.length
    const cancelledOrders = allOrders.filter(o => o.status === 'CANCELLED').length
    const cancellationRate =
      totalOrders > 0 ? parseFloat((cancelledOrders / totalOrders).toFixed(4)) : 0
    const acceptedOrders = totalOrders - cancelledOrders
    const acceptanceRate =
      totalOrders > 0 ? parseFloat((acceptedOrders / totalOrders).toFixed(4)) : 1

    const pendingOrders = todayOrders.filter(o =>
      ['PLACED', 'ACCEPTED', 'PREPARING'].includes(o.status)
    ).length

    return success({
      todayRevenue,
      todayOrders: todayOrderCount,
      avgOrderValue,
      cancellationRate,
      acceptanceRate,
      pendingOrders,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
