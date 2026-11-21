import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { ChevronLeft } from 'lucide-react'
import { hasSettingsRole, hasStrictAdminRole, isPlatformManagerOnly } from '@/lib/roles'
import PlatformSettingsPanel from '../_components/PlatformSettingsPanel'
import MenuAlertPreferences from '../../_components/MenuAlertPreferences'
import PlatformManagerHeader from '../_components/PlatformManagerHeader'

export const metadata = { title: 'Platform settings — FairSynq Admin' }

/**
 * /admin/settings — PLATFORM settings (every fair), not a fair's own Settings page
 * (/admin/[eventSlug]/settings). Batch 1 item 5.
 *
 * Gate: admin | super_admin | platform_manager (lib/roles SETTINGS_ROLES). event_operator is
 * sent back to /admin (its fair picker). Anyone else goes to /admin, which sends them home.
 * The route (/api/admin/settings) is the real boundary; this is defence in depth.
 *
 * A platform_manager with no admin role sees a minimal header (title + Sign out): no fair
 * picker, no fair links. Admins get "← All fairs".
 */
export default async function PlatformSettingsPage() {
  let user: Awaited<ReturnType<typeof currentUser>> = null
  try {
    user = await currentUser()
  } catch {
    redirect('/admin/login')
  }
  if (!user) redirect('/admin/login')
  if (!hasSettingsRole(user.publicMetadata)) redirect('/admin')

  const managerOnly = isPlatformManagerOnly(user.publicMetadata)
  // Menu alerts reach strict admins only (fairs with no organizer; audit H5, step 3). A platform
  // manager can open this page but gets no menu alerts, so the card isn't shown to them.
  const strictAdmin = hasStrictAdminRole(user.publicMetadata)

  return (
    <div className="min-h-screen bg-[#0F0F0F] px-4 sm:px-5 md:px-[6%] lg:px-8 py-8 sm:py-10">
      <div className="max-w-[56rem] mx-auto">
        {managerOnly ? (
          <PlatformManagerHeader current="settings" />
        ) : (
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 text-xs font-inter text-[#666] hover:text-white transition-colors mb-4"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> All fairs
          </Link>
        )}
        <PlatformSettingsPanel />
        {strictAdmin && (
          <section className="mt-8 bg-[#1a1a1a] border border-white/[0.07] rounded-2xl p-6">
            <h2 className="text-white font-semibold text-base mb-1">My notifications</h2>
            <p className="text-white/40 text-xs mb-4 font-inter">
              Menu alerts for fairs with no organizer. Your own choice; other admins choose theirs.
            </p>
            <MenuAlertPreferences />
          </section>
        )}
      </div>
    </div>
  )
}
