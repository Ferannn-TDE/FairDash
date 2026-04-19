import type { Metadata } from 'next'
import MarketplaceNavbar from '@/app/_components/MarketplaceNavbar'
import VendorOnboarding from './VendorOnboarding'

export const metadata: Metadata = {
  title: 'Become a Vendor — FairSynq',
  description: 'Apply to join FairSynq as a food vendor. Complete your profile, upload documents, set up your menu, and connect Stripe to start receiving orders.',
}

export default function BecomeVendorPage() {
  return (
    <>
      <MarketplaceNavbar />
      <VendorOnboarding />
    </>
  )
}
