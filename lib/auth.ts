import { auth, currentUser } from '@clerk/nextjs/server'
import { ApiError } from './api-error'

/**
 * Require a signed-in user. Throws 401 if not authenticated.
 * Use in any protected API route.
 *
 * @example
 * export async function GET() {
 *   const userId = await requireAuth()
 *   // userId is the Clerk user ID string
 * }
 */
export async function requireAuth(): Promise<string> {
  const { userId } = await auth()
  if (!userId) {
    throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')
  }
  return userId
}

/**
 * Get the authenticated user ID without throwing.
 * Returns null for unauthenticated requests.
 */
export async function getOptionalUserId(): Promise<string | null> {
  const { userId } = await auth()
  return userId
}

/**
 * Require vendor role. Checks Clerk publicMetadata.role === 'vendor'.
 * Will be upgraded in Part 2 to also verify against the DB vendor record.
 *
 * @example
 * export async function POST() {
 *   const userId = await requireVendorAuth()
 * }
 */
export async function requireVendorAuth(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED')

  const user = await currentUser()
  const role = user?.publicMetadata?.role as string | undefined

  // During Phase 1, also accept the legacy isVendor unsafeMetadata flag
  // set by the current BecomeVendor wizard. Phase 2 will migrate to DB roles.
  const isVendorLegacy = user?.unsafeMetadata?.isVendor === true

  if (role !== 'vendor' && !isVendorLegacy) {
    throw new ApiError('Forbidden — vendor access required', 403, 'FORBIDDEN')
  }

  return userId
}

/**
 * Require admin role. Checks Clerk publicMetadata.role === 'admin'.
 *
 * @example
 * export async function GET() {
 *   const userId = await requireAdminAuth()
 * }
 */
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
