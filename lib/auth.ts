import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from './db'
import { ApiError } from './api-error'
import { getVendorAuth, type VendorAuthPayload } from './vendor-auth-cache'
import { hasRole, hasStrictAdminRole } from './roles'
import { organizerSuspensionError } from './organizer-suspension'
import { organizerApprovalError } from './organizer-approval'
import { boothOperatingMessage, vendorOperatorState } from './vendor-operator-state'
import type { User } from '@prisma/client'

export async function requireAuth(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')
  return userId
}

export async function getOptionalUserId(): Promise<string | null> {
  const { userId } = await auth()
  return userId
}

// ── DB user helpers ──────────────────────────────────────────────────────────

export async function getDbUser(clerkId: string): Promise<User | null> {
  return db.user.findUnique({ where: { clerkId } })
}

/** Require auth + a matching DB User row. Throws 404 if not yet synced. */
export async function requireDbUser(): Promise<User> {
  const clerkId = await requireAuth()
  const user = await db.user.findUnique({ where: { clerkId } })
  if (!user) throw new ApiError('User record not found', 404, 'NOT_FOUND')
  return user
}

/** Require auth + vendor access. Authority = a VendorMember row. Returns Clerk userId.
 *  (publicMetadata.roles is the fast gate for middleware/navbar; API authorization
 *  verifies against the DB so the two can't drift.) */
export async function requireVendorAuth(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')

  const dbUser = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } })
  if (!dbUser) throw new ApiError('Forbidden — vendor access required', 403, 'FORBIDDEN')

  const member = await db.vendorMember.findFirst({ where: { userId: dbUser.id }, select: { id: true } })
  if (!member) throw new ApiError('Forbidden — vendor access required', 403, 'FORBIDDEN')

  return userId
}

/** Require auth + organizer role + DB orgMember. Returns { clerkId, organizerId }.
 *  A6 kill-switch: the resolved organizer's suspension state is read FRESH here on
 *  every request, so an admin suspension takes effect on the organizer's NEXT
 *  request with no token lag. A suspended org → 403 ORGANIZER_SUSPENDED. */
export async function requireOrganizerAuth(): Promise<{ clerkId: string; organizerId: string }> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')

  const dbUser = await db.user.findUnique({ where: { clerkId } })
  if (!dbUser) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')

  // Resolve membership + the org's approval AND suspension state in one read (fresh per
  // request — so both gates take effect on the NEXT request, with no token lag).
  const orgMember = await db.orgMember.findFirst({
    where: { userId: dbUser.id },
    select: {
      organizerId: true,
      organizer: {
        select: {
          suspendedAt: true, suspendedReason: true,
          approvalStatus: true, rejectionReason: true,
        },
      },
    },
  })
  if (!orgMember) throw new ApiError('Forbidden — organizer access required', 403, 'FORBIDDEN')

  // #7: the APPROVAL gate. Checked BEFORE suspension: an organizer who was never approved
  // isn't "suspended", they simply may not operate yet, and the message must say so.
  // This ONE check blocks a pending organizer from every organizer power — fair creation,
  // VENDOR APPROVAL, refunds, disputes, chargebacks — because all 26 organizer routes funnel
  // through here. Server-side, not hidden buttons.
  // (/api/organizer/profile deliberately uses plain requireAuth, so a pending organizer can
  //  still load an "awaiting approval" shell rather than hitting a wall.)
  const notApproved = organizerApprovalError(orgMember.organizer)
  if (notApproved) throw notApproved

  // A6: immediate-effect suspension gate — distinct code from the not-authorized 403.
  const suspended = organizerSuspensionError(orgMember.organizer)
  if (suspended) throw suspended

  return { clerkId, organizerId: orgMember.organizerId }
}

/** Require auth + runner access. Authority = a Runner row. Returns Clerk userId. */
export async function requireRunnerAuth(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')

  const dbUser = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } })
  if (!dbUser) throw new ApiError('Forbidden — runner access required', 403, 'FORBIDDEN')

  const runner = await db.runner.findUnique({ where: { userId: dbUser.id }, select: { id: true } })
  if (!runner) throw new ApiError('Forbidden — runner access required', 403, 'FORBIDDEN')

  return userId
}

