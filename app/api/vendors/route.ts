import { db } from '@/lib/db'
import { assertFairAcceptsJoins } from '@/lib/fair-join-gate'
import { success, apiError, paginated } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { uniqueVendorSlug } from '@/lib/vendor-slug'
import { createVendorWithOwner, syncPayeeRoles } from '@/lib/payee-membership'
import { enqueueSignupAlert, enqueueApplicationReceived } from '@/lib/notifications'
import { VENDOR_AGREEMENT_VERSION } from '@/lib/legal/vendor-agreement'
import { readinessWhereIfEnforced } from '@/lib/vendor-readiness'
import { demoHiddenWhere } from '@/lib/demo-vendor'
import { PUBLIC_VENDOR_SELECT } from '@/lib/public-vendor-select'
import { customerReachableScope } from '@/lib/event-listing'
import { checkPhone, INVALID_PHONE } from '@/lib/phone'

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

    // Archived (soft-deleted) fairs vanish from the customer vendor list. Not
    // ACTIVE-gated: this hydrates a fair's vendors and the fair page itself already
    // 404s non-live fairs, so status gating here would be redundant.
    // The customer vendor list: a sign-up-only event has no customer-facing vendors.
    const event = await db.event.findFirst({ where: { urlSlug: eventSlug, archivedAt: null, ...customerReachableScope() } })
    if (!event) return apiError('Event not found', 404, 'NOT_FOUND')
    // ACQUISITION GATE: a DRAFT fair must never gain a Vendor — Vendor CASCADEs on Event delete,
    // and discarding a draft is a hard delete. Resolving by slug alone (as above) is exactly how a
    // leaked draft slug could attach one. See lib/fair-join-gate.ts.
    assertFairAcceptsJoins(event.status, event.name)

    const where = {
      eventId: event.id,
      status: 'ACTIVE' as const,
      isOffline: false,
      ...readinessWhereIfEnforced(),
      // Demo booths hidden with live Stripe keys (lib/demo-vendor.ts).
      ...demoHiddenWhere(),
    }

    const [vendors, total] = await Promise.all([
      db.vendor.findMany({
        where,
        skip,
        take: limit,
        // Public, no auth: the select is the boundary (audit H2). See lib/public-vendor-select.ts.
        select: PUBLIC_VENDOR_SELECT,
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
      legalName, agreedToVendorAgreement,
    } = body

    if (!eventSlug || !name || !cuisineType) {
      return apiError('eventSlug, name, and cuisineType are required', 400, 'VALIDATION_ERROR')
    }
    // Legal consent is mandatory to apply: the typed legal name is the signature (C-19) AND the
    // vendor must tick "I agree to the FairSynq Vendor Agreement" (item 8). Both are checked here;
    // the wizard's own gate is only UX. Applies to self sign-up only: no other path creates a Vendor
    // through this route (admin/organizer have no create route; scripts write directly).
    if (!legalName || !String(legalName).trim()) {
      return apiError('Legal agreement must be signed to submit an application', 400, 'CONSENT_REQUIRED')
    }
    if (agreedToVendorAgreement !== true) {
      return apiError('You must agree to the FairSynq Vendor Agreement to apply', 400, 'CONSENT_REQUIRED')
    }
    // Phone (sign-up-fixes commit 1): the same rule the wizard's step 1 checks, enforced here
    // because the browser check can be skipped. Saved as +1XXXXXXXXXX.
    const phoneCheck = checkPhone(contactPhone, { required: true })
    if (!phoneCheck.ok) return apiError(phoneCheck.error, 400, INVALID_PHONE)
    // Email (sign-up-fixes commit 3): spaces around the typed address are trimmed before saving;
    // an address of only spaces counts as blank (stored as null, so no confirmation email).
    const savedContactEmail = typeof contactEmail === 'string' && contactEmail.trim() ? contactEmail.trim() : null

    // Can't apply to a soft-deleted fair. UPCOMING is allowed — vendors apply before
    // a fair goes live — so this is archivedAt-gated only, not ACTIVE-gated.
    const event = await db.event.findFirst({ where: { urlSlug: eventSlug, archivedAt: null } })
    if (!event) return apiError('Event not found', 404, 'NOT_FOUND')
    // ACQUISITION GATE: a DRAFT fair must never gain a Vendor (Vendor CASCADEs on Event delete,
    // and discarding a draft is a hard delete). d026119 meant to put this here but it landed in
    // GET, which shares the same lookup line; signup stayed ungated until 2026-10-20.
    assertFairAcceptsJoins(event.status, event.name)

    // Resolve internal user
    const user = await db.user.findUnique({ where: { clerkId } })
    if (!user) return apiError('User not found — Clerk sync may be pending', 404, 'NOT_FOUND')

    const slug = await uniqueVendorSlug(name, event.id)

    // Auditable consent: name (signature) + version from the client (what they saw),
    // timestamp + IP set server-side (authoritative — not client-supplied).
    const acceptedIp = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null

    // Vendor + owner VendorMember AND the client's sign-up alert, in one transaction (item 9): the
    // alert can't exist without the application or go missing with it. Roles sync after commit
    // (lib/payee-membership deferRoleSync), so a slow Clerk call can't hold the transaction open.
    const vendor = await db.$transaction(async tx => {
      const v = await createVendorWithOwner(
        {
          eventId: event.id,
          name,
          slug,
          description,
          cuisineType,
          boothNumber,
          status: 'PENDING',
          contactName:  contactName  ?? null,
          contactEmail: savedContactEmail,
          contactPhone: phoneCheck.value,
          termsAcceptedName: String(legalName).trim(),
          // Always the version this server publishes (lib/legal/vendor-agreement.ts), never a value
          // from the browser: the record says which terms were actually shown.
          termsVersion:      VENDOR_AGREEMENT_VERSION,
          termsAcceptedAt:   new Date(),
          termsAcceptedIp:   acceptedIp,
        },
        { userId: user.id },
        { db: tx, deferRoleSync: true },
      )
      await enqueueSignupAlert(tx, v.id, {
        kind: 'vendor', name: v.name, contactName: v.contactName, email: v.contactEmail ?? user.email, phone: v.contactPhone,
      })
      // The applicant's confirmation, to the email typed on the form (none when it was left blank).
      await enqueueApplicationReceived(tx, v.id, v.contactEmail, { kind: 'vendor', name: v.name })
      return v
    })
    await syncPayeeRoles(user.id, 'payee-membership:vendor')

    return success(vendor, 201)
  } catch (err) {
    return handleApiError(err)
  }
}
