import MarketplaceNavbar from '../_components/MarketplaceNavbar'
import FairCard from '../_components/FairCard'
import WelcomeBanner from '../_components/WelcomeBanner'
import { getAllFairsCached } from '@/lib/fairs'
import { toPublicFairCard, type PublicFairCard, type PublicFairStatus } from '@/lib/fair-view'

export const metadata = {
  title: 'Discover Fairs — FairSynq',
}

// Only publicly-listed statuses (the endpoint already filters to ACTIVE/UPCOMING;
// 'completed' kept for the section map in case an INACTIVE fair is ever surfaced).
const STATUS_ORDER: PublicFairStatus[] = ['active', 'upcoming', 'completed']

const SECTION_LABELS: Record<PublicFairStatus, string> = {
  active:    'Happening Now',
  upcoming:  'Coming Soon',
  completed: 'Past Events',
}

export default async function FairsPage() {
  let fairs: PublicFairCard[] = []
  try {
    fairs = (await getAllFairsCached()).map(toPublicFairCard)
  } catch {
    // DB unavailable — render the empty state rather than fake fairs.
    fairs = []
  }

  const grouped = STATUS_ORDER.reduce<Record<string, PublicFairCard[]>>((acc, status) => {
    const section = fairs.filter(f => f.status === status)
    if (section.length > 0) acc[status] = section
    return acc
  }, {})

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
            Object.entries(grouped).map(([status, section]) => (
              <section key={status} className="mb-14">
                <h2 className="font-bebas text-2xl text-white tracking-wide mb-6">
                  {SECTION_LABELS[status as PublicFairStatus] ?? status}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {section.map((fair) => (
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
