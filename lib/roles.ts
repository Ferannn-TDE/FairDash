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
