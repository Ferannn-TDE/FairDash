import { ImageResponse } from 'next/og'
import { getFairSeoBySlugCached } from '@/lib/fairs'
import { fairPlace } from '@/lib/seo'
import { formatEventDateRange } from '@/lib/event-date'
import { OG_CONTENT_TYPE, OG_SIZE, OgFrame, ogFonts } from '@/lib/og-image'

export const alt = 'This fair on FairSynq'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

// The fair's own share card: name, dates, place, vendor count. Only what the fair has.
export default async function Image({ params }: { params: Promise<{ fairSlug: string }> }) {
  const { fairSlug } = await params
  const fair = await getFairSeoBySlugCached(fairSlug).catch(() => null)
  const fonts = await ogFonts()
  if (!fair) {
    return new ImageResponse(<OgFrame kicker="FairSynq" title="Fair not found" lines={[]} />, { ...OG_SIZE, fonts })
  }
  const dates = formatEventDateRange(fair.startDate, fair.endDate, '')
  const place = fairPlace(fair)
  const lines = [
    [dates, place].filter(Boolean).join('  ·  '),
    fair.vendorCount > 0 ? `${fair.vendorCount} ${fair.vendorCount === 1 ? 'vendor' : 'vendors'}` : '',
  ].filter(Boolean)
  return new ImageResponse(<OgFrame kicker="Order ahead on FairSynq" title={fair.name} lines={lines} />, { ...OG_SIZE, fonts })
}
