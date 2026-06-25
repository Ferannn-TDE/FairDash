import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { auth } from '@clerk/nextjs/server'

// Auth guard: verify the authenticated user is an organizer who owns this specific fair.
// Redirects to /organizer/unauthorized rather than throwing so the user gets a clear message.
export default async function FairLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ fairSlug: string }>
}) {
  const { fairSlug } = await params
  const { userId: clerkId } = await auth()

  if (!clerkId) redirect(`/organizer/login?redirect=${encodeURIComponent(`/organizer/fairs/${fairSlug}`)}`)

  const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
  if (!dbUser) redirect('/organizer/unauthorized')

  const orgMember = await db.orgMember.findFirst({
    where: { userId: dbUser.id },
    select: { organizerId: true },
  })
  if (!orgMember) redirect('/organizer/unauthorized')

  const event = await db.event.findFirst({
    where: { urlSlug: fairSlug, organizerId: orgMember.organizerId },
    select: { id: true },
  })
  if (!event) redirect('/organizer/unauthorized')

  return <>{children}</>
}
