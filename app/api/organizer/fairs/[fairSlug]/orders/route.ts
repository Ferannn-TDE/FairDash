import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { OrderStatus } from '@prisma/client'

const ALL_PAID_STATUSES: OrderStatus[] = [
  'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED',
  'COMPLETED', 'DELIVERED', 'CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE',
]

// GET /api/organizer/fairs/[fairSlug]/orders?status=...&take=50&cursor=<id>
// Returns paginated orders for a specific fair with optional status filter.
// Cursor-based pagination: pass nextCursor from the previous response as cursor.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    const event = await db.event.findFirst({
      where: { urlSlug: fairSlug, organizerId },
      select: { id: true },
    })
    if (!event) return apiError('Fair not found or access denied', 404, 'NOT_FOUND')

    const { searchParams } = req.nextUrl
    const take   = Math.min(Math.max(1, parseInt(searchParams.get('take') ?? '50', 10)), 100)
    const cursor = searchParams.get('cursor') ?? undefined

    const statusParam = searchParams.get('status') as OrderStatus | null
    const statusFilter: OrderStatus[] = statusParam && ALL_PAID_STATUSES.includes(statusParam)
      ? [statusParam]
      : ALL_PAID_STATUSES

    const orders = await db.order.findMany({
      where: { eventId: event.id, status: { in: statusFilter } },
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
        customerPhone: true,
        fulfillmentType: true,
        pickupLocation: true,
        vendor: { select: { id: true, name: true, boothNumber: true } },
        orderItems: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            specialInstructions: true,
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
      customerPhone: o.customerPhone,
      fulfillmentType: o.fulfillmentType,
      pickupLocation: o.pickupLocation,
      vendorId: o.vendor.id,
      vendorName: o.vendor.name,
      boothNumber: o.vendor.boothNumber,
      items: o.orderItems.map(i => ({
        id: i.id,
        name: i.menuItem.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        specialInstructions: i.specialInstructions,
      })),
    }))

    const nextCursor = orders.length === take ? orders[orders.length - 1].id : null

    return success({ orders: result, nextCursor })
  } catch (err) {
    return handleApiError(err)
  }
}
