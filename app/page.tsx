import MarketplaceLanding from './MarketplaceLanding'
import type { Metadata } from 'next'
import { getHomepageBanner } from '@/lib/homepage-banner'

// Homepage v2. No fair list on the homepage any more ("I want food" goes to /fairs). The one
// settings read is the hero vendor sign-up banner (lib/homepage-banner.ts: cached, Off by default,
// and hidden if the read fails).
export const metadata: Metadata = {
  // Title: the client's exact string (Platform Changes doc, SEO section). Description: Jordan,
  // 2026-11-23 (homepage v2). Absolute: no template appends.
  title: { absolute: 'FairSynq | Skip-the-Line Ordering for Fairs & Festivals' },
  description: 'Order ahead and skip the line at fairs and festivals. Launching in 2027. Vendors, sign up free.',
  alternates: { canonical: '/' },
}

export default async function Page() {
  return <MarketplaceLanding banner={await getHomepageBanner()} />
}
