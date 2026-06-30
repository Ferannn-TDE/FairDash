import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import RunnerPortalShell from './RunnerPortalShell'

// AUTHORITY guard for the Runner Portal (DB Runner row). Previously this layout was
// client-only and the route relied on the middleware JWT pre-filter for access —
// with that pre-filter removed (single-source-of-truth cleanup), this server check
// is now the sole authority, matching vendor/organizer. Unauthenticated or non-runner
// → /sign-in/runner (runner has no dedicated unauthorized page; the sign-in card's
// access-check renders the terminal state). The shell is split into a client child.
export default async function RunnerLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ fairSlug: string }>
}) {
  const { fairSlug } = await params

  const { userId: clerkId } = await auth()
  if (!clerkId) redirect('/sign-in/runner')

  const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
  if (!dbUser) redirect('/sign-in/runner')

  const runner = await db.runner.findUnique({ where: { userId: dbUser.id }, select: { id: true } })
  if (!runner) redirect('/sign-in/runner')

  return <RunnerPortalShell fairSlug={fairSlug}>{children}</RunnerPortalShell>
}
