import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { notifyVendorStatusChange } from '@/lib/notify'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'
import { resolveVendorWhere } from '@/lib/resolve-vendor'
import { VendorStatus } from '@prisma/client'

const ALLOWED_STATUSES: VendorStatus[] = ['ACTIVE', 'PAUSED', 'SUSPENDED', 'REJECTED']

// GET /api/organizer/vendors/[id]
// Full vendor detail for organizer: info, documents, members, stats, menu items, order history.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { id: vendorParam } = await params

    // Accept cuid or per-fair slug. A bare slug is scoped to the fair the page carries
    // (?fair=<fairSlug>); the organizerId ownership check below is the second guard.
    const fairSlug = req.nextUrl.searchParams.get('fair')
    const vendor = await db.vendor.findFirst({
      where: await resolveVendorWhere(vendorParam, fairSlug),
      include: {
        event: { select: { id: true, name: true, urlSlug: true, organizerId: true } },
        vendorMembers: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        menuItems: {
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
          select: {
            id: true, name: true, description: true, price: true,
            category: true, imageUrl: true, prepTime: true,
            isAvailable: true, variantGroup: true, variantLabel: true,
          },
        },
        menuRequests: {
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, type: true, status: true, name: true,
            price: true, category: true, imageUrl: true, createdAt: true,
            menuItem: { select: { name: true } },
          },
        },
      },
    })

    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')
    if (vendor.event.organizerId !== organizerId) return apiError('Access denied', 403, 'FORBIDDEN')

    const vendorId = vendor.id

    const { searchParams } = req.nextUrl
    const orderTake   = Math.min(Math.max(1, parseInt(searchParams.get('orderTake') ?? '20', 10)), 100)
    const orderCursor = searchParams.get('orderCursor') ?? undefined

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    // Parallel: aggregate stats + order history + revenue by fulfillment type
    const [orderStats, orderHistory, fulfillmentBreakdown, todayStats] = await Promise.all([
      db.order.aggregate({
        where: { vendorId, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] } },
        _count: { id: true },
        _sum: { subtotal: true, vendorPayout: true },
      }),
      db.order.findMany({
        where: { vendorId, status: { notIn: ['PENDING_PAYMENT'] } },
        orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
        take: orderTake,
        cursor: orderCursor ? { id: orderCursor } : undefined,
        skip: orderCursor ? 1 : 0,
        select: {
          id: true, status: true, total: true, subtotal: true,
          vendorPayout: true, fairSynqFee: true,
          placedAt: true, customerName: true, fulfillmentType: true,
          orderItems: {
            take: 3,
            select: { quantity: true, itemName: true },
          },
        },
      }),
      db.order.groupBy({
        by: ['fulfillmentType'],
        where: { vendorId, status: { in: ['COMPLETED', 'DELIVERED'] } },
        _count: { id: true },
        _sum: { vendorPayout: true },
      }),
      db.order.aggregate({
        where: {
          vendorId,
          placedAt: { gte: todayStart },
          status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] },
        },
        _count: { id: true },
        _sum: { subtotal: true },
      }),
    ])

    const nextOrderCursor = orderHistory.length === orderTake
      ? orderHistory[orderHistory.length - 1].id
      : null

    return success({
      id: vendor.id,
      name: vendor.name,
      slug: vendor.slug,
      description: vendor.description,
      cuisineType: vendor.cuisineType,
      boothNumber: vendor.boothNumber,
      vendorType: vendor.vendorType,
      status: vendor.status,
      isOffline: vendor.isOffline,
      isBusy: vendor.isBusy,
      stripeVerified: vendor.stripeVerified,
      stripeConnectedAt: vendor.stripeConnectedAt,
      createdAt: vendor.createdAt,
      lastHeartbeatAt: vendor.lastHeartbeatAt,
      operatingHours: vendor.operatingHours,
      boothPhotoUrls: vendor.boothPhotoUrls,
      // Documents — PRESENCE ONLY. The paths are never emitted, and there is no public
      // URL to emit. To actually VIEW a document, the organizer calls
      // GET /api/organizer/vendors/[id]/documents, which authorises them and mints a
      // short-lived signed URL (and audit-logs the view).
      docs: {
        foodHandlerPermit: !!vendor.foodHandlerPermitPath,
        insurance:         !!vendor.insurancePath,
        businessLicense:   !!vendor.businessLicensePath,
      },
      insuranceExpiryDate: vendor.insuranceExpiryDate,
      insuranceExpired: vendor.insuranceExpired,
      // Fair
      fairId: vendor.event.id,
      fairName: vendor.event.name,
      fairSlug: vendor.event.urlSlug,
      // Team
      members: vendor.vendorMembers.map(m => ({
        role: m.role,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
      })),
      // Menu
      menuItems: vendor.menuItems,
      pendingMenuRequests: vendor.menuRequests,
      // Stats
      orderCount: orderStats._count.id,
      totalRevenue: parseFloat((orderStats._sum.subtotal ?? 0).toFixed(2)),
      totalPayout: parseFloat((orderStats._sum.vendorPayout ?? 0).toFixed(2)),
      ordersToday: todayStats._count.id,
      revenueToday: parseFloat((todayStats._sum.subtotal ?? 0).toFixed(2)),
      // Revenue breakdown by fulfillment type
      fulfillmentBreakdown: fulfillmentBreakdown.map(f => ({
        type: f.fulfillmentType,
        count: f._count.id,
        revenue: parseFloat((f._sum.vendorPayout ?? 0).toFixed(2)),
      })),
      // Order history
      orderHistory: orderHistory.map(o => ({
        id: o.id,
        status: o.status,
        total: o.total,
        subtotal: o.subtotal,
        vendorPayout: o.vendorPayout,
        fairSynqFee: o.fairSynqFee,
        placedAt: o.placedAt,
        customerName: o.customerName,
        fulfillmentType: o.fulfillmentType,
        itemSummary: o.orderItems.map(i => `${i.quantity}× ${i.itemName}`).join(', '),
      })),
      nextOrderCursor,
    })
  } catch (err) {
    return handleApiError(err)
  }
}

