import MarketplaceNavbar from '../_components/MarketplaceNavbar'
import FairCard from '../_components/FairCard'
import WelcomeBanner from '../_components/WelcomeBanner'
import { getAllFairsCached } from '@/lib/fairs'
import { toPublicFairCard, partitionFairCards, type PublicFairCard } from '@/lib/fair-view'

export const metadata = {
  title: 'Discover Fairs — FairSynq',
  description: 'Find fairs near you and order fair food ahead for booth pickup or curbside with FairSynq.',
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

  // Sections by DATE (fairCardState), never the admin status. Ended fairs are not listed:
  // this page shows current events only, and says so when there are none.
  const { live, upcoming } = partitionFairCards(fairs)
  const sections = [
    { key: 'live', label: 'Happening Now', fairs: live },
    { key: 'upcoming', label: 'Coming Soon', fairs: upcoming },
  ].filter(s => s.fairs.length > 0)

  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">
        <WelcomeBanner />
        <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-12">

          {/* Hero */}
          <div className="mb-12 text-center sm:text-left">
            <p className="text-text-gray text-xs sm:text-sm font-semibold uppercase tracking-widest mb-3">
              Discover Fairs
            </p>
            <h1 className="font-bebas text-5xl sm:text-6xl md:text-7xl text-white tracking-wide leading-none">
              Skip the line. <span className="text-neon-pink">Order ahead.</span>
            </h1>
            <p className="text-text-gray mt-4 text-base sm:text-lg max-w-2xl sm:mx-0 mx-auto">
              Browse vendors, order your food ahead, and pick it up at the booth. No waiting around.
            </p>
          </div>

          {sections.length === 0 ? (
            <div className="bg-bg-card border border-white/10 rounded-2xl py-20 px-6 text-center">
              <p className="text-white font-semibold">
                Events coming soon. Check back for 2027 fairs and festivals.
              </p>
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
