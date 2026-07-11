import { db } from '@/lib/db'

// "Once a Runner row exists, onboarding is over — forever."
//
// Given a Clerk id, returns the portal path an already-onboarded user must be bounced
// to from the onboarding route (/become-driver), or null if they should see the form.
//
// EXISTENCE is the gate, NOT approval: a PENDING runner mid-wait, an APPROVED working
// runner, and a REJECTED one must ALL skip onboarding — otherwise a pending runner could
// re-onboard (duplicate/reset), or a rejected one could re-onboard to wipe their rejection.
// Returns null for anonymous users and authenticated users with no Runner row, so the
// public/generic application path is preserved. READ-ONLY — never creates or mutates a row.
export async function resolveOnboardingRedirect(clerkId: string | null): Promise<string | null> {
  if (!clerkId) return null
  const user = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
  if (!user) return null
  // Runner.userId is @unique — at most one row, any status blocks re-onboarding.
  const runner = await db.runner.findUnique({
    where: { userId: user.id },
    select: { event: { select: { urlSlug: true } } },
  })
  if (!runner) return null
  return runner.event?.urlSlug ? `/runner/${runner.event.urlSlug}/dashboard` : '/runner'
}
