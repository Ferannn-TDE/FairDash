import type { MetadataRoute } from 'next'
import { fairsIndexable, sitemapEntries, type SitemapFair } from '@/lib/seo'
import { getSitemapFairsCached } from '@/lib/fairs'

export const revalidate = 3600

// Home and /fairs on production; fair pages only with SEO_INDEX_FAIRS=1 (lib/seo.ts).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let fairs: SitemapFair[] = []
  if (fairsIndexable()) {
    try { fairs = await getSitemapFairsCached() } catch { /* DB down: list the static pages only */ }
  }
  return sitemapEntries(fairs)
}
