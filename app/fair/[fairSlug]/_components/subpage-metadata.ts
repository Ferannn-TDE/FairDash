import type { Metadata } from 'next'
import { getFairSeoBySlugCached } from '@/lib/fairs'
import { SITE_NAME, robotsFor } from '@/lib/seo'

/**
 * A public fair sub-page (menu, vendors, …): its own title and canonical. `robots` is left to the
 * fair layout (noindex until SEO_INDEX_FAIRS=1), which a child inherits when it doesn't set one.
 */
export async function fairSubpageMetadata(fairSlug: string, label: string, path: string): Promise<Metadata> {
  const fair = await getFairSeoBySlugCached(fairSlug).catch(() => null)
  if (!fair) return {}
  return {
    title: { absolute: `${label} · ${fair.name} | ${SITE_NAME}` },
    alternates: { canonical: `/fair/${fair.slug}${path}` },
  }
}

/** Cart, checkout and order pages: one customer's session, never indexed, flag or not. */
export const privateFairPageMetadata: Metadata = { robots: robotsFor('private'), alternates: { canonical: null } }
