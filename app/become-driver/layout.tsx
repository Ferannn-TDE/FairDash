import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { resolveOnboardingRedirect } from '@/lib/runner-onboarding-guard'

// Onboarding ENTRY guard (Hole 1). An already-onboarded runner reaching /become-driver
// by URL, a stale link, or the browser back button is bounced to their portal BEFORE the
// form renders — re-entry is blocked at the door, not merely redirected after completion.
// Anonymous applicants and authenticated users with no Runner row fall through to the form
// (the generic apply path is preserved). The idempotent create-if-absent in POST
// /api/drivers is the defence-in-depth backstop (Hole 2) if this guard is ever bypassed.
export default async function BecomeDriverLayout({ children }: { children: React.ReactNode }) {
  const { userId: clerkId } = await auth()
  const dest = await resolveOnboardingRedirect(clerkId)
  if (dest) redirect(dest)
  return <>{children}</>
}
