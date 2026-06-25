import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api-error'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { enforceRateLimit } from '@/lib/ratelimit'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'
import { isVendorReadinessEnforced, vendorReady } from '@/lib/vendor-readiness'

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
    const vendor = await db.vendor.findFirst({
      where: { OR: [{ id }, { slug: id }] },
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
        foodHandlerPermitUrl: true,
        insuranceUrl: true,
        businessLicenseUrl: true,
        stripeAccountId: true,
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
    if (vendor.isOffline) return apiError('Vendor is currently offline', 503, 'VENDOR_OFFLINE')

    // Phase 5 gate: when enforcement is on, a not-ready vendor (no Stripe / no
    // available menu) is treated as not found — invisible to customers, matching
    // the marketplace list. menuItems already filtered to isAvailable, so length is
    // the available count. OFF by default → unchanged. Uses the shared predicate.
    if (isVendorReadinessEnforced() &&
        !vendorReady({ status: vendor.status, stripeVerified: vendor.stripeVerified, availableMenuCount: vendor.menuItems.length })) {
      return apiError('Vendor not found', 404, 'NOT_FOUND')
    }

    return success(vendor)
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
    const { isBusy, isOffline, boothNumber, description, name, cuisineType, operatingHours } = body

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
      },
    })

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
