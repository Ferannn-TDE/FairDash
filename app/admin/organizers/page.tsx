import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { ChevronLeft } from 'lucide-react'
import { hasStrictAdminRole } from '@/lib/roles'
import OrganizersPanel from '../_components/OrganizersPanel'

export const metadata = { title: 'Organizers — FairSynq Admin' }

/**
 * /admin/organizers — PLATFORM-LEVEL, deliberately OUTSIDE app/admin/[eventSlug]/.
 *
 * An organizer owns MANY fairs, so "is this person allowed to be an organizer at all?" is not
 * a fair-scoped question and this panel must not live under the fair-scoped layout. Same
 * scoping call slice 2 made for the routes (requireStrictAdminAuth, not the fair chokepoint) —
 * a fair-scoped home would have been subtly wrong in exactly the same way.
 *
 * STRICT GATE. /admin (the picker) checks hasRole(…, 'admin'); this checks hasStrictAdminRole
 * — admin | super_admin, NOT event_operator — matching the three routes it drives. An
 * event_operator loading a panel whose every button 403s would be a UI that lies about what
 * you can do; better to not let them in. (redirect() throws NEXT_REDIRECT, so it stays OUTSIDE
 * the try.)
 *
 * The server gate is defence-in-depth, not the authority: the routes are the real boundary and
 * are proven organizer-unreachable. Hiding a button has never been the security here.
 */
export default async function AdminOrganizersPage() {
  let user: Awaited<ReturnType<typeof currentUser>> = null
  try {
    user = await currentUser()
  } catch {
    redirect('/admin/login')
  }
  if (!user) redirect('/admin/login')
  if (!hasStrictAdminRole(user.publicMetadata)) redirect('/')

  return (
    <div className="min-h-screen bg-[#0F0F0F] px-[6%] lg:px-8 md:px-5 sm:px-4 py-10">
      <div className="max-w-[70rem] mx-auto">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-xs font-inter text-[#666] hover:text-white transition-colors mb-4"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> All events
        </Link>
        <OrganizersPanel />
      </div>
    </div>
  )
}
