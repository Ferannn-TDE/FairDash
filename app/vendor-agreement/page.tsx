import type { Metadata } from 'next'
import MarketplaceNavbar from '@/app/_components/MarketplaceNavbar'
import { VENDOR_AGREEMENT_TEXT, VENDOR_AGREEMENT_VERSION } from '@/lib/legal/vendor-agreement'

// /vendor-agreement — the agreement vendors accept at sign-up, exactly as the wizard shows it and
// with the version the server records (lib/legal/vendor-agreement.ts). Item 11 replaces the text.
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
          <p className="text-xs text-text-gray font-inter uppercase tracking-widest">Version {VENDOR_AGREEMENT_VERSION}</p>
          <div className="mt-4 text-text-gray text-sm sm:text-[0.9375rem] leading-relaxed whitespace-pre-line">
            {VENDOR_AGREEMENT_TEXT}
          </div>
        </article>
      </main>
    </>
  )
}
