import MarketplaceLanding from './MarketplaceLanding'
import type { Metadata } from 'next'

// Homepage v2. No fair list on the homepage any more ("I want food" goes to /fairs), so no
// database read here.
export const metadata: Metadata = {
  // Title: the client's exact string (Platform Changes doc, SEO section). Description: Jordan,
  // 2026-11-23 (homepage v2). Absolute: no template appends.
  title: { absolute: 'FairSynq | Skip-the-Line Ordering for Fairs & Festivals' },
  description: 'Order ahead and skip the line at fairs and festivals. Launching in 2027. Vendors, sign up free.',
  alternates: { canonical: '/' },
}

export default function Page() {
  return <MarketplaceLanding />
}
