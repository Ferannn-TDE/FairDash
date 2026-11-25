import type { Metadata } from 'next'
import { CheckIcon } from '@heroicons/react/24/outline'
import MarketplaceNavbar from '@/app/_components/MarketplaceNavbar'
import { PARTNER_CARD } from '@/lib/partner-copy'
import { getSignedInContact } from '@/lib/signed-in-contact'
import PartnerApplicationForm from './PartnerApplicationForm'
import PartnerVideoSlot from './PartnerVideoSlot'

// /partners — public partner organization sign-up (Batch 1 items 7: B1.8 + B1.11). No login.
// The pitch is the client's card copy, word for word (lib/partner-copy.ts).
export const metadata: Metadata = {
  title: 'Partner with FairSynq',
  description: PARTNER_CARD.text,
  alternates: { canonical: '/partners' },
}

// A signed-in visitor's form starts filled in with their name, email and phone (never ask
// twice), so this page is personal: rendered for each visitor, never prerendered, cached or shared.
export const dynamic = 'force-dynamic'

export default async function PartnersPage() {
  const prefill = await getSignedInContact()
  return (
    <>
      <MarketplaceNavbar />
      <main className="bg-bg-dark text-white min-h-screen pt-24 pb-20 px-4 sm:px-5 md:px-[6%] lg:px-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="font-bebas text-4xl sm:text-5xl md:text-6xl tracking-wide leading-none">{PARTNER_CARD.heading}</h1>
          <p className="mt-4 text-text-gray text-base sm:text-lg leading-relaxed">{PARTNER_CARD.text}</p>
          <ul className="mt-6 space-y-2.5">
            {PARTNER_CARD.points.map(pt => (
              <li key={pt} className="flex items-start gap-3 text-sm sm:text-base text-white/90 leading-relaxed">
                <CheckIcon className="w-5 h-5 text-neon-pink shrink-0 mt-0.5" />
                <span>{pt}</span>
              </li>
            ))}
          </ul>

          <PartnerVideoSlot />

          <PartnerApplicationForm prefill={prefill} />
        </div>
      </main>
    </>
  )
}
