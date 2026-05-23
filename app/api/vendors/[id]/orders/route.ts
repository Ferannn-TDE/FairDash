import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/vendors/:id/orders?limit=100&history=1
// Default (no history param): active orders (VendorOrderStatus not COMPLETED/DECLINED)
//   + today's completed/declined. Used by the kanban dashboard.
// history=1: all orders regardless of date or status. Used by the Order History page.
// OrderItems are filtered to only this vendor's items.
// Caller must be a VendorMember of this vendor.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAuth()
    const vendorId = (await params).id

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const isMember = await db.vendorMember.findFirst({
      where: { vendorId, userId: dbUser.id },
    })
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

    const { searchParams } = new URL(req.url)
    const limit = Math.min(500, parseInt(searchParams.get('limit') ?? '100'))
    const historyMode = searchParams.get('history') === '1'

    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)

    const orders = await db.order.findMany({
      where: historyMode
        ? {
            // History page: all orders for this vendor, no date restriction
            orderItems: { some: { vendorId } },
            status: { not: 'PENDING_PAYMENT' },
          }
        : {
            // Dashboard: active workflow orders + today's completed/declined
            orderItems: { some: { vendorId } },
            status: { not: 'PENDING_PAYMENT' },
            OR: [
              {
                vendorOrderStatuses: {
                  some: {
                    vendorId,
                    status: { notIn: ['COMPLETED', 'DECLINED'] },
                  },
                },
              },
              { placedAt: { gte: todayStart } },
            ],
          },
      orderBy: { placedAt: 'desc' },
      take: limit,
      include: {
        orderItems: {
          where: { vendorId },
          include: { menuItem: { select: { name: true } } },
        },
        vendorOrderStatuses: {
          where: { vendorId },
          select: { status: true },
        },
      },
    })

    // Shape each order:
    //   • status  → this vendor's own VendorOrderStatus (not master order status)
    //   • subtotal/total → recomputed from this vendor's items only
    const shaped = orders.map(order => {
      const vendorSubtotal = order.orderItems.reduce(
        (s, i) => s + i.unitPrice * i.quantity,
        0
      )
      const vendorStatus = order.vendorOrderStatuses[0]?.status ?? order.status
      return {
        ...order,
        status: vendorStatus as typeof order.status,
        subtotal: parseFloat(vendorSubtotal.toFixed(2)),
        total: parseFloat(vendorSubtotal.toFixed(2)),
        vendorPayout: order.subtotal > 0
          ? parseFloat((vendorSubtotal * (order.vendorPayout / order.subtotal)).toFixed(2))
          : 0,
      }
    })

    return success({ orders: shaped })
  } catch (err) {
    return handleApiError(err)
  }
}
