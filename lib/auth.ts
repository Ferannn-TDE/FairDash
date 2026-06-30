import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from './db'
import { ApiError } from './api-error'
import { getVendorAuth, type VendorAuthPayload } from './vendor-auth-cache'
import { hasRole } from './roles'
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

/** Require auth + organizer role + DB orgMember. Returns { clerkId, organizerId }. */
export async function requireOrganizerAuth(): Promise<{ clerkId: string; organizerId: string }> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')

  const dbUser = await db.user.findUnique({ where: { clerkId } })
  if (!dbUser) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')

  const orgMember = await db.orgMember.findFirst({ where: { userId: dbUser.id } })
  if (!orgMember) throw new ApiError('Forbidden — organizer access required', 403, 'FORBIDDEN')

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
