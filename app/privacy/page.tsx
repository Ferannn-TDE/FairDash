import type { Metadata } from 'next'
import MarketplaceNavbar from '@/app/_components/MarketplaceNavbar'
import LegalDocument from '@/app/_components/LegalDocument'
import { PRIVACY_POLICY_TEXT, PRIVACY_POLICY_PATH } from '@/lib/legal/privacy-policy'

// /privacy — the Privacy Policy (item 11, legal pages), word for word from lib/legal/privacy-policy.ts.
// Same layout as /vendor-agreement. Public: no pattern in proxy.ts protects it
// (scripts/legal-pages-test.ts).
export const metadata: Metadata = {
  title: 'Privacy Policy — FairSynq',
  description: 'What FairSynq collects when you use fairsynq.com and the ordering platform, how it is used, and your choices.',
  alternates: { canonical: PRIVACY_POLICY_PATH },
}

export default function PrivacyPolicyPage() {
  return (
    <>
      <MarketplaceNavbar />
      <main className="bg-bg-dark text-white min-h-screen pt-24 pb-20 px-4 sm:px-5 md:px-[6%] lg:px-8">
        <article className="max-w-2xl mx-auto">
          <LegalDocument text={PRIVACY_POLICY_TEXT} />
        </article>
      </main>
    </>
  )
}
