import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import type { OrderDTO } from '@/types/order-dto'

// GET /api/orders/history
// Paginated order history with compound cursor (placedAt + id) and date filters.
// Returns up to 50 orders per page.
export async function GET(req: NextRequest) {
  try {
    const clerkId = await requireAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return success({ orders: [], nextCursor: null })

    const { searchParams } = new URL(req.url)
    const limit    = Math.min(parseInt(searchParams.get('limit') ?? '20'), 50)
    const cursorB64 = searchParams.get('cursor') ?? null
    const since    = searchParams.get('since')   // ISO date string
    const until    = searchParams.get('until')   // ISO date string

    // Decode compound cursor: base64-encoded JSON { placedAt: string, id: string }
    let cursor: { placedAt: Date; id: string } | undefined
    if (cursorB64) {
      try {
        const decoded = JSON.parse(Buffer.from(cursorB64, 'base64').toString('utf8'))
        cursor = { placedAt: new Date(decoded.placedAt), id: decoded.id }
      } catch {
        // malformed cursor — ignore, start from beginning
      }
    }

    const t0 = Date.now()

    const orders = await db.order.findMany({
      where: {
        customerId: dbUser.id,
        status: { not: 'PENDING_PAYMENT' },
        ...(since || until
          ? {
              placedAt: {
                ...(since ? { gte: new Date(since) } : {}),
                ...(until ? { lte: new Date(until) } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor && {
        skip:   1,
        cursor: { placedAt_id: cursor },
      }),
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

    const hasMore = orders.length > limit
    const page    = hasMore ? orders.slice(0, limit) : orders

    const dtos: OrderDTO[] = page.map(o => ({
      id:              o.id,
      status:          o.status,
      placedAt:        o.placedAt.toISOString(),
      total:           o.total,
      subtotal:        o.subtotal,
      fulfillmentType: o.fulfillmentType,
      vendor:          o.vendor
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

    let nextCursor: string | null = null
    if (hasMore) {
      const last = page[page.length - 1]
      nextCursor = Buffer.from(
        JSON.stringify({ placedAt: last.placedAt.toISOString(), id: last.id })
      ).toString('base64')
    }

    console.log(`[orders/history] query ${Date.now() - t0}ms, returned ${dtos.length}`)

    return success({ orders: dtos, nextCursor })
  } catch (err) {
    return handleApiError(err)
  }
}
