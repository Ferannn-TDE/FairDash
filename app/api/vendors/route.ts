import { clerkClient } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { success, apiError, paginated } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/vendors?eventSlug=springfield-fair-2026&page=1&limit=20
// Returns active, online vendors for a given event.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const eventSlug = searchParams.get('eventSlug')
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
    const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '20'))
    const skip = (page - 1) * limit

    if (!eventSlug) return apiError('eventSlug query param is required', 400, 'VALIDATION_ERROR')

    const event = await db.event.findUnique({ where: { urlSlug: eventSlug } })
    if (!event) return apiError('Event not found', 404, 'NOT_FOUND')

    const where = {
      eventId: event.id,
      status: 'ACTIVE' as const,
      isOffline: false,
    }

    const [vendors, total] = await Promise.all([
      db.vendor.findMany({
        where,
        skip,
        take: limit,
        include: {
          _count: { select: { menuItems: { where: { isAvailable: true } } } },
        },
        orderBy: { name: 'asc' },
      }),
      db.vendor.count({ where }),
    ])

    return paginated(vendors, total, page, limit)
  } catch (err) {
    return handleApiError(err)
  }
}

// POST /api/vendors
// Submits a vendor application. Requires auth.
// Full 10-step onboarding document processing is handled client-side;
// this endpoint persists the final application payload.
export async function POST(req: Request) {
  try {
    const clerkId = await requireAuth()
    const body = await req.json()
    const { eventSlug, name, description, cuisineType, boothNumber } = body

    if (!eventSlug || !name || !cuisineType) {
      return apiError('eventSlug, name, and cuisineType are required', 400, 'VALIDATION_ERROR')
    }

    const event = await db.event.findUnique({ where: { urlSlug: eventSlug } })
    if (!event) return apiError('Event not found', 404, 'NOT_FOUND')

    // Resolve internal user
    const user = await db.user.findUnique({ where: { clerkId } })
    if (!user) return apiError('User not found — Clerk sync may be pending', 404, 'NOT_FOUND')

    const vendor = await db.vendor.create({
      data: {
        eventId: event.id,
        name,
        description,
        cuisineType,
        boothNumber,
        status: 'PENDING',
        vendorMembers: {
          create: { userId: user.id, role: 'owner' },
        },
      },
    })

    // Set publicMetadata.role = 'vendor' so requireVendorAuth() passes immediately
    try {
      const clerk = await clerkClient()
      await clerk.users.updateUserMetadata(clerkId, {
        publicMetadata: { role: 'vendor' },
      })
    } catch (err) {
      // Non-fatal — vendor record exists; admin can manually set role if needed
      console.error('[Vendors] Failed to set Clerk publicMetadata for', clerkId, err)
    }

    return success(vendor, 201)
  } catch (err) {
    return handleApiError(err)
  }
}
