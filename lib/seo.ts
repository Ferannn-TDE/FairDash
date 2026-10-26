// SEO — who may be indexed, and what a fair page tells search engines and link previews.
//
// TWO SWITCHES, both default OFF:
//   • siteIndexable: only the real production site (www.fairsynq.com) may be indexed. Preview,
//     localhost and any staging project get noindex everywhere and a robots.txt of
//     "Disallow: /". Vercel sets VERCEL_ENV=production on EVERY project's production deploys, so
//     the production URL is checked too: a staging project has its own.
//   • fairsIndexable: fair pages are test data until the February cutover. SEO_INDEX_FAIRS=1
//     (exactly) lets them be indexed and listed in the sitemap; anything else keeps them
//     noindex and out of it. The home page and /fairs follow siteIndexable alone.
//
// Pure: no imports from the database, so the sitemap, robots, metadata and the gate test all
// read the same rules.

import { formatEventDate } from '@/lib/event-date'

export const SITE_URL = 'https://www.fairsynq.com'
export const SITE_HOST = 'www.fairsynq.com'
export const SITE_NAME = 'FairSynq'

export type SeoEnv = {
  VERCEL_ENV?: string
  VERCEL_PROJECT_PRODUCTION_URL?: string
  SEO_INDEX_FAIRS?: string
}

// Literal process.env reads: a value read through a variable can come back empty on Vercel.
const liveEnv = (): SeoEnv => ({
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  SEO_INDEX_FAIRS: process.env.SEO_INDEX_FAIRS,
})

export function siteIndexable(env: SeoEnv = liveEnv()): boolean {
  return env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL === SITE_HOST
}

export function fairsIndexable(env: SeoEnv = liveEnv()): boolean {
  return siteIndexable(env) && env.SEO_INDEX_FAIRS === '1'
}

/**
 * The robots directive for a page.
 *   public  — home, /fairs, help pages: indexable on production.
 *   fair    — public fair pages: also needs SEO_INDEX_FAIRS=1.
 *   private — cart, checkout, orders, sign-in: never.
 * A child segment's `robots` replaces its parent's, so every page that sets one goes through here.
 */
export function robotsFor(kind: 'public' | 'fair' | 'private', env: SeoEnv = liveEnv()): { index: boolean; follow: boolean } {
  if (!siteIndexable(env)) return { index: false, follow: false }
  if (kind === 'private') return { index: false, follow: true }
  if (kind === 'fair' && !fairsIndexable(env)) return { index: false, follow: true }
  return { index: true, follow: true }
}

/** Paths crawlers are told to stay out of on production. */
export const DISALLOWED_PATHS = ['/vendor', '/runner', '/organizer', '/admin', '/account', '/api']

export type RobotsFile = { rules: { userAgent: string; allow?: string; disallow: string | string[] }; sitemap?: string; host?: string }

export function robotsFile(env: SeoEnv = liveEnv()): RobotsFile {
  if (!siteIndexable(env)) return { rules: { userAgent: '*', disallow: '/' } }
  return { rules: { userAgent: '*', allow: '/', disallow: DISALLOWED_PATHS }, sitemap: `${SITE_URL}/sitemap.xml`, host: SITE_URL }
}

export type SitemapFair = { slug: string; startDate: string | Date; endDate: string | Date; updatedAt: string | Date; vendorIds: string[] }
export type SitemapEntry = { url: string; lastModified?: Date; changeFrequency?: 'daily' | 'weekly'; priority?: number }

/**
 * Home and /fairs always (on production); fair home + vendor pages only with SEO_INDEX_FAIRS=1,
 * and only for fairs that haven't ended (ended fair pages stay reachable, just unlisted).
 * Off production the sitemap is empty: robots.txt points nowhere there anyway.
 */
