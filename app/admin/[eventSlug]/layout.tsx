import { redirect } from 'next/navigation'
import AdminShell from '../_components/AdminShell'
import { mockAdminProfile } from '@/lib/mock/admin'
import { hasRole } from '@/lib/roles'

// SECURITY GATE: the admin portal requires a signed-in user with an admin role.
// Previously the role check was COMMENTED OUT in the old top-level layout, so
// /admin/* rendered for anyone who knew the URL. This enforces it. Unauthenticated
// → /admin/login; wrong role → home. (/admin/login is outside this layout, so no loop.)
export default async function AdminPortalLayout({ children }: { children: React.ReactNode }) {
  let user: Awaited<ReturnType<typeof import('@clerk/nextjs/server').currentUser>> = null
  try {
    const { currentUser } = await import('@clerk/nextjs/server')
    user = await currentUser()
  } catch {
    // Clerk unavailable (e.g. no keys locally) — treat as unauthenticated, send to login.
    redirect('/admin/login')
  }

  if (!user) redirect('/admin/login')
  // Unified shape: admin family lives in publicMetadata.roles[] (migrated off the
  // legacy singular role by scripts/migrate-admin-to-roles.ts).
  if (!hasRole(user.publicMetadata, 'admin')) redirect('/')

  const first = user.firstName ?? ''
  const last = user.lastName ?? ''
  const userName = ([first, last].filter(Boolean).join(' ') || user.emailAddresses[0]?.emailAddress) ?? mockAdminProfile.name
  const userInitials = (((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || userName[0]?.toUpperCase()) ?? 'A'
  const userEmail = user.emailAddresses[0]?.emailAddress ?? mockAdminProfile.email

  return (
    <AdminShell userName={userName} userInitials={userInitials} userEmail={userEmail}>
      {children}
    </AdminShell>
  )
}
