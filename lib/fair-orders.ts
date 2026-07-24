import { db } from './db'
import { OrderStatus, FulfillmentType } from '@prisma/client'

const ALL_PAID_STATUSES: OrderStatus[] = [
  'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED',
  'COMPLETED', 'DELIVERED', 'CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE',
]

const PENDING_STATUSES: OrderStatus[] = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED']
const ISSUE_STATUSES: OrderStatus[] = ['CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE']

/**
 * Tab → the statuses it shows. The ONE mapping, so the list query and the tab-count badges can
 * never disagree. Note there is deliberately no "refunded" tab: REFUNDED is not a master
 * OrderStatus (a refund lives in Refund rows; the order stays CANCELLED/COMPLETED), so a
 * status-based refunded tab would always be empty. "Issues" answers the real fair-day question.
 */
export const TAB_STATUSES: Record<string, OrderStatus[]> = {
  all:       ALL_PAID_STATUSES,
  active:    PENDING_STATUSES,
  completed: ['COMPLETED', 'DELIVERED'],
  issues:    ISSUE_STATUSES,
}

export interface FairOrdersOpts {
  take?:            number
  cursor?:          string
  vendorId?:        string
  fulfillmentType?: string
  search?:          string
  dateFrom?:        string
  dateTo?:          string
  tab?:             string | null
  status?:          string | null
  sort?:            'newest' | 'oldest'
  /** Opt-IN to out-of-model rows. Default false — see the voidedAt note in the query. */
  includeVoided?:   boolean
}

const FULFILLMENT_TYPES = ['BOOTH_PICKUP', 'CURBSIDE', 'HOME_DELIVERY']

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
  const fulfillmentType = opts.fulfillmentType && FULFILLMENT_TYPES.includes(opts.fulfillmentType)
    ? opts.fulfillmentType : undefined

  // A single explicit ?status= wins (deep link to one status); otherwise the tab maps to its set;
  // 'pending' stays accepted as an alias for 'active' (the organizer route's older vocabulary).
  let statusFilter: OrderStatus[]
  const statusParam = opts.status as OrderStatus | null
  if (statusParam && ALL_PAID_STATUSES.includes(statusParam)) {
    statusFilter = [statusParam]
  } else {
    const tab = opts.tab === 'pending' ? 'active' : (opts.tab ?? 'all')
    statusFilter = TAB_STATUSES[tab] ?? ALL_PAID_STATUSES
  }

  // SERVER-SIDE SEARCH — queries the WHOLE event, not the loaded page. A customer reads their
  // code aloud ("26685PS7") days into the fair; a client filter over the last 100 rows would
  // return empty and look like "no such order". The short code is the lowercased id tail, so a
  // `contains` on the (lowercase) id matches both the tail and a full-id paste; names are
  // case-insensitive.
  const q = opts.search?.trim()
  const searchWhere = q ? {
    OR: [
      { id: { contains: q.toLowerCase() } },
      { customerName: { contains: q, mode: 'insensitive' as const } },
      { customerPhone: { contains: q } },
      { vendor: { name: { contains: q, mode: 'insensitive' as const } } },
    ],
  } : {}

  // Everything EXCEPT the status tab — so the status-tab counts can be computed over the same
  // search/vendor/type/date scope (a tab badge tells you what CLICKING it would show).
  //
  // GHOST FILTER — voided orders are OUT OF MODEL and excluded by default.
  // Measured before this landed: the log showed 92 "active" when 4 were real, 70 "issues" when
  // 12 were real, and 377 total against 152 real — 225 voided test rows presented as live work,
  // making the pre-fair picture 25x busier than the fair actually is. Every comparable aggregate
  // already filters ghosts (lib/fair-vendors.ts, lib/admin-fair-reports.ts, lib/organizer-payout.ts,
  // lib/runner-completion.ts); this log was the outlier — the same class, third instance.
  //
  // includeVoided is an explicit OPT-IN, never a default, deliberately mirroring the money
  // carve-out's shape (`includeArchived: true` is passed by name on the paths that need it). An
  // admin auditing WHAT WAS VOIDED is a real need; having ghosts silently inflate every count is
  // not. Applied to baseWhere so the list, the total, the tab counts and search all agree —
  // a filter on the list alone would leave the badges lying.
  const baseWhere = {
    eventId,
    ...(opts.includeVoided ? {} : { voidedAt: null }),
    ...(vendorId ? { vendorId } : {}),
    ...(fulfillmentType ? { fulfillmentType: fulfillmentType as FulfillmentType } : {}),
    ...(dateFrom || dateTo ? {
      placedAt: {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo   ? { lte: new Date(dateTo)   } : {}),
      },
    } : {}),
    ...searchWhere,
  }
  const ordersWhere = { ...baseWhere, status: { in: statusFilter } }

  const [orders, statusCounts, total, disputeCount] = await Promise.all([
    db.order.findMany({
      where: ordersWhere,
      // Server-side sort, so "oldest first" is honest ACROSS pages, not just within the loaded
      // one. cursor pagination stays valid — the cursor is the last row of the same ordering.
      orderBy: opts.sort === 'oldest' ? [{ placedAt: 'asc' }, { id: 'asc' }] : [{ placedAt: 'desc' }, { id: 'desc' }],
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
    // Status-tab counts, scoped to the SAME search/vendor/type/date as the list (but across all
    // statuses) — so a tab badge is honest about what clicking it would show, not a whole-event
    // number that contradicts a searched list.
    db.order.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: { id: true },
    }),
    // The real total for THIS filter+search — powers "showing 100 of N" instead of "the 100 most
    // recent". Same where as the list minus cursor/take.
    db.order.count({ where: ordersWhere }),
    db.dispute.count({
      where: { vendor: { eventId }, status: { in: ['OPEN', 'ESCALATED'] } },
    }),
  ])

  const counts = Object.fromEntries(statusCounts.map(g => [g.status, g._count.id]))
  const pendingCount = PENDING_STATUSES.reduce((s, st) => s + (counts[st] ?? 0), 0)
  const issuesCount  = ISSUE_STATUSES.reduce((s, st) => s + (counts[st] ?? 0), 0)
  // One badge per tab, from the SAME mapping the list query uses — search/vendor/type-scoped.
  const tabCounts = Object.fromEntries(
    Object.entries(TAB_STATUSES).map(([tab, sts]) => [tab, sts.reduce((s, st) => s + (counts[st] ?? 0), 0)]),
  )

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
    // total = orders matching the current status tab + search/vendor/type/date (for "showing X
    // of N"). tabCounts = per-tab within the search/vendor/type/date scope (tab badges).
    total,
    meta: { pendingCount, issuesCount, disputeCount, tabCounts },
  }
}
