import type { Metadata } from 'next'
import MarketplaceNavbar from '@/app/_components/MarketplaceNavbar'
import { getVideoSlot } from '@/lib/videos'
import { getSignedInContact } from '@/lib/signed-in-contact'
import VendorOnboarding from './VendorOnboarding'

export const metadata: Metadata = {
  title: 'Become a Vendor — FairSynq',
  description: 'Apply to join FairSynq as a food vendor. Complete your profile, upload documents, set up your menu, and connect Stripe to start receiving orders.',
  alternates: { canonical: '/become-vendor' },
}

// Step 1 starts filled in with the signed-in person's name, email and phone (never ask twice), so
// this page is personal: rendered for each visitor, never prerendered, cached or shared.
export const dynamic = 'force-dynamic'

// Reads the vendor pitch video setting (item 12) for the top of the wizard, and the sign-in
// details that start step 1 filled in.
export default async function BecomeVendorPage() {
  const video = await getVideoSlot('vendorPitch')
  const prefill = await getSignedInContact()
  return (
    <>
      <MarketplaceNavbar />
      <VendorOnboarding video={video} prefill={prefill} />
    </>
  )
}
