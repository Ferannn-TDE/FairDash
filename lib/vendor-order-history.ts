import { Prisma, OrderStatus as PrismaOrderStatus } from '@prisma/client'
import { db } from './db'
import { computeVendorOrderEarnings } from './vendor-earnings'
import { TAB_STATUS_MAP } from './order-status'

/**
 * Vendor order history — server-side filter + stable sort + cursor pagination.
 *
 * WHY THIS IS A LIB AND NOT INLINE IN THE ROUTE: so the correctness properties below can be
 * exercised by a test against a real database, without stubbing Clerk. The route does auth
 * and nothing else. AUTHORISATION IS THE ROUTE'S JOB — this function trusts the vendorId it
 * is given and must never be called with one that came from a request unverified.
 */

/** Terminal VendorOrderStatus values — the legacy default when no tab/status is supplied. */
const TERMINAL_VENDOR_STATUSES = ['COMPLETED', 'DECLINED']

export const MAX_TAKE = 50

/** Real Order.status enum values, for the master-status fallback arm below. */
const ORDER_STATUS_VALUES = new Set<string>(Object.values(PrismaOrderStatus))

/**
 * The order's DISPLAYED status is `vendorOrderStatus ?? order.status`. Server-side filtering
 * must mirror that EXACTLY, or a filter returns rows whose displayed status isn't in the
 * filter — "page 2 of Cancelled" showing a completed order. So a row matches when EITHER:
 *   (a) this vendor's VendorOrderStatus is one of the allowed statuses, OR
 *   (b) this vendor has NO VendorOrderStatus row and the MASTER status is allowed.
 *
 * (b) is intersected with the real OrderStatus enum, because the two vocabularies differ:
 * 'DECLINED' is a VendorOrderStatus but NOT an Order.status — handing it to a master-status
 * `in` clause is a Prisma enum error.
 *
 * This replaces a real bug: the previous clause OR'd in `{ status: 'CANCELLED' }`
 * UNCONDITIONALLY, so cancelled orders came back no matter which filter was requested.
 */
export function statusWhere(vendorId: string, allowed: string[]): Prisma.OrderWhereInput {
  const masterAllowed = allowed.filter(s => ORDER_STATUS_VALUES.has(s)) as PrismaOrderStatus[]
  const arms: Prisma.OrderWhereInput[] = [
    { vendorOrderStatuses: { some: { vendorId, status: { in: allowed } } } },
  ]
  if (masterAllowed.length) {
    arms.push({
      AND: [
        { vendorOrderStatuses: { none: { vendorId } } },
        { status: { in: masterAllowed } },
      ],
    })
  }
  return { OR: arms }
}

/**
 * The base SCOPE of "orders operationally visible to this vendor" — the part every vendor
 * order reader shares, kept in ONE place so the readers cannot drift on it:
 *   • orderItems.some(vendorId) — this vendor is actually on the order.
 *   • voidedAt: null — voided orders are the OUT-OF-MODEL exclusion marker (pre-fee-model
 *     test data etc.); the reconciler and every money/audit path skip them, so a vendor's
 *     live queue and order history must skip them too. A JOIN-only reader hid voided orders
 *     only by accident (they have no VendorOrderStatus row); once a reader adds the
 *     none→master fallback, voided orders would leak back in UNLESS this scope excludes them.
 *
 * Compose with statusWhere: `{ ...vendorOrderScope(vendorId), ...statusWhere(vendorId, xs) }`.
 */
export function vendorOrderScope(vendorId: string): Prisma.OrderWhereInput {
  return { orderItems: { some: { vendorId } }, voidedAt: null }
}

export interface HistoryQuery {
  vendorId: string
  /** Canonical tab (TAB_STATUS_MAP). Takes precedence over `statuses`. */
  tab?: string | null
  /** Legacy explicit VendorOrderStatus list. */
  statuses?: string[] | null
  sort?: 'newest' | 'oldest'
  take?: number
  cursor?: string | null
  range?: string | null
  withCounts?: boolean
}

export class UnknownTabError extends Error {}