/** Require auth + membership in a specific vendor. Returns { user, membership }.
 *  ERROR CONTRACT: no DB user → 401 "Unauthorized" UNAUTHORIZED; not a member →
 *  403 "Forbidden" FORBIDDEN. Caller supplies clerkId (it runs requireAuth /
 *  requireVendorAuth first). Used by stats / revenue / vendors/[id] PATCH.
 *  ⚠️ DIFFERENT error contract than requireVendorMembershipById() below
 *  (404 "User not found" / 403 "Access denied") — do not swap one for the other. */
export async function requireVendorMembership(
  clerkId:  string,
  vendorId: string,
  req?:     object
): Promise<{ user: User; membership: VendorAuthPayload }> {
  const user = await db.user.findUnique({ where: { clerkId } })
  if (!user) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')
  const membership = await getVendorAuth(user.id, vendorId, req)
  if (!membership) throw new ApiError('Forbidden', 403, 'FORBIDDEN')
  return { user, membership }
}

/** Require auth + membership in the vendor named by a route's [id] param.
 *  ERROR CONTRACT (verbatim match to the inline triad these routes used, so the
 *  swap is byte-identical): not signed in → 401 "Unauthorized" UNAUTHORIZED (via
 *  requireAuth); no DB user → 404 "User not found" NOT_FOUND; not a member →
 *  403 "Access denied" FORBIDDEN. This is the contract for the app/api/vendors/[id]/*
 *  routes. Runs requireAuth internally and returns the resolved ids.
 *  ⚠️ DIFFERENT error contract than requireVendorMembership() above (401/Forbidden)
 *  — pick by the contract the route already emits; do not swap them. */
export async function requireVendorMembershipById(
  vendorId: string,
  req?:     object
): Promise<{ clerkId: string; userId: string; membership: VendorAuthPayload }> {
  const clerkId = await requireAuth()
  const user = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
  if (!user) throw new ApiError('User not found', 404, 'NOT_FOUND')
  const membership = await getVendorAuth(user.id, vendorId, req)
  if (!membership) throw new ApiError('Access denied', 403, 'FORBIDDEN')
  return { clerkId, userId: user.id, membership }
}

/**
 * THE ACCEPT-VERB GATE — "may this human act as this booth, right now".
 *
 * The step the portal door was written against and that had never been built: the door
 * (app/vendor/layout.tsx) decides what is OFFERED, this decides what is SERVED. Until it
 * existed, EVERY vendor authorisation in the codebase asked one question — "is this person
 * attached to a booth at all" (requireVendorAuth's `select: { id: true }`, and getVendorAuth's
 * payload, which did not carry either status). So a PENDING or REJECTED operator who reached
 * the buttons could work a booth normally, and hiding the nav entry was all that stopped them.
 * That is a UI affordance standing in for authorisation.
 *
 * TWO INDEPENDENT AXES, BOTH ENFORCED, DISTINCT CODES (schema.prisma:368 explains the pair):
 *   VendorMember.approvalStatus  — may this HUMAN operate this booth  → VENDOR_OPERATOR_NOT_APPROVED
 *   Vendor.status                — may this BOOTH trade              → VENDOR_BOOTH_NOT_OPERATING
 * Neither implies the other, so checking one leaves the other's hole open. Separate codes
 * because the two produce different advice: "wait for your admittance review" vs "your booth is
 * paused, contact the organizer".
 *
 * 🔑 READ FRESH, DELIBERATELY NOT THROUGH getVendorAuth — same reasoning as the door, and it
 * applies harder here. That cache holds a membership for 600s at role 'owner' (every operator on
 * this fair is an 'owner'), so routing this through it would let a just-rejected operator keep
 * taking money-bearing actions for ~10 minutes. It would also cache the BOOTH axis, which
 * nothing invalidates: an organizer pausing a booth expects that to bite immediately, the way
 * the A6 organizer kill-switch does. One indexed lookup per action verb is the price.
 *
 * PER-BOOTH, AND STRICTER THAN THE DOOR ON PURPOSE. vendorOperatorState() is fed the ONE
 * membership for the booth being acted on, not the whole set, so an operator APPROVED at booth A
 * and PENDING at booth B is refused at B. The door's "one APPROVED membership admits you to the
 * portal" is a deliberate simplification for navigation (see its comment); it must not extend to
 * acting on a specific booth's orders and money. This is the per-fair refinement that comment
 * defers, applied at the layer that actually knows which booth is being asked for.
 *
 * SCOPE — this gates ACTING, never BECOMING APPROVABLE. The carve-out
 * (VENDOR_GATE_CARVE_OUT_SEGMENTS) exists so a gated operator can still reach onboarding and
 * settings to fix whatever is holding their application up, and Stripe Connect is launched from
 * there. Those live on their own routes (vendors/[id]/stripe/*, vendors/[id]/documents) and are
 * deliberately NOT wired to this gate — refusing them would rebuild the deadlock the carve-out
 * was built to prevent: refused for being incomplete, then locked out of the only screens that
 * complete it. Do not "finish the job" by adding this to those routes.
 *
 * Callers prove membership first (requireVendorAuth / requireVendorMembership*); this asks the
 * second question about a membership already established, and re-reads it fail-closed.
 */
