import MarketplaceNavbar from '../_components/MarketplaceNavbar'
import FairCard from '../_components/FairCard'
import WelcomeBanner from '../_components/WelcomeBanner'
import { getAllFairsCached } from '@/lib/fairs'
import { mockFairs } from '@/lib/mock'
import type { Fair, FairStatus } from '@/lib/mock'

export const metadata = {
  title: 'Discover Fairs — FairSynq',
}

const STATUS_ORDER: FairStatus[] = ['active', 'upcoming', 'completed', 'draft', 'archived']

const SECTION_LABELS: Partial<Record<FairStatus, string>> = {
  active:    'Happening Now',
  upcoming:  'Coming Soon',
  completed: 'Past Events',
}

function normalizeFairStatus(s: string): FairStatus {
  const map: Record<string, FairStatus> = {
    ACTIVE: 'active', UPCOMING: 'upcoming',
    INACTIVE: 'completed', COMPLETED: 'completed',
    PAUSED: 'paused', DRAFT: 'draft',
  }
  return map[s] ?? 'upcoming'
}

export default async function FairsPage() {
  let fairs: Fair[] = mockFairs

  try {
    const live = await getAllFairsCached()
    if (live.length > 0) {
      fairs = live.map(e => ({
        id: e.id,
        name: e.name,
        slug: e.slug,
        description: e.description,
        location: { city: 'Collinsville', state: 'IL', address: '' },
        dates: { startDate: e.startDate, endDate: e.endDate },
        status: normalizeFairStatus(e.status),
        operatingHours: { open: '', close: '' },
        branding: {
          accentColor: e.primaryColor,
          gradientFrom: e.primaryColor,
          gradientTo: '#7C3AED',
        },
        vendorCount: e.vendorCount,
        admissionFree: false,
      }))
    }
  } catch {
    // DB unavailable — fall through to mock data
  }

  const grouped = STATUS_ORDER.reduce<Record<string, Fair[]>>((acc, status) => {
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

          {/* Grouped sections */}
          {Object.entries(grouped).map(([status, section]) => (
            <section key={status} className="mb-14">
              <h2 className="font-bebas text-2xl text-white tracking-wide mb-6">
                {SECTION_LABELS[status as FairStatus] ?? status}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {section.map((fair) => (
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
