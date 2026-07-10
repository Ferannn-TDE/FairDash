import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import OrganizerShell from './_components/OrganizerShell'
import QueryProvider from '../_providers/QueryProvider'

export const metadata: Metadata = {
  title: 'Organizer Portal — FairSynq',
}

// AUTHORITY guard for the Organizer Portal (DB OrgMember row). The middleware
// (proxy.ts) is the fast filter in front; this is the source of truth and the
// backstop for the stale-token case. The portal's own login + unauthorized pages
// live under /organizer, so we exempt them (via the middleware-set x-pathname) to
// avoid gating a page into a loop — same rule as the middleware's isAuthPage.
const EXEMPT = new Set(['/organizer/login', '/organizer/unauthorized'])

export default async function OrganizerLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-pathname') ?? ''
  const exempt = EXEMPT.has(pathname)

  let userName = 'Organizer'
  let userInitials = 'O'
  let userEmail = ''

  if (!exempt) {
    const { userId: clerkId } = await auth()
    if (!clerkId) redirect(`/organizer/login?redirect=${encodeURIComponent(pathname || '/organizer')}`)

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) redirect('/organizer/unauthorized')

    const orgMember = await db.orgMember.findFirst({ where: { userId: dbUser.id }, select: { id: true } })
    if (!orgMember) redirect('/organizer/unauthorized')
  }

  // Profile for the shell chrome (best-effort; Clerk may be absent locally).
  try {
    const user = await currentUser()
    if (user) {
      const first = user.firstName ?? ''
      const last = user.lastName ?? ''
      userName = ([first, last].filter(Boolean).join(' ') || user.emailAddresses[0]?.emailAddress) ?? userName
      userInitials = (((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || userName[0]?.toUpperCase()) ?? 'O'
      userEmail = user.emailAddresses[0]?.emailAddress ?? userEmail
    }
  } catch {
    // Clerk not configured — use mock profile
  }

  // Auth pages (login / unauthorized) render STANDALONE — no portal chrome. You're
  // not in the console yet, so the sidebar (Dashboard/My Fairs/Settings) must not show.
  if (exempt) {
    return <QueryProvider>{children}</QueryProvider>
  }

  return (
    <QueryProvider>
      <OrganizerShell userName={userName} userInitials={userInitials} userEmail={userEmail}>
        {children}
      </OrganizerShell>
    </QueryProvider>
  )
}
