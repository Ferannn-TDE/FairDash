import MarketplaceNavbar from '../_components/MarketplaceNavbar'
import FairCard from '../_components/FairCard'
import WelcomeBanner from '../_components/WelcomeBanner'
import { mockFairs } from '@/lib/mock'
import type { FairStatus } from '@/lib/mock'

const STATUS_ORDER: FairStatus[] = ['active', 'upcoming', 'completed', 'draft', 'archived']

const SECTION_LABELS: Partial<Record<FairStatus, string>> = {
  active:    'Happening Now',
  upcoming:  'Coming Soon',
  completed: 'Past Events',
}

export const metadata = {
  title: 'Discover Fairs — FairSynq',
}

export default function FairsPage() {
  const grouped = STATUS_ORDER.reduce<Record<string, typeof mockFairs>>((acc, status) => {
    const fairs = mockFairs.filter((f) => f.status === status)
    if (fairs.length > 0) acc[status] = fairs
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

          {/* Grouped sections */}
          {Object.entries(grouped).map(([status, fairs]) => (
            <section key={status} className="mb-14">
              <h2 className="font-bebas text-2xl text-white tracking-wide mb-6">
                {SECTION_LABELS[status as FairStatus] ?? status}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {fairs.map((fair) => (
                  <FairCard key={fair.id} fair={fair} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  )
}
