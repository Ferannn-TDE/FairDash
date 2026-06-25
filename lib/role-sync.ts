import { createClerkClient } from '@clerk/backend'
import { db } from './db'

// Use @clerk/backend directly (not @clerk/nextjs/server's clerkClient) so this
// helper works identically in API routes AND in standalone scripts — the
// nextjs wrapper can't resolve CLERK_SECRET_KEY outside Next's runtime.
let _clerk: ReturnType<typeof createClerkClient> | null = null
function getClerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  return _clerk
}

// ─── Auth source-of-truth model ───────────────────────────────────────────────
//
// Clerk publicMetadata.roles[]  = the FAST GATE (cheap, no DB round-trip):
//   - proxy.ts middleware (Step 5 role-gating)
//   - RoleContext / navbar (app/_contexts/RoleContext.tsx)
//   - RoleAuthCard login auto-push (via /api/auth/access, metadata-first)
//
// DB membership rows             = the AUTHORITY (correctness-critical):
//   - OrgMember   → 'organizer'
//   - VendorMember→ 'vendor'
//   - Runner      → 'runner'
//   - lib/auth.ts API gates + per-layout resource checks read these.
//
// The two are KEPT IN SYNC by syncUserRoleMetadata: metadata.roles is DERIVED
// from the DB membership rows and never hand-set. Every code path that creates or
// deletes a membership row MUST call syncUserRoleMetadata(userId) afterwards so
// the fast gate can never drift from the authority.
//
// EXCEPTION — admin family ('admin' | 'super_admin' | 'event_operator'): these
// have NO DB membership model; they're granted by invite directly in Clerk
// metadata. Sync PRESERVES any admin-family role already present and never
// derives or drops it. (The admin gate reads roles[] via lib/roles.ts hasRole();
// the legacy singular publicMetadata.role was migrated by
// scripts/migrate-admin-to-roles.ts.)

const ADMIN_FAMILY = ['admin', 'super_admin', 'event_operator']

/** Roles derived purely from a user's DB membership rows (the authority). */
export async function computeRolesFromDb(userId: string): Promise<string[]> {
  const [org, vendor, runner] = await Promise.all([
    db.orgMember.findFirst({ where: { userId }, select: { id: true } }),
    db.vendorMember.findFirst({ where: { userId }, select: { id: true } }),
    db.runner.findUnique({ where: { userId }, select: { id: true } }),
  ])
  const roles: string[] = []
  if (org) roles.push('organizer')
  if (vendor) roles.push('vendor')
  if (runner) roles.push('runner')
  return roles
}

/**
 * Recompute a user's Clerk publicMetadata.roles[] from their DB memberships and
 * write it back. Idempotent: it sets the full correct array (no append-drift),
 * preserving only admin-family roles that were granted directly in metadata.
 *
 * @param userId  DB User.id (NOT the Clerk id).
 * @returns { clerkId, roles } written, or null if the user has no Clerk id.
 */
export async function syncUserRoleMetadata(
  userId: string,
): Promise<{ clerkId: string; roles: string[] } | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { clerkId: true } })
  if (!user?.clerkId) return null

  const dbRoles = await computeRolesFromDb(userId)

  const clerk = getClerk()
  const clerkUser = await clerk.users.getUser(user.clerkId)
  const existing = Array.isArray(clerkUser.publicMetadata?.roles)
    ? (clerkUser.publicMetadata.roles as string[])
    : []

  // Keep admin-family grants (metadata-only); recompute everything else from DB.
  const preservedAdmin = existing.filter((r) => ADMIN_FAMILY.includes(r))
  const roles = Array.from(new Set([...dbRoles, ...preservedAdmin]))

  await clerk.users.updateUserMetadata(user.clerkId, {
    publicMetadata: { ...clerkUser.publicMetadata, roles },
  })

  return { clerkId: user.clerkId, roles }
}