// PATCH /api/organizer/vendors/[id]
// Update vendor status. Sends Slack notification and revalidates vendor cache.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { organizerId, clerkId } = await requireOrganizerAuth()
    const { id: vendorParam } = await params

    const fairSlug = req.nextUrl.searchParams.get('fair')
    const vendor = await db.vendor.findFirst({
      where: await resolveVendorWhere(vendorParam, fairSlug),
      select: {
        id: true,
        event: { select: { organizerId: true, name: true } },
        name: true,
        status: true,
      },
    })
    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')
    const vendorId = vendor.id
    if (vendor.event.organizerId !== organizerId) return apiError('Access denied', 403, 'FORBIDDEN')

    const body = await req.json() as {
      status?: string
      boothNumber?: string
      reason?: string
    }

    const data: Record<string, unknown> = {}

    if (body.status !== undefined) {
      if (!ALLOWED_STATUSES.includes(body.status as VendorStatus)) {
        return apiError('Invalid status', 400, 'VALIDATION_ERROR')
      }
      data.status = body.status
    }

    if (body.boothNumber !== undefined) {
      data.boothNumber = body.boothNumber ? String(body.boothNumber).slice(0, 20) : null
    }

    // NOTE: commissionRate is a deprecated field from an abandoned fee model and
    // is intentionally no longer accepted or used. FairSynq's only revenue is the
    // 10% customer service fee (kept clean); vendors receive their subtotal minus
    // their proportional share of the Stripe processing fee.

    if (Object.keys(data).length === 0) return apiError('No valid fields to update', 400, 'VALIDATION_ERROR')

    const statusChanging = body.status !== undefined && body.status !== vendor.status

    // Idempotent: status-only PATCH that doesn't change anything returns the current state
    if (!statusChanging && Object.keys(data).length === 1 && data.status !== undefined) {
      return success({
        id: vendor.id,
        status: vendor.status,
        boothNumber: null,
      })
    }

    const updated = await db.vendor.update({ where: { id: vendorId }, data })

    // Revalidate vendor analytics cache
    revalidateTag(`analytics-${vendorId}`, 'default')
    revalidateTag(`vendor-${vendorId}`, 'default')

    // Status change invalidates organizer headline counts (active vendor count)
    if (body.status && body.status !== vendor.status) {
      revalidateTag(`organizer-stats-${organizerId}`, 'default')
      revalidateTag(`organizer-fairs-${organizerId}`, 'default')
      // …and the CUSTOMER discovery list. status decides whether a vendor is ACTIVE and so
      // orderable; getVendorsBySlugCached (lib/fairs.ts) caches that list 120s under
      // 'vendors'. Without this, a SUSPENDED vendor lingers as orderable — and a newly
      // ACTIVE one stays invisible — for up to two minutes. Same bust the toggle uses.
      revalidateTag('vendors', 'default')
    }

    // Audit log + Slack notification on status change
    if (statusChanging && body.status) {
      const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
      if (dbUser) {
        logVendorAction(vendorId, dbUser.id, AUDIT_ACTIONS.VENDOR_STATUS_CHANGED, {
          previousStatus: vendor.status,
          newStatus: body.status,
          reason: body.reason ?? null,
        })
      }
      void notifyVendorStatusChange(
        vendor.name,
        vendorId,
        body.status,
        vendor.event.name,
        body.reason,
      )
    }

    return success({
      id: updated.id,
      status: updated.status,
      boothNumber: updated.boothNumber,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
