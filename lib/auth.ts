import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from './db'
import { ApiError } from './api-error'
import { getVendorAuth, type VendorAuthPayload } from './vendor-auth-cache'
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

/** Require auth + vendor role (checks Clerk metadata). Returns Clerk userId. */
export async function requireVendorAuth(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')

  const user = await currentUser()
  const role = user?.publicMetadata?.role as string | undefined
  const isVendorLegacy = user?.unsafeMetadata?.isVendor === true

  if (role !== 'vendor' && !isVendorLegacy) {
    throw new ApiError('Forbidden — vendor access required', 403, 'FORBIDDEN')
  }

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

/** Require auth + runner role. Returns Clerk userId. */
export async function requireRunnerAuth(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')

  const user = await currentUser()
  const role = user?.publicMetadata?.role as string | undefined

  if (role !== 'runner') {
    throw new ApiError('Forbidden — runner access required', 403, 'FORBIDDEN')
  }

  return userId
}

/** Require auth + membership in a specific vendor. Returns { user, membership }. */
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

/** Require auth + admin role. Returns Clerk userId. */
export async function requireAdminAuth(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')

  const user = await currentUser()
  const role = user?.publicMetadata?.role as string | undefined

  if (role !== 'admin' && role !== 'super_admin') {
    throw new ApiError('Forbidden — admin access required', 403, 'FORBIDDEN')
  }

  return userId
}
