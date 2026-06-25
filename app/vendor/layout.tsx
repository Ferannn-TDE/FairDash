import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'

// AUTHORITY guard for the Vendor Portal (DB VendorMember row). Middleware is the
// fast filter; this is the source of truth + stale-token backstop. The vendor
// login lives at /sign-in/vendor (outside this prefix), so only the in-prefix
// /vendor/unauthorized page needs exempting to avoid a self-loop.
export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-pathname') ?? ''

  if (pathname !== '/vendor/unauthorized') {
    const { userId: clerkId } = await auth()
    if (!clerkId) redirect(`/sign-in/vendor?redirect=${encodeURIComponent(pathname || '/vendor')}`)

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) redirect('/vendor/unauthorized')

    const member = await db.vendorMember.findFirst({ where: { userId: dbUser.id }, select: { id: true } })
    if (!member) redirect('/vendor/unauthorized')
  }

  return <>{children}</>
}
