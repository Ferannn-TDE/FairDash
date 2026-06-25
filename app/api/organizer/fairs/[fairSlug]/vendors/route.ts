import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { vendorReady } from '@/lib/vendor-readiness'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'

// GET /api/organizer/fairs/[fairSlug]/vendors?status=ACTIVE&take=50&cursor=<id>
// Returns vendors with document status, Stripe status, today's order count.
// All stats via SQL groupBy — no per-vendor JS reduce.
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
    const take         = Math.min(Math.max(1, parseInt(searchParams.get('take') ?? '50', 10)), 200)
    const cursor       = searchParams.get('cursor') ?? undefined
    const statusFilter = searchParams.get('status') ?? undefined

    const vendors = await db.vendor.findMany({
      where: {
        eventId: event.id,
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
        // Stripe
        stripeVerified: true,
        stripeConnectedAt: true,
        // Documents
        foodHandlerPermitUrl: true,
        insuranceUrl: true,
        businessLicenseUrl: true,
        insuranceExpired: true,
        insuranceExpiryDate: true,
        // Live
        isOffline: true,
        isBusy: true,
        lastHeartbeatAt: true,
        // Readiness inputs (for the organizer nudge view)
        _count: { select: { menuItems: { where: { isAvailable: true } } } },
      },
    })

    if (vendors.length === 0) return success({ vendors: [], nextCursor: null })

    const vendorIds = vendors.map(v => v.id)

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    // Three SQL aggregations in parallel — no full-row JS scans
    const [allTimeRevenue, allTimeCount, todayCount] = await Promise.all([
      db.order.groupBy({
        by: ['vendorId'],
        where: { vendorId: { in: vendorIds }, status: { in: ['COMPLETED', 'DELIVERED'] } },
        _sum: { vendorPayout: true },
      }),
      db.order.groupBy({
        by: ['vendorId'],
        where: { vendorId: { in: vendorIds }, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] } },
        _count: { id: true },
      }),
      db.order.groupBy({
        by: ['vendorId'],
        where: {
          vendorId: { in: vendorIds },
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
      // Stripe
      stripeVerified: v.stripeVerified,
      stripeConnectedAt: v.stripeConnectedAt,
      // Document presence flags — no URLs exposed in list view
      docs: {
        foodHandlerPermit: !!v.foodHandlerPermitUrl,
        insurance: !!v.insuranceUrl,
        insuranceExpired: v.insuranceExpired,
        businessLicense: !!v.businessLicenseUrl,
      },
      // Live
      isOffline: v.isOffline,
      isBusy: v.isBusy,
      lastHeartbeatAt: v.lastHeartbeatAt,
      // Stats
      orderCount: countMap[v.id] ?? 0,
      ordersToday: todayMap[v.id] ?? 0,
      revenue: parseFloat((revenueMap[v.id] ?? 0).toFixed(2)),
      // Readiness (the (c) bar) — so organizers can nudge un-live vendors. Uses the
      // shared predicate, so it matches exactly what the customer gate will admit.
      ready: vendorReady({ status: v.status, stripeVerified: v.stripeVerified, availableMenuCount: v._count.menuItems }),
      availableMenuCount: v._count.menuItems,
    }))

    const nextCursor = vendors.length === take ? vendors[vendors.length - 1].id : null

    // Summary for the nudge banner. notReady = approved vendors that customers
    // can't order from (the cohort organizers should chase). Page-scoped.
    const approved = result.filter(v => v.status === 'ACTIVE')
    const notReadyCount = approved.filter(v => !v.ready).length

    return success({ vendors: result, nextCursor, readiness: { approvedCount: approved.length, notReadyCount } })
  } catch (err) {
    return handleApiError(err)
  }
}