export async function fetchVendorOrderHistory(q: HistoryQuery) {
  const { vendorId } = q
  const take = Math.min(Math.max(1, q.take ?? MAX_TAKE), MAX_TAKE)
  const dir: Prisma.SortOrder = q.sort === 'oldest' ? 'asc' : 'desc'

  let allowed: string[]
  if (q.tab) {
    const mapped = TAB_STATUS_MAP[q.tab]
    if (!mapped) throw new UnknownTabError(`Unknown tab "${q.tab}"`)
    allowed = mapped
  } else if (q.statuses?.length) {
    allowed = q.statuses
  } else {
    allowed = TERMINAL_VENDOR_STATUSES
  }

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const baseWhere: Prisma.OrderWhereInput = {
    ...vendorOrderScope(vendorId),
    ...(q.range === 'today' ? { placedAt: { gte: startOfToday } } : {}),
  }
  const where: Prisma.OrderWhereInput = { ...baseWhere, ...statusWhere(vendorId, allowed) }

  // STABLE SORT — the id tiebreaker is load-bearing, not decoration. placedAt is NOT unique
  // (orders placed in the same second collide), and with a non-deterministic tie order the
  // database may return colliding rows in a different order on each query — so a row can
  // appear on TWO pages, or be SKIPPED entirely. Cursor pagination makes this worse, because
  // "the row after the cursor" must be reproducible. The tiebreaker's DIRECTION must follow
  // the primary sort, or the cursor walks ties the wrong way.
  const orderBy: Prisma.OrderOrderByWithRelationInput[] = [{ placedAt: dir }, { id: dir }]

  const orders = await db.order.findMany({
    where,
    orderBy,
    take,
    cursor: q.cursor ? { id: q.cursor } : undefined,
    skip: q.cursor ? 1 : 0,
    select: {
      id: true,
      status: true,
      placedAt: true,
      fulfillmentType: true,
      customerName: true,
      customerPhone: true,
      total: true,
      // The delivery address: this select did NOT carry it, while the orders page rendered
      // `{order.deliveryStreet}, {order.deliveryCity}` — so every HOME_DELIVERY row on the
      // vendor's history printed "undefined, undefined". Partial-rows class (the same one
      // VendorActiveOrder's typed contract exists to stop, one route over).
      deliveryStreet: true,
      deliveryUnit: true,
      deliveryCity: true,
      deliveryState: true,
      deliveryZip: true,
      vendorOrderStatuses: { where: { vendorId }, select: { vendorId: true, status: true } },
      payouts: { where: { vendorId }, select: { vendorId: true, netAmount: true, reversedAt: true } },
      refunds: { where: { vendorId }, select: { vendorId: true, status: true, amountCents: true } },
      // ALL items (every vendor) — the earnings helper needs the full per-vendor split to
      // compute this vendor's proportional Stripe-fee share.
      orderItems: {
        select: {
          id: true, quantity: true, unitPrice: true, totalPrice: true, subtotal: true,
          itemName: true, vendorId: true,
        },
      },
    },
  })

  // TRUE per-tab totals, across the WHOLE history — never just the current page.
  let counts: Record<string, number> | undefined
  if (q.withCounts) {
    const tabs = Object.keys(TAB_STATUS_MAP)
    const results = await Promise.all(
      tabs.map(t => db.order.count({ where: { ...baseWhere, ...statusWhere(vendorId, TAB_STATUS_MAP[t]) } })),
    )
    counts = Object.fromEntries(tabs.map((t, i) => [t, results[i]]))
  }

  // EARNINGS = take-home, via the single shared helper (lib/vendor-earnings). Never gross.
  const result = orders.map(o => {
    const myItems = o.orderItems.filter(i => i.vendorId === vendorId)
    const vendorSubtotal = myItems.reduce((s, i) => s + (i.totalPrice ?? i.unitPrice * i.quantity), 0)
    const earn = computeVendorOrderEarnings(o, vendorId)

    return {
      id: o.id,
      status: o.vendorOrderStatuses[0]?.status ?? o.status,
      fulfillmentType: o.fulfillmentType,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      vendorSubtotal: parseFloat(vendorSubtotal.toFixed(2)),
      earnings: parseFloat((earn.cents / 100).toFixed(2)),
      earningsStatus: earn.status,
      placedAt: o.placedAt,
      orderItems: myItems.map(i => ({
        id: i.id, quantity: i.quantity, unitPrice: i.unitPrice, itemName: i.itemName,
      })),
    }
  })

  // Only claim another page when this one was FULL — a short page is the last page.
  const nextCursor = orders.length === take ? orders[orders.length - 1].id : null

  return { orders: result, nextCursor, counts }
}
