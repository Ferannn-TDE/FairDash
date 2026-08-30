import { db } from './db'
import { vendorReady } from './vendor-readiness'
import { vendorDocsPresence } from './vendor-documents'
import { SELLABLE } from './menu/on-menu'

export interface FairVendorsOpts {
  take?:   number
  cursor?: string
  status?: string
}

/**
 * Authorization-agnostic shared core for a fair's vendor roster.
 *
 * Given an ALREADY-RESOLVED and ALREADY-AUTHORIZED eventId, returns the fair's
 * vendors + document/Stripe/readiness state + order stats. NEVER authorizes and
 * NEVER resolves the event — the caller owns authorization:
 *   • organizer route: requireOrganizerAuth → ownership-scoped resolve → here
 *   • admin route:     requireAdminFairContext (strict admin, unscoped) → here
 * Shared so the admin and organizer vendor lists can't drift.
 */
export async function getFairVendors(eventId: string, opts: FairVendorsOpts = {}) {
  const take         = Math.min(Math.max(1, opts.take ?? 50), 200)
  const cursor       = opts.cursor
  const statusFilter = opts.status

  const vendors = await db.vendor.findMany({
    where: {
      eventId,
      ...(statusFilter ? { status: statusFilter as never } : {}),
    },
    orderBy: { name: 'asc' },
    take,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      cuisineType: true,
      boothNumber: true,
      createdAt: true,
      stripeVerified: true,
      stripeConnectedAt: true,
      foodHandlerPermitPath: true,
      insurancePath: true,
      businessLicensePath: true,
      isOffline: true,
      isBusy: true,
      lastHeartbeatAt: true,
      _count: { select: { menuItems: { where: SELLABLE } } },
    },
  })

  if (vendors.length === 0) {
    return { vendors: [], nextCursor: null, readiness: { approvedCount: 0, notReadyCount: 0 } }
  }

  const vendorIds = vendors.map(v => v.id)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  // voidedAt: null — voided (test junk) orders must not inflate a vendor's card.
  const [allTimeRevenue, allTimeCount, todayCount] = await Promise.all([
    db.order.groupBy({
      by: ['vendorId'],
      where: { vendorId: { in: vendorIds }, voidedAt: null, status: { in: ['COMPLETED', 'DELIVERED'] } },
      _sum: { vendorPayout: true },
    }),
    db.order.groupBy({
      by: ['vendorId'],
      where: { vendorId: { in: vendorIds }, voidedAt: null, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] } },
      _count: { id: true },
    }),
    db.order.groupBy({
      by: ['vendorId'],
      where: {
        vendorId: { in: vendorIds },
        voidedAt: null,
        placedAt: { gte: todayStart },
        status: { notIn: ['PENDING_PAYMENT'] },
      },
      _count: { id: true },
    }),
  ])

  const revenueMap = Object.fromEntries(allTimeRevenue.map(g => [g.vendorId, g._sum.vendorPayout ?? 0]))
  const countMap   = Object.fromEntries(allTimeCount.map(g => [g.vendorId, g._count.id]))
  const todayMap   = Object.fromEntries(todayCount.map(g => [g.vendorId, g._count.id]))

  const result = vendors.map(v => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    status: v.status,
    cuisineType: v.cuisineType,
    boothNumber: v.boothNumber,
    joinedAt: v.createdAt,
    stripeVerified: v.stripeVerified,
    stripeConnectedAt: v.stripeConnectedAt,
    // Document presence flags — never the paths, and there are no URLs to expose.
    // Built from the SSOT (lib/vendor-documents.ts) so this payload, the vendor-detail
    // payload, and the vendor's own documents endpoint all emit ONE shape. The former
    // `foodHandlerPermit` key is now the canonical `foodHandler`, and the always-false
    // `insuranceExpired` term is gone — see the SSOT header for why presence-only.
    docs: vendorDocsPresence(v),
    isOffline: v.isOffline,
    isBusy: v.isBusy,
    lastHeartbeatAt: v.lastHeartbeatAt,
    orderCount: countMap[v.id] ?? 0,
    ordersToday: todayMap[v.id] ?? 0,
    revenue: parseFloat((revenueMap[v.id] ?? 0).toFixed(2)),
    ready: vendorReady({ status: v.status, stripeVerified: v.stripeVerified, availableMenuCount: v._count.menuItems }),
    availableMenuCount: v._count.menuItems,
  }))

  const nextCursor = vendors.length === take ? vendors[vendors.length - 1].id : null

  const approved = result.filter(v => v.status === 'ACTIVE')
  const notReadyCount = approved.filter(v => !v.ready).length

  return { vendors: result, nextCursor, readiness: { approvedCount: approved.length, notReadyCount } }
}
