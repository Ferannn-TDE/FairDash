import MarketplaceNavbar from '../_components/MarketplaceNavbar'
import FairCard from '../_components/FairCard'
import WelcomeBanner from '../_components/WelcomeBanner'
import { getAllFairsCached } from '@/lib/fairs'
import { toPublicFairCard, partitionFairCards, type PublicFairCard } from '@/lib/fair-view'

export const metadata = {
  title: 'Discover Fairs — FairSynq',
  description: 'Find fairs near you and order fair food ahead for pickup or delivery with FairSynq.',
  alternates: { canonical: '/fairs' },
}

export default async function FairsPage() {
  let fairs: PublicFairCard[] = []
  try {
    fairs = (await getAllFairsCached()).map(toPublicFairCard)
  } catch {
    // DB unavailable — render the empty state rather than fake fairs.
    fairs = []
  }

  // Sections by DATE (fairCardState), never the admin status: ended fairs only ever
  // appear under "Past events", where their card says "View fair".
  const { live, upcoming, past } = partitionFairCards(fairs)
  const sections = [
    { key: 'live', label: 'Happening Now', fairs: live },
    { key: 'upcoming', label: 'Coming Soon', fairs: upcoming },
    { key: 'past', label: 'Past Events', fairs: past },
  ].filter(s => s.fairs.length > 0)

  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">
        <WelcomeBanner />
        <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-12">

          {/* Header */}
          <div className="mb-10">
            <h1 className="font-bebas text-5xl text-white tracking-wide">Discover Fairs</h1>
            <p className="text-text-gray mt-2">
              Find a fair near you and order ahead from your favorite vendors.
            </p>
          </div>

          {fairs.length === 0 ? (
            <div className="bg-bg-card border border-white/10 rounded-2xl py-20 text-center">
              <p className="text-white font-semibold mb-1">No fairs are live right now</p>
              <p className="text-text-gray text-sm">Check back soon — new fairs are added regularly.</p>
            </div>
          ) : (
            /* Grouped sections */
            sections.map(section => (
              <section key={section.key} className="mb-14">
                <h2 className="font-bebas text-2xl text-white tracking-wide mb-6">
                  {section.label}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {section.fairs.map((fair) => (
                    <FairCard key={fair.id} fair={fair} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </>
  )
}