export async function requireVendorMayOperate(userId: string, vendorId: string): Promise<void> {
  const member = await db.vendorMember.findFirst({
    where:  { userId, vendorId },
    select: {
      approvalStatus:  true,
      rejectionReason: true,
      vendor: { select: { status: true } },
    },
  })
  // Membership was proven by the caller; a miss here means it vanished mid-request (or the
  // caller resolved a different booth). Fail closed rather than falling through to the checks.
  if (!member) throw new ApiError('Access denied', 403, 'FORBIDDEN')

  // Axis 1 — the operator. Worded by the SAME pure function the gate screen renders from, so
  // the 403 and the screen cannot drift into two different accounts of the same refusal. This
  // is the use vendorOperatorState's `message` field was written for (see its comment).
  const operator = vendorOperatorState([{
    approvalStatus:  member.approvalStatus as 'PENDING' | 'APPROVED' | 'REJECTED',
    rejectionReason: member.rejectionReason,
  }])
  if (operator.state !== 'ADMITTED') {
    throw new ApiError(operator.message!, 403, 'VENDOR_OPERATOR_NOT_APPROVED')
  }

  // Axis 2 — the booth.
  const boothProblem = boothOperatingMessage(member.vendor.status)
  if (boothProblem) {
    throw new ApiError(boothProblem, 403, 'VENDOR_BOOTH_NOT_OPERATING')
  }
}

/** Require auth + admin role. Returns Clerk userId.
 *  Admin family lives in publicMetadata.roles[] (unified shape; read via hasRole),
 *  consistent with the admin layout, middleware, and /api/auth/access. */
export async function requireAdminAuth(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')

  const user = await currentUser()
  if (!hasRole(user?.publicMetadata, 'admin')) {
    throw new ApiError('Forbidden — admin access required', 403, 'FORBIDDEN')
  }

  return userId
}

/** Require auth + STRICT platform admin (admin | super_admin — NOT event_operator).
 *  Read via a FRESH currentUser() call, not JWT sessionClaims, so a revoked admin
 *  loses access on the next request. This is the gate for cross-fair / cross-org
 *  authority: the fair chokepoint (requireAdminFairContext) and the organizer
 *  kill-switch write both sit behind it. Returns Clerk userId. */
export async function requireStrictAdminAuth(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')

  const user = await currentUser()
  if (!hasStrictAdminRole(user?.publicMetadata)) {
    throw new ApiError('Forbidden — admin access required', 403, 'FORBIDDEN')
  }

  return userId
}

/** Non-throwing variant of requireStrictAdminAuth — "is this caller a strict platform
 *  admin?" Same FRESH currentUser() read, so it carries the same no-stale-token property.
 *  For routes where admin is an ADDITIONAL grant on top of another gate (e.g. an organizer
 *  route where a platform admin may also look), not the gate itself. */
export async function hasStrictAdminAuth(): Promise<boolean> {
  const { userId } = await auth()
  if (!userId) return false
  const user = await currentUser()
  return hasStrictAdminRole(user?.publicMetadata)
}
