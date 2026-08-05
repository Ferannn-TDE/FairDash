import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireStrictAdminAuth } from '@/lib/auth'
import { invalidateVendorAuth } from '@/lib/vendor-auth-cache'
import { logger } from '@/lib/logger'

// PATCH /api/admin/vendor-members/[id]/approve
//
// Admits a HUMAN to operate a booth: flips VendorMember.approvalStatus PENDING (or REJECTED) →
// APPROVED and clears any prior rejection.
//
// ⚠️ NOT the booth. Vendor.status ("may this BOOTH trade") is a DIFFERENT axis with its own
// routes at /api/admin/vendors/[id]/approve|reject. These were deliberately NOT extended: [id]
// there means a Vendor, here it means a VendorMember, and one endpoint whose id means two
// subjects is worse than two endpoints that each mean one. Approving an operator does not make
// their booth tradeable, and vice versa.
//
// PLATFORM-LEVEL AUTHORITY. requireStrictAdminAuth — admin | super_admin, NOT event_operator —
// matching the organizer approve route rather than the runner one. Admitting someone to a portal
// that accepts orders and draws payouts is platform authority.
//
// NO SELF-APPROVAL, structurally. A vendor identity carries no admin role, and the role is read
// FRESH from Clerk per request (never from a JWT they might hold stale), so a pending operator is
// rejected by the helper and never reaches the update. The property comes from the gate, not from
// a check we remembered to write.
//
// REVERSIBLE — deliberately unlike the runner routes, which 409 unless the row is PENDING. A
// rejected operator must be re-admittable (an appeal, a corrected document, an admin mistake), so
// REJECTED → APPROVED is a legal transition and rejectionReason is cleared: this is a fresh
// decision, not an amendment to the old one. Mirrors the organizer approve route.
//
// FAIR-SCOPING: none, on purpose. VendorMember has no eventId — it reaches an event only via
// vendor.event — and a human may operate booths at several fairs, so "may this person operate at
// all" is not a fair-scoped question. Like the organizer approve route, this resolves a
// VendorMember (never an Event), so the admin fair-chokepoint invariant is untouched.
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const adminClerkId = await requireStrictAdminAuth()

    // approvedBy is stored as a DB User.id, not a Clerk id. User.id is the only identity this
    // database can JOIN on, so "who admitted this operator" stays answerable in SQL instead of
    // requiring a Clerk round-trip. (The two shipped predecessors disagree on this — runner
    // stores User.id, organizer stores a Clerk id — and User.id is the one worth keeping.)
    const admin = await db.user.findUnique({ where: { clerkId: adminClerkId }, select: { id: true } })
    if (!admin) throw new ApiError('Admin user not found', 404, 'USER_NOT_FOUND')

    const { id } = await params
    const member = await db.vendorMember.findUnique({
      where: { id },
      select: { id: true, userId: true, vendorId: true, approvalStatus: true },
    })
    if (!member) throw new ApiError('Vendor operator not found', 404, 'VENDOR_MEMBER_NOT_FOUND')

    const updated = await db.vendorMember.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: admin.id,
        rejectionReason: null, // fresh decision — a prior rejection no longer applies
      },
      select: {
        id: true, role: true,
        approvalStatus: true, approvedAt: true, approvedBy: true, rejectionReason: true,
        user: { select: { id: true, name: true, email: true } },
        vendor: { select: { id: true, name: true, status: true, event: { select: { name: true, urlSlug: true } } } },
      },
    })

    // CACHE INVALIDATION — wired AHEAD of the reader it protects, on purpose.
    // Nothing consults approvalStatus yet (the portal gate is a later commit), so today this
    // line changes nothing observable. It is here now because getVendorAuth caches a membership
    // for 600s + jitter at role 'owner' (lib/vendor-auth-cache.ts) — and every operator on this
    // fair is an 'owner'. The moment the gate reads through that cache, an un-invalidated reject
    // would leave a removed operator working for up to ~10 minutes. Organizer and runner have no
    // such cache and so have no equivalent line; retrofitting it into the enforcement commit is
    // exactly how that staleness hole would ship. It costs nothing here and is load-bearing there.
    await invalidateVendorAuth(member.userId, member.vendorId)

    logger.info('[VendorOperatorAdmittance] APPROVED', {
      adminUserId: admin.id, vendorMemberId: updated.id,
      operatorUserId: updated.user.id, vendorId: updated.vendor.id,
      previousStatus: member.approvalStatus,
    })

    return success({ vendorMember: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