export function sitemapEntries(fairs: SitemapFair[], env: SeoEnv = liveEnv(), now = new Date()): SitemapEntry[] {
  if (!siteIndexable(env)) return []
  const out: SitemapEntry[] = [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/fairs`, changeFrequency: 'daily', priority: 0.9 },
  ]
  if (!fairsIndexable(env)) return out
  for (const f of fairs) {
    if (!notEnded(f.endDate, now)) continue
    const lastModified = new Date(f.updatedAt)
    out.push({ url: fairUrl(f.slug), lastModified, changeFrequency: 'daily', priority: 0.8 })
    for (const id of f.vendorIds) out.push({ url: `${fairUrl(f.slug)}/vendor/${encodeURIComponent(id)}`, lastModified, changeFrequency: 'weekly', priority: 0.5 })
  }
  return out
}

/** A fair date is a calendar date carried at UTC midnight (lib/event-date); it has ended once that whole day is over. */
function notEnded(end: string | Date, now: Date): boolean {
  const d = new Date(end)
  const lastDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return now.getTime() < lastDay + 864e5
}

export const fairUrl = (slug: string) => `${SITE_URL}/fair/${encodeURIComponent(slug)}`
export const fairImageUrl = (slug: string) => `${fairUrl(slug)}/opengraph-image`

// ─── A fair, as search engines see it ─────────────────────────────────────────

export type FairSeo = {
  name: string
  slug: string
  description: string | null
  startDate: string | Date
  endDate: string | Date
  timezone: string
  openTime: string | null
  closeTime: string | null
  venueAddress: string | null
  venueCity: string | null
  venueState: string | null
  venueZip: string | null
  admissionFree: boolean
  organizerName: string | null
  /** The ready-vendor count customers see (same gate as /fairs). */
  vendorCount: number
  /** null = no FulfillmentConfig row: booth pickup only, the schema defaults. */
  fulfillment: { boothPickupEnabled: boolean; curbsideEnabled: boolean; homeDeliveryEnabled: boolean } | null
}

export function fairPlace(f: Pick<FairSeo, 'venueCity' | 'venueState'>): string | null {
  const city = f.venueCity?.trim(), state = f.venueState?.trim()
  return city && state ? `${city}, ${state}` : city || state || null
}

/** "Oct 24–26" (same month), "Oct 30 – Nov 2", or one day. No year: the title's fair name usually has it. */
export function fairShortDates(start: string | Date, end: string | Date): string | null {
  const s = formatEventDate(start, { month: 'short', day: 'numeric' })
  const e = formatEventDate(end, { month: 'short', day: 'numeric' })
  if (!s) return null
  if (!e || e === s) return s
  const [sm] = s.split(' '), [em, ed] = e.split(' ')
  return sm === em ? `${s}–${ed}` : `${s} – ${em} ${ed}`
}

export function fairTitle(f: FairSeo): string {
  return [f.name, fairShortDates(f.startDate, f.endDate), fairPlace(f)].filter(Boolean).join(' · ') + ` | ${SITE_NAME}`
}

/**
 * How customers can get their food, from the fair's real settings: "Pickup or delivery",
 * "Pickup, curbside or delivery", "Curbside", … null when nothing is enabled.
 */
export function fulfillmentPhrase(fc: FairSeo['fulfillment']): string | null {
  const c = fc ?? { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: false }
  const ways = [c.boothPickupEnabled && 'pickup', c.curbsideEnabled && 'curbside', c.homeDeliveryEnabled && 'delivery'].filter(Boolean) as string[]
  if (ways.length === 0) return null
  const s = ways.length === 1 ? ways[0] : `${ways.slice(0, -1).join(', ')} or ${ways[ways.length - 1]}`
  return s[0].toUpperCase() + s.slice(1)
}

export function fairDescription(f: FairSeo): string {
  const vendors = f.vendorCount > 0 ? ` from ${f.vendorCount} ${f.vendorCount === 1 ? 'vendor' : 'vendors'}` : ''
  const when = fairShortDates(f.startDate, f.endDate)
  const place = fairPlace(f)
  const whenWhere = [when && `, ${when}`, place && ` in ${place}`].filter(Boolean).join('')
  const how = fulfillmentPhrase(f.fulfillment)
  return `Order ahead${vendors} at ${f.name}${whenWhere}.${how ? ` ${how} with ${SITE_NAME}.` : ''}`
}

// ─── schema.org Event ─────────────────────────────────────────────────────────

/** "-05:00" for that zone on that day; null when the zone is unknown. */
function zoneOffset(dayUtc: Date, timeZone: string): string | null {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(dayUtc.getTime() + 12 * 36e5))
      .find(p => p.type === 'timeZoneName')?.value
    if (!name) return null
    if (name === 'GMT') return '+00:00'
    const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name)
    return m ? `${m[1]}${m[2].padStart(2, '0')}:${m[3] ?? '00'}` : null
  } catch { return null }
}

/**
 * A fair day as schema.org wants it: "2026-10-24T11:00:00-05:00" when the daily time is known,
 * else the date alone ("2026-10-24"). The day comes from the UTC carrier (lib/event-date); the
 * time and offset from the fair's own clock.
 */
export function fairDateTime(day: string | Date, time: string | null, timeZone: string): string {
  const d = new Date(day)
  const date = d.toISOString().slice(0, 10)
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return date
  const off = zoneOffset(d, timeZone)
  return off ? `${date}T${time}:00${off}` : date
}

/** Only fields the fair actually has; a missing address means no `location`, never a guess. */
export function fairEventJsonLd(f: FairSeo): Record<string, unknown> {
  const url = fairUrl(f.slug)
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: f.name,
    url,
    startDate: fairDateTime(f.startDate, f.openTime, f.timezone),
    endDate: fairDateTime(f.endDate, f.closeTime, f.timezone),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    image: [fairImageUrl(f.slug)],
    description: f.description?.trim() || fairDescription(f),
    organizer: f.organizerName
      ? { '@type': 'Organization', name: f.organizerName }
      : { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  }
  if (f.venueAddress?.trim()) {
    ld.location = {
      '@type': 'Place',
      name: fairPlace(f) ?? f.venueAddress.trim(),
      address: {
        '@type': 'PostalAddress',
        streetAddress: f.venueAddress.trim(),
        ...(f.venueCity?.trim() && { addressLocality: f.venueCity.trim() }),
        ...(f.venueState?.trim() && { addressRegion: f.venueState.trim() }),
        ...(f.venueZip?.trim() && { postalCode: f.venueZip.trim() }),
        addressCountry: 'US',
      },
    }
  }
  if (f.admissionFree) {
    ld.offers = { '@type': 'Offer', price: 0, priceCurrency: 'USD', availability: 'https://schema.org/InStock', url, validFrom: fairDateTime(f.startDate, null, f.timezone) }
  }
  return ld
}

/** JSON for a <script type="application/ld+json">: `<` escaped so a fair name can't close the tag. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
