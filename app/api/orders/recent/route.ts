import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import type { OrderDTO } from '@/types/order-dto'

// GET /api/orders/recent
// Returns up to 10 orders from the last 30 days. Cached per user, invalidated on new order.
export async function GET() {
  try {
    const clerkId = await requireAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return success({ orders: [] })

    const getRecent = unstable_cache(
      async (userId: string): Promise<OrderDTO[]> => {
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

        const orders = await db.order.findMany({
          where: {
            customerId: userId,
            status:     { not: 'PENDING_PAYMENT' },
            placedAt:   { gte: since },
          },
          orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
          take:    10,
          include: {
            vendor: {
              select: {
                name:        true,
                boothNumber: true,
                event: {
                  select: {
                    id:           true,
                    name:         true,
                    urlSlug:      true,
                    primaryColor: true,
                    startDate:    true,
                  },
                },
              },
            },
            orderItems: {
              take:   4,
              select: {
                quantity: true,
                itemName: true,
                menuItem: { select: { name: true, vendor: { select: { name: true } } } },
              },
            },
          },
        })

        return orders.map(o => ({
          id:              o.id,
          status:          o.status,
          placedAt:        o.placedAt.toISOString(),
          total:           o.total,
          subtotal:        o.subtotal,
          fulfillmentType: o.fulfillmentType,
          vendor: o.vendor
            ? {
                name:        o.vendor.name,
                boothNumber: o.vendor.boothNumber,
                event:       o.vendor.event
                  ? { ...o.vendor.event, startDate: o.vendor.event.startDate.toISOString() }
                  : null,
              }
            : null,
          items: o.orderItems.map(oi => ({
            quantity:   oi.quantity,
            itemName:   oi.itemName ?? oi.menuItem?.name ?? '',
            vendorName: oi.menuItem?.vendor?.name ?? null,
          })),
        }))
      },
      [`orders-recent`],
      { tags: [`orders-${dbUser.id}`], revalidate: 60 }
    )

    const orders = await getRecent(dbUser.id)
    return success({ orders })
  } catch (err) {
    return handleApiError(err)
  }
}
