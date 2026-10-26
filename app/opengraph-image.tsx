import { ImageResponse } from 'next/og'
import { OG_CONTENT_TYPE, OG_SIZE, OgFrame, ogFonts } from '@/lib/og-image'

export const alt = 'FairSynq: order fair food ahead'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default async function Image() {
  return new ImageResponse(
    <OgFrame kicker="Fair food, ordered ahead" title="The fair comes to your door" lines={['Pickup and delivery from your favorite fair vendors']} />,
    { ...OG_SIZE, fonts: await ogFonts() },
  )
}
