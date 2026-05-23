import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { OrderStatus } from '@prisma/client'

const PAID_STATUSES: OrderStatus[] = [
  'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED',
  'COMPLETED', 'DELIVERED', 'CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE',
]

// GET /api/organizer/orders?limit=20&fairId=<optional>
// Returns recent orders across all organizer's fairs (or scoped to a fairId)
export async function GET(req: NextRequest) {
  try {
    const clerkId = await requireAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('Forbidden', 403, 'FORBIDDEN')

    const orgMember = await db.orgMember.findFirst({ where: { userId: dbUser.id } })
    if (!orgMember) return apiError('Forbidden', 403, 'FORBIDDEN')

    const { searchParams } = req.nextUrl
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
    const fairId = searchParams.get('fairId') ?? undefined

    // Resolve event IDs for this organizer
    let eventIds: string[]
    if (fairId) {
      const event = await db.event.findFirst({ where: { id: fairId, organizerId: orgMember.organizerId } })
      if (!event) return apiError('Fair not found or access denied', 404, 'NOT_FOUND')
      eventIds = [fairId]
    } else {
      const events = await db.event.findMany({
        where: { organizerId: orgMember.organizerId },
        select: { id: true },
      })
      eventIds = events.map(e => e.id)
    }

    const orders = await db.order.findMany({
      where: { eventId: { in: eventIds }, status: { in: PAID_STATUSES } },
      orderBy: { placedAt: 'desc' },
      take: limit,
      include: {
        vendor: { select: { id: true, name: true, boothNumber: true } },
        event: { select: { id: true, name: true } },
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

    return success({ orders: result })
  } catch (err) {
    return handleApiError(err)
  }
}
