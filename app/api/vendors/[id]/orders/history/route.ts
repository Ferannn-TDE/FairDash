import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
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
    const clerkId  = await requireAuth()
    const vendorId = (await params).id

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const isMember = await getVendorAuth(dbUser.id, vendorId, req)
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

    const { searchParams } = new URL(req.url)
    const take   = Math.min(Math.max(1, parseInt(searchParams.get('take') ?? '50', 10)), 50)
    const cursor = searchParams.get('cursor') ?? undefined

    const orders = await db.order.findMany({
      where: {
        orderItems: { some: { vendorId } },
        OR: [
          {
            vendorOrderStatuses: {
              some: { vendorId, status: { in: TERMINAL_VENDOR_STATUSES } },
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
