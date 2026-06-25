// One canonical reader for role metadata. Everything (middleware, portal guards,
// /api/auth/access) reads roles[] through this — ONE shape, no singular-vs-array
// drift. Admin family lives in roles[] too (migrated off the legacy singular
// publicMetadata.role by scripts/migrate-admin-to-roles.ts).
export const ADMIN_ROLES = ['admin', 'super_admin', 'event_operator'] as const

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
