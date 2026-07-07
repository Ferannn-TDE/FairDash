import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { hasRole } from '@/lib/roles'
import FairPicker from './_components/FairPicker'

export const metadata = { title: 'Admin — FairSynq' }

export default async function AdminIndexPage() {
  // SECURITY GATE: /admin index sits OUTSIDE the [eventSlug] layout, so with the
  // middleware role-gate removed this server check is the sole authority here.
  // Admin family = Clerk metadata roles[] (no DB membership row — the documented
  // single-source-of-truth exception). Mirrors app/admin/[eventSlug]/layout.tsx.
  // (redirect() throws NEXT_REDIRECT, so it stays OUTSIDE the try.)
  let user: Awaited<ReturnType<typeof currentUser>> = null
  try {
    user = await currentUser()
  } catch {
    redirect('/admin/login')
  }
  if (!user) redirect('/admin/login')
  if (!hasRole(user.publicMetadata, 'admin')) redirect('/')

  // The fair picker. An admin oversees fairs it does NOT own, so the list can't
  // come from ownership — the picker fetches the strict-gated /api/admin/fairs
  // (all fairs, all organizers) and links each to its dashboard.
  return <FairPicker />
}
