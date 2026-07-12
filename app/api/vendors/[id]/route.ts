import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { VendorStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorAuth, getOptionalUserId, hasStrictAdminAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api-error'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { enforceRateLimit } from '@/lib/ratelimit'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'
import { isVendorReadinessEnforced, vendorReady } from '@/lib/vendor-readiness'
import { resolveVendorWhere } from '@/lib/resolve-vendor'
import { callerMayViewInactiveVendor } from '@/lib/vendor-visibility'

// GET /api/vendors/:id
// Returns a single vendor with their active menu items (public-safe fields only).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'anonymous'
    const { allowed } = await enforceRateLimit(ip, 'publicRoutes')
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
    }

    const { id } = await params
    // Per-fair slug resolution: a bare slug no longer identifies one vendor, so scope
    // it to the fair the page already carries (?fair=<fairSlug>). id stays unambiguous.
    const fairSlug = new URL(req.url).searchParams.get('fair')
    // PUBLIC, UNAUTHENTICATED ENDPOINT — the select IS the access-control boundary.
    // Everything selected here is returned verbatim to any anonymous caller (see the
    // `return success(vendor)` below), so this list must contain ONLY customer-facing
    // fields. It previously leaked the vendor's compliance documents
    // (foodHandlerPermitUrl / insuranceUrl / businessLicenseUrl — a business license and
    // an insurance certificate, i.e. legal PII) and their Stripe Connect account id, to
    // anyone who hit the endpoint. None of it was ever read by the customer page. Do not
    // re-add a field here without asking: "am I happy for a stranger to have this?"
    const vendor = await db.vendor.findFirst({
      where: await resolveVendorWhere(id, fairSlug),
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        cuisineType: true,
        boothNumber: true,
        isOffline: true,
        isBusy: true,
        busyUntil: true,
        status: true,
        eventId: true,
        operatingHours: true,
        // stripeVerified: NOT customer data, but the readiness gate below needs it.
        // It is stripped from the response — see the destructure at the return.
        stripeVerified: true,
        menuItems: {
          where: { isAvailable: true },
          orderBy: { category: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            imageUrl: true,
            category: true,
            isAvailable: true,
            prepTime: true,
            variantGroup: true,
            variantLabel: true,
          },
        },
      },
    })

    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')

    // ── STATUS GATE ────────────────────────────────────────────────────────────
    // A non-ACTIVE vendor (PENDING / PAUSED / SUSPENDED / REJECTED) is NOT public. This
    // closes a real gap: the marketplace LIST and order placement both require ACTIVE, but
    // this detail endpoint only gated on status when ENFORCE_VENDOR_READINESS was on (off by
    // default) — so a pending vendor's page + menu was reachable by DIRECT URL. Not a money
    // leak (placement rejects non-ACTIVE with VENDOR_INACTIVE), but a real visibility gap.
    //
    // OWNER / ADMIN BYPASS — mirrors the sibling menu route: the gate hides a vendor from
    // CUSTOMERS, not from themselves. An owner previewing their own storefront, or an admin,
    // still resolves it; everyone else gets a plain 404. (Organizers review via their own
    // route, /api/organizer/vendors/[id], so they don't need a bypass here.) Auth is
    // resolved ONLY on the non-ACTIVE branch, so the common ACTIVE path stays a cheap
    // anonymous read.
    if (vendor.status !== VendorStatus.ACTIVE) {
      const clerkId = await getOptionalUserId()
      const callerUserId = clerkId
        ? (await db.user.findUnique({ where: { clerkId }, select: { id: true } }))?.id ?? null
        : null
      const isAdmin = clerkId ? await hasStrictAdminAuth() : false
      const privileged = await callerMayViewInactiveVendor(vendor.id, callerUserId, isAdmin, req)
      if (!privileged) return apiError('Vendor not found', 404, 'NOT_FOUND')
    }

    if (vendor.isOffline) return apiError('Vendor is currently offline', 503, 'VENDOR_OFFLINE')

    // Phase 5 gate: when enforcement is on, a not-ready vendor (no Stripe / no
    // available menu) is treated as not found — invisible to customers, matching
    // the marketplace list. menuItems already filtered to isAvailable, so length is
    // the available count. OFF by default → unchanged. Uses the shared predicate.
    if (isVendorReadinessEnforced() &&
        !vendorReady({ status: vendor.status, stripeVerified: vendor.stripeVerified, availableMenuCount: vendor.menuItems.length })) {
      return apiError('Vendor not found', 404, 'NOT_FOUND')
    }

    // Strip the gate-only field so it never reaches the wire.
    const { stripeVerified: _gateOnly, ...publicVendor } = vendor
    return success(publicVendor)
  } catch (err) {
    return handleApiError(err)
  }
}

// PATCH /api/vendors/:id
// Allows a vendor to update their own vendor record.
// Vendor auth required + caller must be a member of this vendor.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireVendorAuth()
    const { id } = await params

    // Ownership check — caller must belong to this vendor
    const user = await db.user.findUnique({ where: { clerkId } })
    if (!user) throw new ApiError('User record not found', 404, 'NOT_FOUND')

    const membership = await getVendorAuth(user.id, id, req)
    if (!membership) throw new ApiError('Forbidden', 403, 'FORBIDDEN')

    const body = await req.json()
    // `status` is intentionally excluded — vendors cannot deactivate themselves.
    // Status changes require admin or organizer auth (see /api/admin/vendors/:id).
    const { isBusy, isOffline, boothNumber, description, name, cuisineType, operatingHours, notificationPrefs } = body

    const vendor = await db.vendor.update({
      where: { id },
      data: {
        ...(isBusy !== undefined && {
          isBusy: Boolean(isBusy),
          busyUntil: isBusy ? new Date(Date.now() + 15 * 60 * 1000) : null,
        }),
        ...(isOffline !== undefined && { isOffline: Boolean(isOffline) }),
        ...(boothNumber !== undefined && { boothNumber }),
        ...(description !== undefined && { description }),
        ...(name !== undefined && { name: String(name) }),
        ...(cuisineType !== undefined && { cuisineType: String(cuisineType) }),
        ...(operatingHours !== undefined && { operatingHours }),
        ...(notificationPrefs !== undefined && { notificationPrefs }),
      },
    })

    // CACHE INVALIDATION — the stale-read trap. isOffline and isBusy are shown to CUSTOMERS
    // via the server-rendered discovery list (lib/fairs.ts getVendorsBySlugCached, cached
    // 120s under the 'vendors' tag). Without this, a vendor flips offline and customers keep
    // seeing them as available for up to two minutes. Bust the tag so the next render is
    // fresh. (name/cuisineType/description/booth also appear there — revalidate on any field
    // the discovery card reads.)
    if (isOffline !== undefined || isBusy !== undefined ||
        name !== undefined || cuisineType !== undefined || description !== undefined || boothNumber !== undefined) {
      revalidateTag('vendors', 'default')
    }

    // Determine which settings section was updated for audit granularity
    const isProfileUpdate = name !== undefined || cuisineType !== undefined || description !== undefined
    const isHoursUpdate   = operatingHours !== undefined

    if (isProfileUpdate) {
      logVendorAction(id, user.id, AUDIT_ACTIONS.SETTINGS_PROFILE_UPDATED, {
        fields: Object.fromEntries(
          Object.entries({ name, cuisineType, description }).filter(([, v]) => v !== undefined)
        ),
      })
    }
    if (isHoursUpdate) {
      logVendorAction(id, user.id, AUDIT_ACTIONS.SETTINGS_HOURS_UPDATED, {})
    }

    return success(vendor)
  } catch (err) {
    return handleApiError(err)
  }
}
