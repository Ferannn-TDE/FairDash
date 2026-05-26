import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { logger } from '@/lib/logger'

// Active VendorOrderStatus values (string field, not enum)
const ACTIVE_VENDOR_STATUSES = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY']

// GET /api/vendors/:id/orders/active
// Returns the live kitchen queue for this vendor: orders where this vendor's
// VendorOrderStatus is still in an active (non-terminal) state.
// Ordered oldest-first so kitchen staff work top-to-bottom.
// Hard cap: 50 rows (active queue is always small; no pagination needed).
// No menuItem join — itemName is a denormalized snapshot on OrderItem.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = performance.now()

  try {
    const clerkId  = await requireAuth()
    const vendorId = (await params).id

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const isMember = await getVendorAuth(dbUser.id, vendorId, req)
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

    const orders = await db.order.findMany({
      where: {
        orderItems: { some: { vendorId } },
        vendorOrderStatuses: {
          some: { vendorId, status: { in: ACTIVE_VENDOR_STATUSES } },
        },
      },
      orderBy: [{ placedAt: 'asc' }],
      take: 50,
      select: {
        id: true,
        status: true,
        total: true,
        subtotal: true,
        vendorPayout: true,
        placedAt: true,
        vendorOrderStatuses: {
          where: { vendorId },
          select: { status: true },
        },
        orderItems: {
          where: { vendorId },
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            itemName: true,
          },
        },
      },
    })

    // Expose per-vendor status rather than master order status
    const result = orders.map(o => ({
      id: o.id,
      status: o.vendorOrderStatuses[0]?.status ?? o.status,
      total: o.total,
      subtotal: o.subtotal,
      vendorPayout: o.vendorPayout,
      placedAt: o.placedAt,
      orderItems: o.orderItems.map(i => ({
        id: i.id,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        itemName: i.itemName,
      })),
    }))

    logger.debug('[vendor/orders/active] served', {
      durationMs: Math.round(performance.now() - start),
      rowCount: result.length,
    })

    return success({ orders: result })
  } catch (err) {
    return handleApiError(err)
  }
}
