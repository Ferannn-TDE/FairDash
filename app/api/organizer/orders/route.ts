import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { OrderStatus } from '@prisma/client'

const PAID_STATUSES: OrderStatus[] = [
  'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED',
  'COMPLETED', 'DELIVERED', 'CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE',
]

// GET /api/organizer/orders?take=20&cursor=<id>&fairId=<optional>
// Returns paginated orders across all organizer's fairs (or scoped to a fairId).
// Cursor-based pagination: pass nextCursor from the previous response as cursor.
export async function GET(req: NextRequest) {
  try {
    const { organizerId } = await requireOrganizerAuth()

    const { searchParams } = req.nextUrl
    const take   = Math.min(Math.max(1, parseInt(searchParams.get('take') ?? '20', 10)), 100)
    const cursor = searchParams.get('cursor') ?? undefined
    const fairId = searchParams.get('fairId') ?? undefined

    // Resolve event IDs for this organizer
    let eventIds: string[]
    if (fairId) {
      const event = await db.event.findFirst({
        where: { id: fairId, organizerId, archivedAt: null },
        select: { id: true },
      })
      if (!event) return apiError('Fair not found or access denied', 404, 'NOT_FOUND')
      eventIds = [fairId]
    } else {
      const events = await db.event.findMany({
        where: { organizerId, archivedAt: null },
        select: { id: true },
      })
      eventIds = events.map(e => e.id)
    }

    const orders = await db.order.findMany({
      where: { eventId: { in: eventIds }, status: { in: PAID_STATUSES } },
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
        fairSynqFee: true,
        placedAt: true,
        customerName: true,
        vendor: { select: { id: true, name: true, boothNumber: true } },
        event:  { select: { id: true, name: true } },
        orderItems: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            menuItem: { select: { name: true } },
          },
        },
      },
    })

    const result = orders.map(o => ({
      id: o.id,
      status: o.status,
      total: o.total,
      subtotal: o.subtotal,
      vendorPayout: o.vendorPayout,
      fairSynqFee: o.fairSynqFee,
      placedAt: o.placedAt,
      customerName: o.customerName,
      vendorId: o.vendor.id,
      vendorName: o.vendor.name,
      boothNumber: o.vendor.boothNumber,
      fairId: o.event.id,
      fairName: o.event.name,
      items: o.orderItems.map(i => ({
        id: i.id,
        name: i.menuItem.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
    }))

    const nextCursor = orders.length === take ? orders[orders.length - 1].id : null

    return success({ orders: result, nextCursor })
  } catch (err) {
    return handleApiError(err)
  }
}
