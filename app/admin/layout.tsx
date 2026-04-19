import type { Metadata } from 'next'
import AdminShell from './_components/AdminShell'
import { mockAdminProfile } from '@/lib/mock/admin'

export const metadata: Metadata = {
  title: 'Admin Portal — FairSynq',
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let userName = mockAdminProfile.name
  let userInitials = mockAdminProfile.initials
  let userEmail = mockAdminProfile.email

  try {
    const { currentUser } = await import('@clerk/nextjs/server')
    const user = await currentUser()
    if (user) {
      const first = user.firstName ?? ''
      const last = user.lastName ?? ''
      userName = ([first, last].filter(Boolean).join(' ') || user.emailAddresses[0]?.emailAddress) ?? userName
      userInitials = (((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || userName[0]?.toUpperCase()) ?? 'A'
      userEmail = user.emailAddresses[0]?.emailAddress ?? userEmail

      // Uncomment in production to enforce admin/super_admin role:
      // const role = user.publicMetadata?.role as string | undefined
      // if (role !== 'admin' && role !== 'super_admin' && role !== 'event_operator') {
      //   const { redirect } = await import('next/navigation')
      //   redirect('/')
      // }
    }
  } catch {
    // Clerk not configured — use mock profile
  }

  return (
    <AdminShell userName={userName} userInitials={userInitials} userEmail={userEmail}>
      {children}
    </AdminShell>
  )
}
