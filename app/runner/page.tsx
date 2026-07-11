import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'

// Route a runner to THEIR assigned event — never a hardcoded fair. (The old
// hardcoded slug sent every runner to one fair regardless of assignment; it
// broke the moment a second event existed.)
export default async function RunnerRootPage() {
  const { userId: clerkId } = await auth()
  if (!clerkId) redirect('/sign-in/runner')

  const user = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
  const runner = user
    ? await db.runner.findUnique({
        where: { userId: user.id },
        select: { event: { select: { urlSlug: true } } },
      })
    : null

  // Become-a-runner door: a signed-in user with NO Runner row is sent to the driver
  // application (consent trail) rather than dead-ended at sign-in. No fair context
  // exists at the /runner root, so no ?fair= param — an application-only submit still
  // works, and the fair-scoped mint happens when they enter via /runner/<slug>.
  if (!runner) redirect('/become-driver')
  if (!runner.event?.urlSlug) redirect('/sign-in/runner')
  redirect(`/runner/${runner.event.urlSlug}/dashboard`)
}
