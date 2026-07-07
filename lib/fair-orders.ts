import { db } from './db'
import { OrderStatus } from '@prisma/client'

const ALL_PAID_STATUSES: OrderStatus[] = [
  'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED',
  'COMPLETED', 'DELIVERED', 'CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE',
]

const PENDING_STATUSES: OrderStatus[] = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED']
const ISSUE_STATUSES: OrderStatus[] = ['CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE']

export interface FairOrdersOpts {
  take?:     number
  cursor?:   string
  vendorId?: string
  dateFrom?: string
  dateTo?:   string
  tab?:      string | null
  status?:   string | null
}

/**
 * Authorization-agnostic shared core for a fair's order log.
 *
 * Given an ALREADY-RESOLVED and ALREADY-AUTHORIZED eventId, returns the fair's
 * orders + status meta. This core NEVER authorizes and NEVER resolves the event
 * — the caller owns authorization:
 *   • organizer route: requireOrganizerAuth → ownership-scoped event resolve → here
 *   • admin route:     requireAdminFairContext (strict admin, unscoped) → here
 * Sharing the query guarantees the admin and organizer order logs cannot drift.
 */
export async function getFairOrders(eventId: string, opts: FairOrdersOpts = {}) {
  const take     = Math.min(Math.max(1, opts.take ?? 50), 100)
  const cursor   = opts.cursor
  const vendorId = opts.vendorId
  const dateFrom = opts.dateFrom
  const dateTo   = opts.dateTo

  let statusFilter: OrderStatus[]
  if (opts.tab === 'pending') {
    statusFilter = PENDING_STATUSES
  } else if (opts.tab === 'issues') {
    statusFilter = ISSUE_STATUSES
  } else {
    const statusParam = opts.status as OrderStatus | null
    statusFilter = statusParam && ALL_PAID_STATUSES.includes(statusParam)
      ? [statusParam]
      : ALL_PAID_STATUSES
  }

  const [orders, statusCounts, disputeCount] = await Promise.all([
    db.order.findMany({
      where: {
        eventId,
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
      where: { eventId },
      _count: { id: true },
    }),
    db.dispute.count({
      where: { vendor: { eventId }, status: { in: ['OPEN', 'ESCALATED'] } },
    }),
  ])

  const counts = Object.fromEntries(statusCounts.map(g => [g.status, g._count.id]))
  const pendingCount = PENDING_STATUSES.reduce((s, st) => s + (counts[st] ?? 0), 0)
  const issuesCount  = ISSUE_STATUSES.reduce((s, st) => s + (counts[st] ?? 0), 0)

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

  return {
    orders: result,
    nextCursor,
    meta: { pendingCount, issuesCount, disputeCount },
  }
}
