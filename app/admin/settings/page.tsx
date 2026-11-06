import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { ChevronLeft } from 'lucide-react'
import { hasSettingsRole, isPlatformManagerOnly } from '@/lib/roles'
import PlatformSettingsPanel from '../_components/PlatformSettingsPanel'
import AdminSignOutButton from '../_components/AdminSignOutButton'

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

  return (
    <div className="min-h-screen bg-[#0F0F0F] px-4 sm:px-5 md:px-[6%] lg:px-8 py-8 sm:py-10">
      <div className="max-w-[56rem] mx-auto">
        {managerOnly ? (
          <div className="flex items-center justify-between mb-6">
            <span className="font-bebas text-xl tracking-widest text-white">
              FAIR<span className="text-neon-pink">SYNQ</span>
            </span>
            <AdminSignOutButton />
          </div>
        ) : (
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 text-xs font-inter text-[#666] hover:text-white transition-colors mb-4"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> All fairs
          </Link>
        )}
        <PlatformSettingsPanel />
      </div>
    </div>
  )
}
