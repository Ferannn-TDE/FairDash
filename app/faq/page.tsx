import Link from 'next/link'
import { PlusIcon, MinusIcon } from '@heroicons/react/24/outline'
import MarketplaceNavbar from '../_components/MarketplaceNavbar'
import { FAQ_CATEGORIES } from '../_components/faq-content'

export const metadata = {
  title: 'FAQ — FairSynq',
  description: 'Answers for customers, vendors, runners, and organizers.',
}

// ---------------------------------------------------------------------------
// The accordion is a native <details>/<summary> — no state, no Radix, no
// client boundary, so this page stays a server component like /refund-policy.
// The +/− swap is pure CSS: `group-open:` keys off the <details open> attribute.
//
// The 15 answers are NOT written here. They come from ../_components/faq-content,
// which the landing page's tabbed <FAQSection /> also reads — one array, two
// renderers, so the stacked page and the animated section cannot drift apart.
// This page is the server-rendered one, for deep links and SEO.
// ---------------------------------------------------------------------------

export default function FAQPage() {
  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">

        {/* Hero */}
        <section className="py-14 border-b border-white/5 bg-[radial-gradient(circle_at_50%_0%,rgba(255,0,119,0.08),transparent_60%)]">
          <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 text-center">
            <h1 className="font-bebas text-5xl sm:text-6xl text-white tracking-wide">
              Frequently asked <span className="text-neon-pink">questions</span>
            </h1>
            <p className="mt-3 text-text-gray text-sm">
              Answers for customers, vendors, runners, and organizers.
            </p>
          </div>
        </section>

        {/* Content */}
        <section className="max-w-[800px] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-14 space-y-10">

          {FAQ_CATEGORIES.map(({ id, label, items }) => (
            <div key={id}>
              <h2 className="font-bebas text-2xl tracking-wide text-white mb-4">{label}</h2>

              <div className="flex flex-col gap-3">
                {items.map(({ q, a, cta }) => (
                  <details
                    key={q}
                    className="group bg-bg-card border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
                  >
                    <summary className="flex items-center justify-between gap-4 cursor-pointer list-none p-5 [&::-webkit-details-marker]:hidden">
                      <span className="text-white text-sm font-medium">{q}</span>
                      <span className="shrink-0 w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                        <PlusIcon className="w-4 h-4 text-text-gray group-open:hidden" />
                        <MinusIcon className="w-4 h-4 text-neon-pink hidden group-open:block" />
                      </span>
                    </summary>

                    <div className="px-5 pb-5">
                      <p className="text-text-gray text-sm leading-relaxed">{a}</p>
                      {cta && (
                        <Link
                          href={cta.href}
                          className="inline-block mt-3 text-sm font-semibold text-neon-pink hover:text-white transition-colors"
                        >
                          {cta.label} →
                        </Link>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ))}

        </section>

      </div>
    </>
  )
}
