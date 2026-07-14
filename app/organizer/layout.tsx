import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import OrganizerShell from './_components/OrganizerShell'
import OrganizerGateScreen from './_components/OrganizerGateScreen'
import { organizerPortalState } from '@/lib/organizer-portal-state'
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
  // The #7 gate, ORGANIZER-SIDE. Resolved server-side here (not in a client fetch) so a gated
  // organizer NEVER sees the dashboard fire its queries and paint a wall of 403s — they get the
  // gate screen directly, with no flash. Derived from the SAME helpers as requireOrganizerAuth,
  // so this screen and the server 403s can't disagree.
  let gate: ReturnType<typeof organizerPortalState> | null = null

  if (!exempt) {
    const { userId: clerkId } = await auth()
    if (!clerkId) redirect(`/organizer/login?redirect=${encodeURIComponent(pathname || '/organizer')}`)

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) redirect('/organizer/unauthorized')

    const orgMember = await db.orgMember.findFirst({
      where: { userId: dbUser.id },
      select: {
        id: true,
        organizer: {
          select: {
            approvalStatus: true, rejectionReason: true,
            suspendedAt: true, suspendedReason: true,
          },
        },
      },
    })
    if (!orgMember) redirect('/organizer/unauthorized')

    gate = organizerPortalState(orgMember.organizer)
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

  // GATED (pending / rejected / suspended): show the state screen, NOT the portal. Standalone,
  // like the auth pages — a gated organizer isn't in the console, so no sidebar. This is the
  // short-circuit that turns "a dashboard full of failed queries" into an honest screen.
  if (gate && gate.state !== 'ACTIVE') {
    return (
      <QueryProvider>
        <OrganizerGateScreen view={gate} />
      </QueryProvider>
    )
  }

  return (
    <QueryProvider>
      <OrganizerShell userName={userName} userInitials={userInitials} userEmail={userEmail}>
        {children}
      </OrganizerShell>
    </QueryProvider>
  )
}
