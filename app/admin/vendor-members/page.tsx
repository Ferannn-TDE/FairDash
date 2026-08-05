import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { ChevronLeft } from 'lucide-react'
import { hasStrictAdminRole } from '@/lib/roles'
import VendorOperatorsPanel from '../_components/VendorOperatorsPanel'

export const metadata = { title: 'Vendor operators — FairSynq Admin' }

/**
 * /admin/vendor-members — PLATFORM-LEVEL, deliberately OUTSIDE app/admin/[eventSlug]/.
 *
 * A VendorMember has no eventId — it reaches a fair only through vendor.event — and one person
 * may work booths at several fairs, so "may this human operate at all" is not a fair-scoped
 * question and this panel must not sit under the fair-scoped layout. Same call the routes make
 * (requireStrictAdminAuth, not the fair chokepoint), and the same one /admin/organizers made
 * before it. The per-fair vendor screen at /admin/[eventSlug]/vendors stays what it is: a view of
 * BOOTHS, which is the other axis.
 *
 * STRICT GATE. /admin (the picker) checks hasRole(…, 'admin'); this checks hasStrictAdminRole —
 * admin | super_admin, NOT event_operator — matching the routes it drives. Letting an
 * event_operator load a panel whose every button 403s would be a UI that lies about what you can
 * do. (redirect() throws NEXT_REDIRECT, so it stays OUTSIDE the try.)
 *
 * The server gate is defence-in-depth, not the authority: the routes are the real boundary and
 * are proven unreachable by non-strict-admins. Hiding a button has never been the security here.
 */
export default async function AdminVendorOperatorsPage() {
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
        <VendorOperatorsPanel />
      </div>
    </div>
  )
}
