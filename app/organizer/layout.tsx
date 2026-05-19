import type { Metadata } from 'next'
import OrganizerShell from './_components/OrganizerShell'

export const metadata: Metadata = {
  title: 'Organizer Portal — FairSynq',
}

export default async function OrganizerLayout({ children }: { children: React.ReactNode }) {
  // Auth check using Clerk server-side — graceful fallback for dev without Clerk configured
  let userName = 'Organizer'
  let userInitials = 'O'
  let userEmail = ''

  try {
    const { currentUser } = await import('@clerk/nextjs/server')
    const user = await currentUser()
    if (user) {
      const first = user.firstName ?? ''
      const last  = user.lastName  ?? ''
      userName     = ([first, last].filter(Boolean).join(' ') || user.emailAddresses[0]?.emailAddress) ?? userName
      userInitials = (((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || userName[0]?.toUpperCase()) ?? 'O'
      userEmail    = user.emailAddresses[0]?.emailAddress ?? userEmail

      // Uncomment in production to enforce organizer role:
      // if (user.publicMetadata?.role !== 'organizer') {
      //   const { redirect } = await import('next/navigation')
      //   redirect('/organizer/unauthorized')
      // }
    }
  } catch {
    // Clerk not configured — use mock profile
  }

  return (
    <OrganizerShell userName={userName} userInitials={userInitials} userEmail={userEmail}>
      {children}
    </OrganizerShell>
  )
}
