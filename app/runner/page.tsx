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

  if (!runner?.event?.urlSlug) redirect('/sign-in/runner')
  redirect(`/runner/${runner.event.urlSlug}/dashboard`)
}
