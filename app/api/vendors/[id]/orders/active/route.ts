import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorMembershipById } from '@/lib/auth'
import { computeVendorOrderEarnings } from '@/lib/vendor-earnings'
import { statusWhere, vendorOrderScope } from '@/lib/vendor-order-history'
import { logger } from '@/lib/logger'

// Active VendorOrderStatus values (string field, not enum).
// Exported so the divergence guard binds to the REAL set, never a drifting copy.
export const ACTIVE_VENDOR_STATUSES = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY']

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
    const vendorId = (await params).id
    await requireVendorMembershipById(vendorId, req)

    const orders = await db.order.findMany({
      where: {
        // ONE definition of "orders active for this vendor", shared verbatim with the
        // orders-page history query (lib/vendor-order-history). Two parts, both shared:
        //   • vendorOrderScope — this vendor's items, and NOT voided.
        //   • statusWhere — mirrors the displayed status `vendorOrderStatus ?? order.status`:
        //     this vendor's VOS row is active, OR (no VOS row AND master Order.status active).
        // A JOIN-only `some` here silently DROPPED orders with no VendorOrderStatus row — so a
        // PLACED order the vendor must accept was "Incoming 1" on the orders page yet invisible
        // on this live dashboard. Deriving both readers from the same two helpers means a future
        // reader can't re-introduce the split by forgetting either the fallback or the void filter.
        ...vendorOrderScope(vendorId),
        ...statusWhere(vendorId, ACTIVE_VENDOR_STATUSES),
      },
      orderBy: [{ placedAt: 'asc' }],
      take: 50,
      select: {
        id: true,
        status: true,
        placedAt: true,
        total: true,
        // The ready-lane gate ("runner completes this, not you") keys on fulfillmentType.
        // Without it here, REST-loaded orders had fulfillmentType undefined and the UI
        // gate was silently vacuous after a reload.
        fulfillmentType: true,
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
        fulfillmentType: o.fulfillmentType,
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

    // The event's curbside method, once at top level (same for every order at this fair) —
    // the dashboard needs it to apply the SAME isRunnerFulfilled predicate the vendor-status
    // route enforces, so the ready-lane button and the server gate cannot disagree.
    const vendorEvent = await db.vendor.findUnique({
      where: { id: vendorId },
      select: { event: { select: { fulfillmentConfig: { select: { curbsideMethod: true } } } } },
    })

    return success({ orders: result, curbsideMethod: vendorEvent?.event?.fulfillmentConfig?.curbsideMethod ?? null })
  } catch (err) {
    return handleApiError(err)
  }
}
