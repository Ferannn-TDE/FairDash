import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api-error'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { enforceRateLimit } from '@/lib/ratelimit'

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
    const { isBusy, isOffline, boothNumber, description, name, cuisineType } = body

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
      },
    })

    return success(vendor)
  } catch (err) {
    return handleApiError(err)
  }
}
