// The homepage hero vendor sign-up banner (Jordan, 2026-11-23): what the page shows, from the two
// "Homepage: vendor sign-up banner" settings. Server only.
// Cached with the 'homepage-banner' tag; app/api/admin/settings revalidates it when a homepage.*
// key is saved, so a change shows on the next page load (as lib/videos.ts does for videos).
// null = no banner: the switch is Off (the default), or the settings could not be read.
import { unstable_cache } from 'next/cache'
import { getSetting } from '@/lib/settings'
import { heroBannerText } from '@/lib/homepage-copy-rules'

export const HOMEPAGE_BANNER_CACHE_TAG = 'homepage-banner'

async function readBanner(): Promise<string | null> {
  try {
    // Keys spelled out so the settings test can see this reader.
    const [enabled, text] = await Promise.all([
      getSetting('homepage.vendorBanner.enabled'),
      getSetting('homepage.vendorBanner.text'),
    ])
    return heroBannerText(enabled, text)
  } catch (err) {
    // A settings read failure must never take the homepage down: the banner just stays hidden.
    console.error('[homepage-banner] could not read the banner settings', err)
    return null
  }
}

export const getHomepageBanner = unstable_cache(readBanner, ['homepage-banner'], { revalidate: 300, tags: [HOMEPAGE_BANNER_CACHE_TAG] })
