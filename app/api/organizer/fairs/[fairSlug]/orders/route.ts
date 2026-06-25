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

const PENDING_STATUSES: OrderStatus[] = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED']

// GET /api/organizer/fairs/[fairSlug]/orders
// ?tab=pending|issues        — shorthand multi-status groups
// ?status=PLACED|...         — single status filter
// ?vendorId=<id>             — filter to one vendor
// ?dateFrom=ISO&dateTo=ISO   — date range on placedAt
// ?take=50&cursor=<id>       — cursor pagination
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
    const take     = Math.min(Math.max(1, parseInt(searchParams.get('take') ?? '50', 10)), 100)
    const cursor   = searchParams.get('cursor') ?? undefined
    const vendorId = searchParams.get('vendorId') ?? undefined
    const dateFrom = searchParams.get('dateFrom') ?? undefined
    const dateTo   = searchParams.get('dateTo') ?? undefined

    let statusFilter: OrderStatus[]
    const tab = searchParams.get('tab')
    if (tab === 'pending') {
      statusFilter = PENDING_STATUSES
    } else if (tab === 'issues') {
      statusFilter = ['CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE']
    } else {
      const statusParam = searchParams.get('status') as OrderStatus | null
      statusFilter = statusParam && ALL_PAID_STATUSES.includes(statusParam)
        ? [statusParam]
        : ALL_PAID_STATUSES
    }

    const [orders, statusCounts, disputeCount] = await Promise.all([
      db.order.findMany({
        where: {
          eventId: event.id,
          status: { in: statusFilter },
          ...(vendorId ? { vendorId } : {}),
          ...(dateFrom || dateTo ? {
            placedAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo   ? { lte: new Date(dateTo)   } : {}),
            },
          } : {}),
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
          fairSynqFee: true,
          placedAt: true,
          customerName: true,
          customerPhone: true,
          fulfillmentType: true,
          pickupLocation: true,
          cancellationReason: true,
          cancelledBy: true,
          stripePaymentIntentId: true,
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
          disputes: {
            select: { id: true, status: true, reason: true },
            orderBy: { submittedAt: 'desc' },
            take: 1,
          },
        },
      }),
      db.order.groupBy({
        by: ['status'],
        where: { eventId: event.id },
        _count: { id: true },
      }),
      db.dispute.count({
        where: { vendor: { eventId: event.id }, status: { in: ['OPEN', 'ESCALATED'] } },
      }),
    ])

    const counts = Object.fromEntries(statusCounts.map(g => [g.status, g._count.id]))
    const pendingCount = PENDING_STATUSES.reduce((s, st) => s + (counts[st] ?? 0), 0)
    const issuesCount  = (['CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE'] as OrderStatus[])
      .reduce((s, st) => s + (counts[st] ?? 0), 0)

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
      cancellationReason: o.cancellationReason,
      cancelledBy: o.cancelledBy,
      hasStripe: !!o.stripePaymentIntentId,
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
      dispute: o.disputes[0] ?? null,
    }))

    const nextCursor = orders.length === take ? orders[orders.length - 1].id : null

    return success({
      orders: result,
      nextCursor,
      meta: { pendingCount, issuesCount, disputeCount },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
