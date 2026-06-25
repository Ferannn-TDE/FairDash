import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { computeVendorOrderEarnings } from '@/lib/vendor-earnings'
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
        placedAt: true,
        total: true,
        vendorOrderStatuses: {
          where: { vendorId },
          select: { vendorId: true, status: true },
        },
        payouts: { where: { vendorId }, select: { vendorId: true, netAmount: true, reversedAt: true } },
        refunds: { where: { vendorId }, select: { vendorId: true, status: true, amountCents: true } },
        // ALL items — earnings helper needs the full split for the fee estimate.
        orderItems: {
          select: { id: true, quantity: true, unitPrice: true, subtotal: true, itemName: true, vendorId: true },
        },
      },
    })

    // Active orders are pre-payout → earnings are a conservative ESTIMATE
    // (slice − estimated Stripe-fee share), via the one shared helper. vendorSubtotal
    // is the gross slice (kept for line items); earnings is the take-home estimate.
    const result = orders.map(o => {
      const myItems = o.orderItems.filter(i => i.vendorId === vendorId)
      const earn = computeVendorOrderEarnings(o, vendorId)
      return {
        id: o.id,
        status: o.vendorOrderStatuses[0]?.status ?? o.status,
        vendorSubtotal: parseFloat(myItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0).toFixed(2)),
        earnings: parseFloat((earn.cents / 100).toFixed(2)),
        earningsStatus: earn.status, // 'estimated' for active orders
        placedAt: o.placedAt,
        orderItems: myItems.map(i => ({
          id: i.id,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          itemName: i.itemName,
        })),
      }
    })

    logger.debug('[vendor/orders/active] served', {
      durationMs: Math.round(performance.now() - start),
      rowCount: result.length,
    })

    return success({ orders: result })
  } catch (err) {
    return handleApiError(err)
  }
}
