import type { Metadata } from 'next'
import MarketplaceNavbar from '@/app/_components/MarketplaceNavbar'
import { getVideoSlot } from '@/lib/videos'
import VendorOnboarding from './VendorOnboarding'

export const metadata: Metadata = {
  title: 'Become a Vendor — FairSynq',
  description: 'Apply to join FairSynq as a food vendor. Complete your profile, upload documents, set up your menu, and connect Stripe to start receiving orders.',
  alternates: { canonical: '/become-vendor' },
}

// Reads the vendor pitch video setting (item 12) for the top of the wizard.
export default async function BecomeVendorPage() {
  const video = await getVideoSlot('vendorPitch')
  return (
    <>
      <MarketplaceNavbar />
      <VendorOnboarding video={video} />
    </>
  )
}
