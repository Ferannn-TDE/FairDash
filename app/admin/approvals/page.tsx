import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { ChevronLeft } from 'lucide-react'
import { hasApprovalsRole, isPlatformManagerOnly } from '@/lib/roles'
import ApprovalsPanel from '../_components/ApprovalsPanel'
import PlatformManagerHeader from '../_components/PlatformManagerHeader'

export const metadata = { title: 'Approvals — FairSynq Admin' }

// /admin/approvals (Batch 1 item 9): pending vendor, organizer and partner applications, one
// decision each. Gate: admin | super_admin | platform_manager; anyone else goes to /admin. The
// routes (/api/admin/approvals/…) are the real boundary.
export default async function ApprovalsPage() {
  let user: Awaited<ReturnType<typeof currentUser>> = null
  try {
    user = await currentUser()
  } catch {
    redirect('/admin/login')
  }
  if (!user) redirect('/admin/login')
  if (!hasApprovalsRole(user.publicMetadata)) redirect('/admin')

  const managerOnly = isPlatformManagerOnly(user.publicMetadata)
  return (
    <div className="min-h-screen bg-[#0F0F0F] px-4 sm:px-5 md:px-[6%] lg:px-8 py-8 sm:py-10">
      <div className="max-w-[56rem] mx-auto">
        {managerOnly ? (
          <PlatformManagerHeader current="approvals" />
        ) : (
          <Link href="/admin" className="inline-flex items-center gap-1 text-xs font-inter text-[#666] hover:text-white transition-colors mb-4">
            <ChevronLeft className="w-3.5 h-3.5" /> All fairs
          </Link>
        )}
        <ApprovalsPanel />
      </div>
    </div>
  )
}
