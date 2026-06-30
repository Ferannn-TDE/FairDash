import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorMembershipById } from '@/lib/auth'
import { computeVendorOrderEarnings } from '@/lib/vendor-earnings'
import { logger } from '@/lib/logger'

// Terminal VendorOrderStatus values + master order CANCELLED
const TERMINAL_VENDOR_STATUSES = ['COMPLETED', 'DECLINED']

// GET /api/vendors/:id/orders/history?take=50&cursor=<id>
// Returns completed/declined/cancelled orders for this vendor, newest first.
// Cursor-based pagination — pass nextCursor from the previous response as cursor.
// Hard cap: 50 rows per page.
// No menuItem join — itemName is a denormalized snapshot on OrderItem.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = performance.now()

  try {
    const vendorId = (await params).id
    await requireVendorMembershipById(vendorId, req)

    const { searchParams } = new URL(req.url)
    const take   = Math.min(Math.max(1, parseInt(searchParams.get('take') ?? '50', 10)), 50)
    const cursor = searchParams.get('cursor') ?? undefined

    // Optional filters
    const statusParam = searchParams.get('status')
    const statuses    = statusParam ? statusParam.split(',').map(s => s.trim()).filter(Boolean) : []
    const rangeParm   = searchParams.get('range')
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    const orders = await db.order.findMany({
      where: {
        orderItems: { some: { vendorId } },
        ...(rangeParm === 'today' ? { placedAt: { gte: startOfToday } } : {}),
        OR: [
          {
            vendorOrderStatuses: {
              some: {
                vendorId,
                status: { in: statuses.length ? statuses : TERMINAL_VENDOR_STATUSES },
              },
            },
          },
          { status: 'CANCELLED' },
        ],
      },
      orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
      take,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      select: {
        id: true,
        status: true,
        placedAt: true,
        fulfillmentType: true,
        customerName: true,
        customerPhone: true,
        total: true,
        vendorOrderStatuses: {
          where: { vendorId },
          select: { vendorId: true, status: true },
        },
        payouts: { where: { vendorId }, select: { vendorId: true, netAmount: true, reversedAt: true } },
        refunds: { where: { vendorId }, select: { vendorId: true, status: true, amountCents: true } },
        // ALL items (every vendor) — the earnings helper needs the full per-vendor
        // split to compute this vendor's proportional Stripe-fee share.
        orderItems: {
          select: {
            id: true, quantity: true, unitPrice: true, totalPrice: true, subtotal: true,
            itemName: true, vendorId: true,
          },
        },
      },
    })

    // EARNINGS = take-home, via the single shared helper (lib/vendor-earnings).
    // settled = Payout.netAmount; estimated = slice − conservative Stripe-fee
    // share; $0 if refunded/reversed/declined. Never the gross subtotal.
    const result = orders.map(o => {
      const myItems = o.orderItems.filter(i => i.vendorId === vendorId)
      const vendorSubtotal = myItems.reduce((s, i) => s + (i.totalPrice ?? i.unitPrice * i.quantity), 0)
      const earn = computeVendorOrderEarnings(o, vendorId)

      return {
        id:           o.id,
        status:       o.vendorOrderStatuses[0]?.status ?? o.status,
        fulfillmentType: o.fulfillmentType,
        customerName:  o.customerName,
        customerPhone: o.customerPhone,
        // Gross slice (what the customer paid for this vendor's items) — kept for
        // the line-item breakdown, clearly NOT the take-home figure.
        vendorSubtotal: parseFloat(vendorSubtotal.toFixed(2)),
        // Take-home + its honesty status. Displays show this, not the gross.
        earnings:       parseFloat((earn.cents / 100).toFixed(2)),
        earningsStatus: earn.status, // settled | estimated | refunded | reversed | declined
        placedAt:     o.placedAt,
        orderItems:   myItems.map(i => ({
          id:        i.id,
          quantity:  i.quantity,
          unitPrice: i.unitPrice,
          itemName:  i.itemName,
        })),
      }
    })

    const nextCursor = orders.length === take ? orders[orders.length - 1].id : null

    logger.debug('[vendor/orders/history] served', {
      durationMs: Math.round(performance.now() - start),
      rowCount: result.length,
    })

    return success({ orders: result, nextCursor })
  } catch (err) {
    return handleApiError(err)
  }
}
