import { db } from '@/lib/db'
import { success, apiError, paginated } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { uniqueVendorSlug } from '@/lib/vendor-slug'
import { logger } from '@/lib/logger'
import { syncUserRoleMetadata } from '@/lib/role-sync'
import { readinessWhereIfEnforced } from '@/lib/vendor-readiness'

// GET /api/vendors?eventSlug=springfield-fair-2026&page=1&limit=20
// Returns active, online vendors for a given event. When ENFORCE_VENDOR_READINESS
// is on, also requires the (c) bar (stripeVerified + ≥1 available item) so unready
// vendors aren't shown as orderable. OFF by default → unchanged behavior.
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
      ...readinessWhereIfEnforced(),
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
    const {
      eventSlug, name, description, cuisineType, boothNumber,
      contactName, contactEmail, contactPhone,
      legalName, termsVersion,
    } = body

    if (!eventSlug || !name || !cuisineType) {
      return apiError('eventSlug, name, and cuisineType are required', 400, 'VALIDATION_ERROR')
    }
    // Legal consent is mandatory to apply — the signed legal name is the signature.
    if (!legalName || !String(legalName).trim()) {
      return apiError('Legal agreement must be signed to submit an application', 400, 'CONSENT_REQUIRED')
    }

    const event = await db.event.findUnique({ where: { urlSlug: eventSlug } })
    if (!event) return apiError('Event not found', 404, 'NOT_FOUND')

    // Resolve internal user
    const user = await db.user.findUnique({ where: { clerkId } })
    if (!user) return apiError('User not found — Clerk sync may be pending', 404, 'NOT_FOUND')

    const slug = await uniqueVendorSlug(name, event.id)

    // Auditable consent: name (signature) + version from the client (what they saw),
    // timestamp + IP set server-side (authoritative — not client-supplied).
    const acceptedIp = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null

    const vendor = await db.vendor.create({
      data: {
        eventId: event.id,
        name,
        slug,
        description,
        cuisineType,
        boothNumber,
        status: 'PENDING',
        contactName:  contactName  ?? null,
        contactEmail: contactEmail ?? null,
        contactPhone: contactPhone ?? null,
        termsAcceptedName: String(legalName).trim(),
        termsVersion:      termsVersion ?? null,
        termsAcceptedAt:   new Date(),
        termsAcceptedIp:   acceptedIp,
        vendorMembers: {
          create: { userId: user.id, role: 'owner' },
        },
      },
    })

    // Derive publicMetadata.roles[] from DB memberships (now includes this new
    // VendorMember) so the fast gate matches the authority immediately.
    try {
      await syncUserRoleMetadata(user.id)
    } catch (err) {
      // Non-fatal — vendor record exists; backfill/next sync will reconcile.
      logger.error('[Vendors] Failed to sync Clerk role metadata', { clerkId, error: String(err) })
    }

    return success(vendor, 201)
  } catch (err) {
    return handleApiError(err)
  }
}
