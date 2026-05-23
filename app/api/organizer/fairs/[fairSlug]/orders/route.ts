import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { OrderStatus } from '@prisma/client'

const ALL_PAID_STATUSES: OrderStatus[] = [
  'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED',
  'COMPLETED', 'DELIVERED', 'CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE',
]

// GET /api/organizer/fairs/[fairSlug]/orders?status=PLACED|ACCEPTED|...
// Returns orders for a specific fair with optional status filter
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const clerkId = await requireAuth()
    const { fairSlug } = await params

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('Forbidden', 403, 'FORBIDDEN')

    const orgMember = await db.orgMember.findFirst({ where: { userId: dbUser.id } })
    if (!orgMember) return apiError('Forbidden', 403, 'FORBIDDEN')

    // Verify this organizer owns this event
    const event = await db.event.findFirst({
      where: { urlSlug: fairSlug, organizerId: orgMember.organizerId },
    })
    if (!event) return apiError('Fair not found or access denied', 404, 'NOT_FOUND')

    const statusParam = req.nextUrl.searchParams.get('status') as OrderStatus | null
    const statusFilter: OrderStatus[] = statusParam && ALL_PAID_STATUSES.includes(statusParam)
      ? [statusParam]
      : ALL_PAID_STATUSES

    const orders = await db.order.findMany({
      where: { eventId: event.id, status: { in: statusFilter } },
      orderBy: { placedAt: 'desc' },
      include: {
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

    return success({ orders: result })
  } catch (err) {
    return handleApiError(err)
  }
}
