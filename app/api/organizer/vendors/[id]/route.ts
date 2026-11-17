import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { notifyVendorStatusChange } from '@/lib/notify'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'
import { resolveVendorWhere } from '@/lib/resolve-vendor'
import { vendorDocsPresence } from '@/lib/vendor-documents'
import { GO_LIVE_VENDOR_SELECT, vendorGoLiveRefusal } from '@/lib/vendor-go-live'
import { decideVendor, reconsiderVendor, rejectLiveVendor } from '@/lib/approvals'
import { latestVendorReviews } from '@/lib/vendor-review'
import { VendorStatus } from '@prisma/client'
import { IN_MODEL_ORDERS } from '@/lib/order-scope'

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
        where: { ...IN_MODEL_ORDERS, vendorId, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] } },
        _count: { id: true },
        _sum: { subtotal: true, vendorPayout: true },
      }),
      db.order.findMany({
        where: { ...IN_MODEL_ORDERS, vendorId, status: { notIn: ['PENDING_PAYMENT'] } },
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
        where: { ...IN_MODEL_ORDERS, vendorId, status: { in: ['COMPLETED', 'DELIVERED'] } },
        _count: { id: true },
        _sum: { vendorPayout: true },
      }),
      db.order.aggregate({
        where: {
          ...IN_MODEL_ORDERS,
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

    // Who last approved or rejected this booth, as an ORGANIZER may see it: their own team by
    // name, FairSynq staff only as "FairSynq" (lib/reviewer-label.ts; Jordan, Nov 16).
    const review = (await latestVendorReviews([vendorId], { kind: 'organizer', organizerId })).get(vendorId) ?? null

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
      // Demo booth: shown as a badge; only a strict admin can change it (lib/demo-vendor.ts).
      isDemo: vendor.isDemo,
      review,
      createdAt: vendor.createdAt,
      lastHeartbeatAt: vendor.lastHeartbeatAt,
      operatingHours: vendor.operatingHours,
      boothPhotoUrls: vendor.boothPhotoUrls,
      // Documents — PRESENCE ONLY. The paths are never emitted, and there is no public
      // URL to emit. To actually VIEW a document, the organizer calls
      // GET /api/organizer/vendors/[id]/documents, which authorises them and mints a
      // short-lived signed URL (and audit-logs the view).
      // Built from the SSOT (lib/vendor-documents.ts) so this payload and the list
      // payload emit the SAME keys. `foodHandlerPermit` is now `foodHandler`, matching
      // the upload route's DOC_TYPES vocabulary.
      docs: vendorDocsPresence(vendor),
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
        event: { select: { organizerId: true, name: true } },
        status: true,
        // id, name, and the inputs for the go-live check below (every move into ACTIVE, audit M1).
        ...GO_LIVE_VENDOR_SELECT,
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

    // ── ORGANIZER APPROVAL OF VENDORS IS ON (Jordan, Nov 16; locked decision 2) ─────────────
    // The event's organizer approves vendors for their own event. Every DECISION goes through the
    // shared decisions in lib/approvals.ts, never a plain status write here, so each one runs the
    // approver rule, the Stripe payouts check (asked fresh) and the checklist, and writes its
    // ApprovalAction (reviewer name) and the vendor's email in one transaction:
    //   PENDING → ACTIVE / REJECTED          decideVendor (booth + owner together; reject needs a reason)
    //   REJECTED → ACTIVE (re-approve)        reconsiderVendor (the full approval path)
    //   ACTIVE / PAUSED / SUSPENDED → REJECTED rejectLiveVendor (reason required)
    // Pausing, suspending and lifting a pause or suspension stay on the go-live path below.
    // The switch stays (set false to send PENDING decisions back to FairSynq only).
    const ORGANIZER_MAY_APPROVE_VENDORS: boolean = true
    if (!ORGANIZER_MAY_APPROVE_VENDORS && statusChanging && vendor.status === VendorStatus.PENDING
        && (body.status === VendorStatus.ACTIVE || body.status === VendorStatus.REJECTED)) {
      return apiError('New vendors are approved by FairSynq. You can pause or suspend vendors once they are active.', 403, 'APPROVAL_BY_PLATFORM')
    }
    const decision: 'decide' | 'reconsider' | 'reject-live' | null = !statusChanging ? null
      : vendor.status === VendorStatus.PENDING && (body.status === VendorStatus.ACTIVE || body.status === VendorStatus.REJECTED) ? 'decide'
      : vendor.status === VendorStatus.REJECTED && body.status === VendorStatus.ACTIVE ? 'reconsider'
      : body.status === VendorStatus.REJECTED && vendor.status !== VendorStatus.PENDING ? 'reject-live'
      : null

    // After every write below (a decision, or the plain status/booth write): caches, the audit log
    // and the Slack note, then the response. One place, so both paths behave the same.
    const finish = async (updated: { id: string; status: VendorStatus; boothNumber: string | null }) => {
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
    }

    if (decision) {
      // The decisions write a booth number only when approving; a reject never changes it.
      if (body.status === VendorStatus.REJECTED && data.boothNumber !== undefined) {
        return apiError('Save the booth number separately from a rejection.', 400, 'VALIDATION_ERROR')
      }
      const actor = { clerkId, actorType: 'organizer' as const, organizerId }
      const booth = typeof data.boothNumber === 'string' ? data.boothNumber : undefined
      if (decision === 'decide') {
        await decideVendor(vendorId, body.status === VendorStatus.ACTIVE ? 'approve' : 'reject', body.reason, actor, { boothNumber: booth })
      } else if (decision === 'reconsider') {
        await reconsiderVendor(vendorId, body.reason, actor, { boothNumber: booth })
      } else {
        await rejectLiveVendor(vendorId, body.reason, actor)
      }
      return finish(await db.vendor.findUniqueOrThrow({ where: { id: vendorId }, select: { id: true, status: true, boothNumber: true } }))
    }

    // ── GO-LIVE CHECK (audit M1, decided Nov 12) ──────────────────────────────────────────
    // EVERY remaining move into ACTIVE: lifting a pause or a suspension needs the booth approved
    // for this event AND the go-live checklist complete (documents, a sellable menu item, payouts,
    // booth number). The old PENDING-only gate is what let PENDING → PAUSED → ACTIVE put a
    // never-approved booth live. Approving a PENDING booth and re-approving a REJECTED one are
    // decisions, handled above (lib/approvals.ts). One shared check (lib/vendor-go-live.ts).
    // A booth number sent in this same PATCH counts toward the checklist.
    if (statusChanging && body.status === VendorStatus.ACTIVE) {
      const refusal = await vendorGoLiveRefusal(db, {
        ...vendor,
        boothNumber: data.boothNumber !== undefined ? (data.boothNumber as string | null) : vendor.boothNumber,
      })
      if (refusal) return apiError(refusal.message, 409, refusal.code, { missing: refusal.missingLabels })
    }

    return finish(await db.vendor.update({ where: { id: vendorId }, data }))
  } catch (err) {
    return handleApiError(err)
  }
}
