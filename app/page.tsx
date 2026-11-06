import { getAllFairsCached } from '@/lib/fairs'
import { toPublicFairCard, type PublicFairCard } from '@/lib/fair-view'
import MarketplaceLanding from './MarketplaceLanding'
import type { Metadata } from 'next'

// Server component: fetch the public fair list here (same source as /fairs) so the
// landing page's first paint already contains the real fairs. The client component
// receives them as a prop and never re-fetches — this is what kills the
// empty→populated flicker on "Happening Now & Soon".
export const metadata: Metadata = {
  // The client's exact strings (Platform Changes doc, SEO section). Absolute: no template appends.
  title: { absolute: 'FairSynq | Skip-the-Line Ordering for Fairs & Festivals' },
  description: 'Order fair food from your phone and pick it up at the booth or curbside. Free for vendors.',
  alternates: { canonical: '/' },
}

export default async function Page() {
  let initialFairs: PublicFairCard[] = []
  try {
    initialFairs = (await getAllFairsCached()).map(toPublicFairCard)
  } catch {
    // DB unavailable — render the landing with no fairs rather than crashing.
    initialFairs = []
  }

  return <MarketplaceLanding initialFairs={initialFairs} />
}
