import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { requireVendorAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import VendorPortalShell from './_components/VendorPortalShell'

interface Props {
  params: { fairSlug: string }
  children: React.ReactNode
}

export default async function VendorLayout({ params, children }: Props) {
  let clerkId: string

  try {
    clerkId = await requireVendorAuth()
  } catch {
    redirect('/')
  }

  // Fetch vendor name and user info in parallel
  const [clerkUser, dbUser] = await Promise.all([
    currentUser(),
    db.user.findUnique({ where: { clerkId } }),
  ])

  let vendorName = 'My Vendor Booth'
  if (dbUser) {
    const membership = await db.vendorMember.findFirst({
      where: { userId: dbUser.id },
      include: { vendor: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    if (membership?.vendor?.name) vendorName = membership.vendor.name
  }

  const userName =
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ') ||
    clerkUser?.emailAddresses[0]?.emailAddress?.split('@')[0] ||
    'Vendor'
  const userEmail = clerkUser?.emailAddresses[0]?.emailAddress ?? ''

  return (
    <VendorPortalShell
      fairSlug={params.fairSlug}
      vendorName={vendorName}
      userName={userName}
      userEmail={userEmail}
    >
      {children}
    </VendorPortalShell>
  )
}
