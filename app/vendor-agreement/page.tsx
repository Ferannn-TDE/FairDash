import type { Metadata } from 'next'
import MarketplaceNavbar from '@/app/_components/MarketplaceNavbar'
import LegalDocument from '@/app/_components/LegalDocument'
import { VENDOR_AGREEMENT_TEXT } from '@/lib/legal/vendor-agreement'

// /vendor-agreement — the agreement vendors accept at sign-up, exactly as the wizard shows it
// (lib/legal/vendor-agreement.ts; the server records its version). Only the agreement's own words
// are shown: no separate version line (Jordan, 2026-11-23).
export const metadata: Metadata = {
  title: 'Vendor Agreement — FairSynq',
  description: 'The agreement vendors accept when they apply to sell with FairSynq.',
  alternates: { canonical: '/vendor-agreement' },
}

export default function VendorAgreementPage() {
  return (
    <>
      <MarketplaceNavbar />
      <main className="bg-bg-dark text-white min-h-screen pt-24 pb-20 px-4 sm:px-5 md:px-[6%] lg:px-8">
        <article className="max-w-2xl mx-auto">
          <LegalDocument text={VENDOR_AGREEMENT_TEXT} />
        </article>
      </main>
    </>
  )
}
