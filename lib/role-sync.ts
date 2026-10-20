import { createClerkClient } from '@clerk/backend'
import { db } from './db'
import { logger } from './logger'
import { PAYEE_ROLES, type PayeeRole } from './role-consistency'
import { assertNotProductionClerk } from './prod-clerk-guard'

// Use @clerk/backend directly (not @clerk/nextjs/server's clerkClient) so this
// helper works identically in API routes AND in standalone scripts — the
// nextjs wrapper can't resolve CLERK_SECRET_KEY outside Next's runtime.
type ClerkLike = Pick<ReturnType<typeof createClerkClient>, 'users'>
let _clerk: ClerkLike | null = null
let _testClerk: ClerkLike | null = null
/** Test seam: route every Clerk call here to a fake (null restores the real client). */
export function __setClerkForTest(fake: ClerkLike | null) { _testClerk = fake }
function getClerk(): ClerkLike {
  if (_testClerk) return _testClerk
  if (!_clerk) {
    assertNotProductionClerk('lib/role-sync')
    _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  }
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
// metadata. (The admin gate reads roles[] via lib/roles.ts hasRole(); the legacy
// singular publicMetadata.role was migrated by scripts/migrate-admin-to-roles.ts.)
// They used to need an explicit carve-out here; under the union below they are
// preserved for the same reason every other existing role is, so the special case
// is gone rather than merely satisfied.

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

  // UNION, not replace. This used to be `[...dbRoles, ...existing.filter(isAdminFamily)]`,
  // which DISCARDED every non-admin role that had no DB row behind it — and that was reachable,
  // because roles[] was also written optimistically at signup before any membership existed.
  // Proven live on 2026-08-01: oodedai@siue.edu signed up as a vendor (roles ['vendor'], no
  // VendorMember yet), then acquired organizer; the bootstrap's sync recomputed ['organizer']
  // and silently dropped 'vendor'. Acquiring one role revoked another.
  //
  // The companion half of the fix removes the optimistic write (app/onboarding/page.tsx), so
  // every entry here is now DB-backed by construction. Union is what makes that safe in BOTH
  // directions: metadata can never contradict the rows, and a role can never vanish because a
  // sync happened to run at a moment when its row hadn't been created yet.
  //
  // ⚠️ CONSEQUENCE — THIS FUNCTION CAN NO LONGER REMOVE A ROLE. That is safe only while nothing
  // deletes a VendorMember / OrgMember / Runner row, which is a grep result, not an invariant.
  // scripts/membership-delete-guard.ts is what turns it into one. If revocation is ever wanted,
  // it must become an EXPLICIT call — never a side effect of a membership write.
  const roles = Array.from(new Set([...existing, ...dbRoles]))

  // Nothing to add → no Clerk write. This runs on every sign-in and every sweep, so a write
  // here would be a Clerk round-trip (and a user.updated webhook) for no change.
  if (roles.length === existing.length) return { clerkId: user.clerkId, roles }

  await clerk.users.updateUserMetadata(user.clerkId, {
    publicMetadata: { ...clerkUser.publicMetadata, roles },
  })

  return { clerkId: user.clerkId, roles }
}

// ─── Reconcile (readiness 1.9) ────────────────────────────────────────────────
//
// The sync above runs where a row is created, best-effort — and "self-heals on the next sync"
// was false, because nothing ran a next sync. Production had runner rows with no runner role
// for months. This is the next sync: every Clerk user is compared with their rows and any
// MISSING payee role is added (union — never removes; stale claims and admin roles stay).
// Run by the worker on a timer and by the Clerk webhook on each sign-in.

export interface RoleReconcileSummary {
  clerkUsers: number
  usersToUpdate: number
  missing: Record<PayeeRole, number>
  updated: number
  errors: number
  dryRun: boolean
}

export async function reconcileAllRoles(opts: { dryRun: boolean }): Promise<RoleReconcileSummary> {
  const clerk = getClerk()
  const clerkUsers: Array<{ id: string; publicMetadata: Record<string, unknown> }> = []
  for (let offset = 0; ; offset += 100) {
    const page = await clerk.users.getUserList({ limit: 100, offset })
    clerkUsers.push(...(page.data as Array<{ id: string; publicMetadata: Record<string, unknown> }>))
    if (page.data.length < 100) break
  }
  const rows = await db.user.findMany({
    where: { clerkId: { in: clerkUsers.map(u => u.id) } },
    select: {
      clerkId: true,
      orgMembers: { select: { id: true }, take: 1 },
      vendorMembers: { select: { id: true }, take: 1 },
      runner: { select: { id: true } },
    },
  })
  const byClerk = new Map(rows.map(r => [r.clerkId, r]))

  const summary: RoleReconcileSummary = {
    clerkUsers: clerkUsers.length, usersToUpdate: 0, missing: { organizer: 0, vendor: 0, runner: 0 },
    updated: 0, errors: 0, dryRun: opts.dryRun,
  }
  for (const cu of clerkUsers) {
    const row = byClerk.get(cu.id)
    if (!row) continue
    const have = new Set(Array.isArray(cu.publicMetadata?.roles) ? (cu.publicMetadata.roles as string[]) : [])
    const backed: Record<PayeeRole, boolean> = {
      organizer: row.orgMembers.length > 0, vendor: row.vendorMembers.length > 0, runner: !!row.runner,
    }
    const add = PAYEE_ROLES.filter(r => backed[r] && !have.has(r))
    if (!add.length) continue
    summary.usersToUpdate++
    for (const r of add) summary.missing[r]++
    if (opts.dryRun) continue
    try {
      await clerk.users.updateUserMetadata(cu.id, {
        publicMetadata: { ...cu.publicMetadata, roles: [...have, ...add] },
      })
      summary.updated++
    } catch (err) {
      summary.errors++
      logger.error('[role-reconcile] roles[] update failed; the next run retries', {
        clerkId: cu.id, add, err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (summary.usersToUpdate > 0) {
    logger.warn(`[role-reconcile] ${opts.dryRun ? 'would add' : 'added'} missing payee roles`, { ...summary })
  }
  return summary
}
