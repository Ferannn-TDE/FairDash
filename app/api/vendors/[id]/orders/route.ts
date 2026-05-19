import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/vendors/:id/orders?since=ISO_DATE&limit=100
// Returns orders that contain at least one item belonging to this vendor.
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
    const sinceRaw = searchParams.get('since')
    const limit = Math.min(200, parseInt(searchParams.get('limit') ?? '100'))

    const sinceFilter: Date | undefined = sinceRaw === 'today'
      ? (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d })()
      : sinceRaw
      ? new Date(sinceRaw)
      : undefined

    const orders = await db.order.findMany({
      where: {
        orderItems: { some: { vendorId } },
        status: { not: 'PENDING_PAYMENT' },
        ...(sinceFilter ? { placedAt: { gte: sinceFilter } } : {}),
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
