import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { robotsFor } from '@/lib/seo'
import { getSignedInContact } from '@/lib/signed-in-contact'
import { organizerOnboardingDestination, ORGANIZER_APPLY_PATH } from '@/lib/organizer-onboarding'
import MarketplaceNavbar from '@/app/_components/MarketplaceNavbar'
import OrganizerApplyForm from './OrganizerApplyForm'

export const metadata: Metadata = {
  title: 'Apply to host events — FairSynq',
  robots: robotsFor('private'),
}

// Personal (it starts filled in with the sign-in details): rendered per visitor, never cached.
export const dynamic = 'force-dynamic'

// /onboarding/organizer — the organizer sign-up form (sign-up-fixes commit 4).
//
// THIS PAGE CREATES NOTHING. It only reads: who is signed in, whether they already belong to an
// organizer (then they go to the portal), and the details to start the form with. The organizer,
// their draft event and their Terms acceptance are created only when the form is submitted
// (POST /api/organizer/apply). Tested: scripts/organizer-apply-test.ts.
export default async function OrganizerApplyPage() {
  const user = await currentUser()
  if (!user) redirect(`/organizer/login?redirect=${encodeURIComponent(ORGANIZER_APPLY_PATH)}`)

  const dbUser = await db.user.findUnique({ where: { clerkId: user.id }, select: { id: true, phone: true } })
  if (dbUser && (await organizerOnboardingDestination(dbUser.id)) === 'portal') redirect('/organizer')

  // Never ask twice: name, email and phone from the sign-in account; the phone falls back to the
  // one saved on the account when Clerk has none.
  const contact = await getSignedInContact()
  const prefill = { ...contact, phone: contact.phone || dbUser?.phone || '' }

  return (
    <>
      <MarketplaceNavbar />
      <OrganizerApplyForm prefill={prefill} />
    </>
  )
}
