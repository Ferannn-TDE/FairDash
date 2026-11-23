import type { Metadata } from 'next'
import MarketplaceNavbar from '@/app/_components/MarketplaceNavbar'
import LegalDocument from '@/app/_components/LegalDocument'
import { WEBSITE_TERMS_TEXT, WEBSITE_TERMS_PATH } from '@/lib/legal/website-terms'

// /terms — the Website Terms of Service (item 11, legal pages), word for word from
// lib/legal/website-terms.ts. Same layout as /vendor-agreement. Public: no pattern in proxy.ts
// protects it (scripts/legal-pages-test.ts).
export const metadata: Metadata = {
  title: 'Website Terms of Service — FairSynq',
  description: 'The terms for using fairsynq.com and the FairSynq platform.',
  alternates: { canonical: WEBSITE_TERMS_PATH },
}

export default function WebsiteTermsPage() {
  return (
    <>
      <MarketplaceNavbar />
      <main className="bg-bg-dark text-white min-h-screen pt-24 pb-20 px-4 sm:px-5 md:px-[6%] lg:px-8">
        <article className="max-w-2xl mx-auto">
          <LegalDocument text={WEBSITE_TERMS_TEXT} />
        </article>
      </main>
    </>
  )
}
