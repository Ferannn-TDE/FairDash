// Role consistency (readiness 1.9) — PURE. Compares each user's payee rows (OrgMember →
// organizer, VendorMember → vendor, Runner → runner) with their Clerk roles[], and counts each
// kind of disagreement. Admin-family roles live only in Clerk and are not compared.
//
// One kind is EXPECTED, not a defect: a purge tombstone — a user whose login was deleted but
// whose row must stay because orders reference it. scripts/free-tribbet-emails.ts writes them
// as clerkId `purged_<id>` + email `purged+<id>@fairsynq.invalid`; both must match.
//
// `ok` is true only when nothing but tombstones disagrees, so scripts/role-consistency-check.ts
// can gate the cutover seed (PRODUCTION_READINESS 9.3).

export const PAYEE_ROLES = ['organizer', 'vendor', 'runner'] as const
export type PayeeRole = (typeof PAYEE_ROLES)[number]

export interface DbUserRoles { clerkId: string; email: string; organizer: boolean; vendor: boolean; runner: boolean }
export interface ClerkUserRoles { id: string; roles: string[] }

export interface RoleConsistencyResult {
  ok: boolean
  counts: {
    dbUsers: number
    clerkUsers: number
    compared: number
    mismatchedUsers: number
    rowWithoutRole: Record<PayeeRole, number>
    roleWithoutRow: Record<PayeeRole, number>
    dbOnly: number
    clerkOnly: number
    tombstones: number
  }
}

export function isPurgeTombstone(u: { clerkId: string; email: string }): boolean {
  return u.clerkId.startsWith('purged_') && /^purged\+.+@fairsynq\.invalid$/.test(u.email)
}

export function classifyRoleConsistency(dbUsers: DbUserRoles[], clerkUsers: ClerkUserRoles[]): RoleConsistencyResult {
  const clerk = new Map(clerkUsers.map(c => [c.id, new Set(c.roles)]))
  const dbIds = new Set(dbUsers.map(u => u.clerkId))
  const rowWithoutRole = { organizer: 0, vendor: 0, runner: 0 }
  const roleWithoutRow = { organizer: 0, vendor: 0, runner: 0 }
  let compared = 0, mismatchedUsers = 0, dbOnly = 0, tombstones = 0

  for (const u of dbUsers) {
    const roles = clerk.get(u.clerkId)
    if (!roles) {
      if (isPurgeTombstone(u)) tombstones++
      else dbOnly++
      continue
    }
    compared++
    let bad = false
    for (const r of PAYEE_ROLES) {
      if (u[r] && !roles.has(r)) { rowWithoutRole[r]++; bad = true }
      if (!u[r] && roles.has(r)) { roleWithoutRow[r]++; bad = true }
    }
    if (bad) mismatchedUsers++
  }
  const clerkOnly = clerkUsers.filter(c => !dbIds.has(c.id)).length

  return {
    ok: mismatchedUsers === 0 && dbOnly === 0 && clerkOnly === 0,
    counts: { dbUsers: dbUsers.length, clerkUsers: clerkUsers.length, compared, mismatchedUsers, rowWithoutRole, roleWithoutRow, dbOnly, clerkOnly, tombstones },
  }
}
