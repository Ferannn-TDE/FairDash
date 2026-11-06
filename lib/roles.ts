// One canonical reader for role metadata. Everything (middleware, portal guards,
// /api/auth/access) reads roles[] through this — ONE shape, no singular-vs-array
// drift. Admin family lives in roles[] too (migrated off the legacy singular
// publicMetadata.role by scripts/migrate-admin-to-roles.ts).
export const ADMIN_ROLES = ['admin', 'super_admin', 'event_operator'] as const

// The STRICT admin set — platform admins only, deliberately EXCLUDING
// event_operator. Cross-fair authority (resolving/operating a fair the caller
// does not own) gates on this set, NOT the full ADMIN_ROLES family: an
// event_operator is scoped to their assignment, so admitting them to a
// cross-fair chokepoint would be a privilege escalation. `hasRole(meta,'admin')`
// matches the whole family and cannot express this narrower gate — hence a
// dedicated predicate.
export const STRICT_ADMIN_ROLES = ['admin', 'super_admin'] as const

export function rolesFromMetadata(meta: unknown): string[] {
  const m = meta as { roles?: unknown } | null | undefined
  return Array.isArray(m?.roles) ? (m!.roles as string[]) : []
}

/** Does this metadata grant `role`? `admin` matches any admin-family role. */
export function hasRole(meta: unknown, role: string): boolean {
  const roles = rolesFromMetadata(meta)
  if (role === 'admin') return roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r))
  return roles.includes(role)
}

/** STRICT platform-admin gate: admin | super_admin only (NOT event_operator).
 *  Used exclusively by the cross-fair chokepoint (requireAdminFairContext). */
export function hasStrictAdminRole(meta: unknown): boolean {
  const roles = rolesFromMetadata(meta)
  return roles.some((r) => (STRICT_ADMIN_ROLES as readonly string[]).includes(r))
}

// ── Platform settings (Batch 1 item 5) ───────────────────────────────────────────────────────
//
// platform_manager is the client's settings-only admin. It is DELIBERATELY NOT in ADMIN_ROLES:
// every requireAdminAuth route (including the money ones: refund, hold, freeze, retry payout)
// reads ADMIN_ROLES, so adding it there would hand it all of them. It is granted only what
// names it explicitly: today, /admin/settings and /api/admin/settings. Approvals come with
// item 9.
export const PLATFORM_MANAGER_ROLE = 'platform_manager' as const

/** Who may read and edit platform settings: the strict admins plus platform_manager.
 *  event_operator is scoped to one fair and these settings apply to every fair, so it is out. */
export const SETTINGS_ROLES = [...STRICT_ADMIN_ROLES, PLATFORM_MANAGER_ROLE] as const
export type SettingsRole = (typeof SETTINGS_ROLES)[number]

export function hasSettingsRole(meta: unknown): boolean {
  const roles = rolesFromMetadata(meta)
  return roles.some((r) => (SETTINGS_ROLES as readonly string[]).includes(r))
}

/** The role a settings change is recorded under: the strongest one the caller holds. */
export function settingsActorRole(meta: unknown): SettingsRole | null {
  const roles = rolesFromMetadata(meta)
  for (const r of ['super_admin', 'admin', PLATFORM_MANAGER_ROLE] as const) {
    if (roles.includes(r)) return r
  }
  return null
}

/** Only platform_manager, with no admin-family role on top. Such a user lands on
 *  /admin/settings and is sent away from every other admin page. */
export function isPlatformManagerOnly(meta: unknown): boolean {
  const roles = rolesFromMetadata(meta)
  return roles.includes(PLATFORM_MANAGER_ROLE) && !roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r))
}

// ── Script-granted roles (grant-admin.ts / revoke-admin.ts) ──────────────────────────────────
// Roles with no DB membership behind them: granted by script or the Clerk dashboard and kept by
// role sync (lib/role-sync.ts unions, never removes). Pure helpers so the scripts' behaviour is
// testable without Clerk.
export const GRANTABLE_ROLES = [...ADMIN_ROLES, PLATFORM_MANAGER_ROLE] as const

export function isGrantableRole(role: string): boolean {
  return (GRANTABLE_ROLES as readonly string[]).includes(role)
}

/** roles[] with `role` added once; every other role kept, order preserved. */
export function withRoleAdded(roles: readonly string[], role: string): string[] {
  return roles.includes(role) ? [...roles] : [...roles, role]
}

/** roles[] with exactly `role` removed; every other role kept, order preserved. */
export function withRoleRemoved(roles: readonly string[], role: string): string[] {
  return roles.filter((r) => r !== role)
}
