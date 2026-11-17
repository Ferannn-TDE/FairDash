import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { currentUser } from '@clerk/nextjs/server'
import { VendorStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { decideVendor } from '@/lib/approvals'
import { settingsActorRole } from '@/lib/roles'
import { reviewerNameFrom } from '@/lib/reviewer-label'
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
// ⚠️ Mostly NOT the booth. Vendor.status ("may this BOOTH trade") is a DIFFERENT axis with its own
// routes at /api/admin/vendors/[id]/approve|reject. [id] there means a Vendor, here it means a
// VendorMember. Approving an operator does not make their booth tradeable — with ONE exception
// since Nov 16 (sub-step C, below): admitting the OWNER of a PENDING booth on a fair with no
// organizer runs the full vendor approval (lib/approvals.ts decideVendor), never a plain write here.
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
//
// THE BOOTH OPERATORS BUG (fixed Nov 16, sub-step C, Jordan's decisions): admitting a booth's OWNER
// used to leave the booth PENDING, so an admin who "approved the vendor" here had approved nobody's
// trading. Now, for the OWNER of a PENDING booth:
//   fair with NO organizer (FairSynq is its approver) → the full vendor approval (lib/approvals.ts
//     decideVendor): Stripe payouts asked fresh, the go-live checklist, booth + owner together in
//     one transaction, ApprovalAction (reviewer name, detail.via 'booth-operators') and the vendor's
//     email. A REJECTED owner is re-admitted with it. Any refusal → NOTHING changes (the owner stays
//     as it was) and the refusal is returned.
//   fair WITH an organizer (they approve the booth) → the person only, as before; the response says
//     boothWaitsForOrganizer and the panel shows "Booth waits for the organizer's approval".
// Staff rows, and owners of booths that are not PENDING, are the person only, exactly as before.
const SELECT_MEMBER = {
  id: true, role: true,
  approvalStatus: true, approvedAt: true, approvedBy: true, rejectionReason: true,
  user: { select: { id: true, name: true, email: true } },
  vendor: { select: { id: true, name: true, status: true, event: { select: { name: true, urlSlug: true } } } },
} as const

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
      select: {
        id: true, userId: true, vendorId: true, approvalStatus: true, role: true,
        vendor: { select: { status: true, event: { select: { organizerId: true } } } },
      },
    })
    if (!member) throw new ApiError('Vendor operator not found', 404, 'VENDOR_MEMBER_NOT_FOUND')

    const ownerOfPendingBooth = member.role === 'owner' && member.vendor.status === VendorStatus.PENDING
    const boothApproved = ownerOfPendingBooth && !member.vendor.event.organizerId
    const boothWaitsForOrganizer = ownerOfPendingBooth && !!member.vendor.event.organizerId

    if (boothApproved) {
      // The full approval; it writes the owner row itself (APPROVED, approvedBy = this admin's User.id).
      const user = await currentUser()
      await decideVendor(member.vendorId, 'approve', null, {
        clerkId: adminClerkId, actorType: settingsActorRole(user?.publicMetadata) ?? 'admin',
        name: reviewerNameFrom({ fullName: user?.fullName, firstName: user?.firstName, lastName: user?.lastName }),
      }, { readmitOwner: true, via: 'booth-operators' })
      revalidateTag('vendors', 'default') // now ACTIVE → orderable; bust the cached discovery list
    } else {
      await db.vendorMember.update({
        where: { id },
        data: {
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: admin.id,
          rejectionReason: null, // fresh decision — a prior rejection no longer applies
        },
      })
    }
    const updated = await db.vendorMember.findUniqueOrThrow({ where: { id }, select: SELECT_MEMBER })

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
      previousStatus: member.approvalStatus, boothApproved, boothWaitsForOrganizer,
    })

    return success({ vendorMember: updated, boothApproved, boothWaitsForOrganizer })
  } catch (err) {
    return handleApiError(err)
  }
}
