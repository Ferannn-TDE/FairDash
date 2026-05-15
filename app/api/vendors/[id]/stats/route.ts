import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorAuth } from '@/lib/auth'

// GET /api/vendors/:id/stats
// Returns key performance metrics for the vendor dashboard.
// Scoped to today (midnight UTC) for today metrics, all-time for rates.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireVendorAuth()

    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)

    const [allOrders, todayOrders] = await Promise.all([
      db.order.findMany({
        where: { vendorId: (await params).id },
        select: { status: true, subtotal: true },
      }),
      db.order.findMany({
        where: { vendorId: (await params).id, placedAt: { gte: todayStart } },
        select: { status: true, subtotal: true },
      }),
    ])

    const todayCompleted = todayOrders.filter(
      o => o.status === 'COMPLETED' || o.status === 'DELIVERED'
    )
    const todayRevenue = parseFloat(
      todayCompleted.reduce((s, o) => s + o.subtotal, 0).toFixed(2)
    )
    const todayOrderCount = todayOrders.length
    const avgOrderValue =
      todayCompleted.length > 0
        ? parseFloat((todayRevenue / todayCompleted.length).toFixed(2))
        : 0

    const totalOrders = allOrders.length
    const cancelledOrders = allOrders.filter(o => o.status === 'CANCELLED').length
    const cancellationRate =
      totalOrders > 0
        ? parseFloat((cancelledOrders / totalOrders).toFixed(4))
        : 0

    // Acceptance rate = (total - cancelled) / total (cancelled includes auto-cancels)
    const acceptedOrders = totalOrders - cancelledOrders
    const acceptanceRate =
      totalOrders > 0
        ? parseFloat((acceptedOrders / totalOrders).toFixed(4))
        : 1

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
