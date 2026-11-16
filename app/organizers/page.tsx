import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckIcon } from '@heroicons/react/24/outline'
import MarketplaceNavbar from '@/app/_components/MarketplaceNavbar'
import { ORGANIZERS_PAGE, ORGANIZERS_PATH } from '@/lib/organizer-copy'
import { robotsFor } from '@/lib/seo'
import OrganizerVideoSlot from './OrganizerVideoSlot'

// /organizers — the public "For Fairs & Festivals" page (C-15, BATCH-1 §21). No login: the proxy's
// organizer gate covers /organizer and /organizer/… only. Copy is lib/organizer-copy.ts, word for
// word. noindex and not in the sitemap.
export const metadata: Metadata = {
  title: ORGANIZERS_PAGE.title,
  description: ORGANIZERS_PAGE.intro,
  alternates: { canonical: ORGANIZERS_PATH },
  robots: robotsFor('private'),
}

const P = ORGANIZERS_PAGE

function Points({ heading, points }: { heading: string; points: readonly string[] }) {
  return (
    <section className="mt-12">
      <h2 className="font-bebas text-3xl sm:text-4xl tracking-wide leading-none">{heading}</h2>
      <ul className="mt-5 space-y-3">
        {points.map(pt => (
          <li key={pt} className="flex items-start gap-3 text-sm sm:text-base text-white/90 leading-relaxed">
            <CheckIcon className="w-5 h-5 text-neon-pink shrink-0 mt-0.5" />
            <span>{pt}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function OrganizersPage() {
  return (
    <>
      <MarketplaceNavbar />
      <main className="bg-bg-dark text-white min-h-screen pt-24 pb-20 px-4 sm:px-5 md:px-[6%] lg:px-8">
        <div className="max-w-2xl mx-auto">
          <p className="text-neon-pink text-xs font-semibold tracking-[0.2em]">{P.eyebrow}</p>
          <h1 className="mt-3 font-bebas text-4xl sm:text-5xl md:text-6xl tracking-wide leading-none">{P.heading}</h1>
          <p className="mt-4 text-text-gray text-base sm:text-lg leading-relaxed">{P.intro}</p>

          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <Link
              href={P.primaryButton.href}
              className="inline-flex items-center justify-center px-6 py-3 bg-neon-pink text-white rounded-xl font-semibold hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors no-underline"
            >
              {P.primaryButton.label}
            </Link>
            <Link
              href={P.secondaryButton.href}
              className="inline-flex items-center justify-center px-6 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold hover:bg-white/10 transition-colors no-underline"
            >
              {P.secondaryButton.label}
            </Link>
          </div>

          <OrganizerVideoSlot />

          <Points heading={P.canDo.heading} points={P.canDo.points} />
          <Points heading={P.noInstall.heading} points={P.noInstall.points} />

          <section className="mt-12">
            <h2 className="font-bebas text-3xl sm:text-4xl tracking-wide leading-none">{P.steps.heading}</h2>
            <ol className="mt-5 space-y-3">
              {P.steps.points.map((step, i) => (
                <li key={step} className="flex items-start gap-3 text-sm sm:text-base text-white/90 leading-relaxed">
                  <span className="w-6 h-6 rounded-full bg-neon-pink/10 border border-neon-pink/30 text-neon-pink text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </main>
    </>
  )
}
