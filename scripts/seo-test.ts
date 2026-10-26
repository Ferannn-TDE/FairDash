/**
 * SEO — only www is indexable, fair pages stay out of search until SEO_INDEX_FAIRS=1, and what a
 * fair page tells search engines is only what the fair has.
 *
 *   [1] siteIndexable / fairsIndexable: production AND the www project only; the flag is exactly '1'
 *   [2] robotsFor: public / fair / private on every host
 *   [3] robots.txt: Disallow everything off production; portals + API on production
 *   [4] sitemap: empty off production, static pages only with the flag off, fairs + vendors with it on
 *   [5] fair title + description: dates, place, vendor count, real fulfillment options
 *   [6] schema.org Event: required fields, no invented location or price, zone offsets, escaping
 *   [7] wiring: every page that sets robots goes through robotsFor; private fair pages are noindex;
 *       every public fair sub-page sets a canonical; fonts ship with their licences
 *
 * No database, no network. Run:  npx tsx scripts/seo-test.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  siteIndexable, fairsIndexable, robotsFor, robotsFile, sitemapEntries, fairTitle, fairDescription,
  fulfillmentPhrase, fairEventJsonLd, fairDateTime, jsonLdScript, DISALLOWED_PATHS, SITE_URL,
  type FairSeo, type SeoEnv, type SitemapFair,
} from '../lib/seo'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }
const eq = (got: unknown, want: unknown, label: string) =>
  assert(JSON.stringify(got) === JSON.stringify(want), `${label}${JSON.stringify(got) === JSON.stringify(want) ? '' : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`)
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')

const PROD: SeoEnv = { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'www.fairsynq.com' }
const PROD_FAIRS: SeoEnv = { ...PROD, SEO_INDEX_FAIRS: '1' }
const PREVIEW: SeoEnv = { VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'www.fairsynq.com', SEO_INDEX_FAIRS: '1' }
const STAGING: SeoEnv = { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'staging.fairsynq.com', SEO_INDEX_FAIRS: '1' }
const LOCAL: SeoEnv = { SEO_INDEX_FAIRS: '1' }

console.log('[1] who may be indexed')
assert(siteIndexable(PROD), 'www production → indexable')
assert(!siteIndexable(PREVIEW), 'Preview → not')
assert(!siteIndexable(STAGING), 'a staging project (VERCEL_ENV=production, other URL) → not')
assert(!siteIndexable(LOCAL), 'local / unset → not')
assert(!siteIndexable({ VERCEL_ENV: 'production' }), 'production with no project URL → not (default deny)')
assert(fairsIndexable(PROD_FAIRS), 'fairs: www production + SEO_INDEX_FAIRS=1 → indexable')
for (const v of [undefined, '', '0', 'true', 'yes', ' 1', '1 ']) assert(!fairsIndexable({ ...PROD, SEO_INDEX_FAIRS: v }), `fairs: SEO_INDEX_FAIRS=${JSON.stringify(v)} → not`)
assert(!fairsIndexable(PREVIEW) && !fairsIndexable(STAGING) && !fairsIndexable(LOCAL), 'fairs: the flag never overrides a non-production host')

console.log('\n[2] robotsFor')
const NO = { index: false, follow: false }
for (const [name, env] of [['Preview', PREVIEW], ['staging', STAGING], ['local', LOCAL]] as const)
  for (const k of ['public', 'fair', 'private'] as const) eq(robotsFor(k, env), NO, `${name} ${k} → noindex, nofollow`)
eq(robotsFor('public', PROD), { index: true, follow: true }, 'production public → index')
eq(robotsFor('fair', PROD), { index: false, follow: true }, 'production fair, flag off → noindex')
eq(robotsFor('fair', PROD_FAIRS), { index: true, follow: true }, 'production fair, flag on → index')
eq(robotsFor('private', PROD_FAIRS), { index: false, follow: true }, 'production private, flag on → still noindex')

console.log('\n[3] robots.txt')
eq(robotsFile(PREVIEW), { rules: { userAgent: '*', disallow: '/' } }, 'Preview: Disallow: /, no sitemap')
eq(robotsFile(STAGING), { rules: { userAgent: '*', disallow: '/' } }, 'staging: Disallow: /')
const prodRobots = robotsFile(PROD)
eq(prodRobots.rules.disallow, ['/vendor', '/runner', '/organizer', '/admin', '/account', '/api'], 'production disallows exactly the portals + API')
eq(prodRobots.sitemap, `${SITE_URL}/sitemap.xml`, 'production points at the www sitemap')
assert(!DISALLOWED_PATHS.some(p => '/fair/italian-fest'.startsWith(p) || '/fairs'.startsWith(p)), '/fair/… and /fairs are not caught by a /vendor-style prefix')

console.log('\n[4] sitemap')
const NOW = new Date('2026-10-26T15:00:00Z')
const fairs: SitemapFair[] = [
  { slug: 'live-fest', startDate: '2026-10-24T00:00:00.000Z', endDate: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', vendorIds: ['v1', 'v2'] },
  { slug: 'ends-today', startDate: '2026-10-20T00:00:00.000Z', endDate: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', vendorIds: [] },
  { slug: 'ended', startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', vendorIds: ['v9'] },
]
eq(sitemapEntries(fairs, PREVIEW, NOW), [], 'Preview → empty')
eq(sitemapEntries(fairs, PROD, NOW).map(e => e.url), [SITE_URL, `${SITE_URL}/fairs`], 'production, flag off → home + /fairs only')
const on = sitemapEntries(fairs, PROD_FAIRS, NOW).map(e => e.url)
eq(on, [SITE_URL, `${SITE_URL}/fairs`, `${SITE_URL}/fair/live-fest`, `${SITE_URL}/fair/live-fest/vendor/v1`, `${SITE_URL}/fair/live-fest/vendor/v2`, `${SITE_URL}/fair/ends-today`],
  'flag on → fair home + vendor pages; a fair on its last day stays; an ended fair drops out')

console.log('\n[5] title + description')
const base: FairSeo = {
  name: 'Italian Fest 2026', slug: 'italian-fest', description: null,
  startDate: '2026-10-24T00:00:00.000Z', endDate: '2026-10-26T00:00:00.000Z', timezone: 'America/Chicago',
  openTime: '11:00', closeTime: '22:00', venueAddress: '125 W Main St', venueCity: 'Collinsville', venueState: 'IL', venueZip: '62234',
  admissionFree: true, organizerName: 'Collinsville Chamber', vendorCount: 12,
  fulfillment: { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: true },
}
eq(fairTitle(base), 'Italian Fest 2026 · Oct 24–26 · Collinsville, IL | FairSynq', 'title: name · dates · place')
eq(fairTitle({ ...base, endDate: '2026-11-02T00:00:00.000Z' }), 'Italian Fest 2026 · Oct 24 – Nov 2 · Collinsville, IL | FairSynq', 'title across months')
eq(fairTitle({ ...base, endDate: base.startDate, venueCity: null, venueState: null }), 'Italian Fest 2026 · Oct 24 | FairSynq', 'one day, no place')
eq(fairDescription(base), 'Order ahead from 12 vendors at Italian Fest 2026, Oct 24–26 in Collinsville, IL. Pickup or delivery with FairSynq.', 'description with delivery')
eq(fairDescription({ ...base, vendorCount: 1, fulfillment: { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: false } }),
  'Order ahead from 1 vendor at Italian Fest 2026, Oct 24–26 in Collinsville, IL. Pickup with FairSynq.', '1 vendor, pickup only')
eq(fairDescription({ ...base, vendorCount: 0 }), 'Order ahead at Italian Fest 2026, Oct 24–26 in Collinsville, IL. Pickup or delivery with FairSynq.', '0 vendors → no count')
eq(fulfillmentPhrase({ boothPickupEnabled: true, curbsideEnabled: true, homeDeliveryEnabled: true }), 'Pickup, curbside or delivery', 'all three')
eq(fulfillmentPhrase({ boothPickupEnabled: false, curbsideEnabled: true, homeDeliveryEnabled: false }), 'Curbside', 'curbside only')
eq(fulfillmentPhrase({ boothPickupEnabled: false, curbsideEnabled: false, homeDeliveryEnabled: false }), null, 'nothing enabled → no phrase')
eq(fulfillmentPhrase(null), 'Pickup', 'no config row → the schema default, booth pickup')
assert(!/delivery/i.test(fairDescription({ ...base, fulfillment: null })), 'never says delivery when the fair has no delivery')

console.log('\n[6] schema.org Event')
const ld = fairEventJsonLd(base) as Record<string, any>
eq([ld['@type'], ld.name, ld.url], ['Event', 'Italian Fest 2026', `${SITE_URL}/fair/italian-fest`], 'type, name, url')
eq([ld.startDate, ld.endDate], ['2026-10-24T11:00:00-05:00', '2026-10-26T22:00:00-05:00'], 'start/end with the fair\'s clock and offset (CDT)')
eq(fairDateTime('2026-12-05T00:00:00.000Z', '10:30', 'America/Chicago'), '2026-12-05T10:30:00-06:00', 'winter offset (CST)')
eq(fairDateTime('2026-10-24T00:00:00.000Z', null, 'America/Chicago'), '2026-10-24', 'no daily time → date only')
eq(fairDateTime('2026-10-24T00:00:00.000Z', '11:00', 'Not/AZone'), '2026-10-24', 'unknown zone → date only, never a wrong offset')
eq(ld.location, { '@type': 'Place', name: 'Collinsville, IL', address: { '@type': 'PostalAddress', streetAddress: '125 W Main St', addressLocality: 'Collinsville', addressRegion: 'IL', postalCode: '62234', addressCountry: 'US' } }, 'location from the stored address')
eq(ld.image, [`${SITE_URL}/fair/italian-fest/opengraph-image`], 'image = the fair\'s share image')
eq(ld.organizer, { '@type': 'Organization', name: 'Collinsville Chamber' }, 'organizer = the fair\'s organizer')
eq((fairEventJsonLd({ ...base, organizerName: null }) as any).organizer.name, 'FairSynq', 'no organizer → FairSynq')
eq(ld.offers?.price, 0, 'free admission → offers price 0')
assert(!('offers' in fairEventJsonLd({ ...base, admissionFree: false })), 'paid admission → no offers (no stored price to state)')
assert(!('location' in fairEventJsonLd({ ...base, venueAddress: '  ' })), 'no address → no location, not a guess')
assert(ld.eventStatus === 'https://schema.org/EventScheduled' && ld.eventAttendanceMode === 'https://schema.org/OfflineEventAttendanceMode', 'scheduled, in person')
const evil = jsonLdScript(fairEventJsonLd({ ...base, name: 'Fest</script><script>alert(1)</script>' }))
assert(!evil.includes('</script') && JSON.parse(evil).name === 'Fest</script><script>alert(1)</script>', 'a fair name cannot close the script tag, and still round-trips')

console.log('\n[7] wiring')
const seoSrc = readFileSync('lib/seo.ts', 'utf8')
for (const k of ['VERCEL_ENV', 'VERCEL_PROJECT_PRODUCTION_URL', 'SEO_INDEX_FAIRS']) assert(seoSrc.includes(`process.env.${k}`), `lib/seo reads process.env.${k} literally`)
const root = strip(readFileSync('app/layout.tsx', 'utf8'))
assert(/metadataBase:\s*new URL\(SITE_URL\)/.test(root) && /robots:\s*robotsFor\('public'\)/.test(root), 'root layout: metadataBase = SITE_URL, robots = robotsFor(public)')
assert(!/alternates/.test(root), 'root layout sets no canonical (it would leak to every page)')
const fairLayout = strip(readFileSync('app/fair/[fairSlug]/layout.tsx', 'utf8'))
assert(/robots:\s*robotsFor\('fair'\)/.test(fairLayout) && /canonical:\s*`\/fair\/\$\{fair\.slug\}`/.test(fairLayout), 'fair layout: robotsFor(fair) + canonical on the fair')

const walk = (d: string): string[] => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const appFiles = walk('app').filter(f => /\.(tsx?|mts)$/.test(f))
const robotsSetters = appFiles.filter(f => /\brobots\s*:/.test(strip(readFileSync(f, 'utf8'))))
const raw = robotsSetters.filter(f => !/\brobots\s*:\s*robotsFor\(/.test(strip(readFileSync(f, 'utf8'))))
assert(robotsSetters.length >= 4 && raw.length === 0, `every robots setting goes through robotsFor (${robotsSetters.length} files)${raw.length ? `: raw in ${raw.join(', ')}` : ''}`)

const F = 'app/fair/[fairSlug]'
for (const d of ['cart', 'checkout', 'orders', 'order'])
  assert(/export const metadata = privateFairPageMetadata/.test(readFileSync(`${F}/${d}/layout.tsx`, 'utf8')), `${d}: always noindex`)
const sub = readFileSync(`${F}/_components/subpage-metadata.ts`, 'utf8')
assert(/privateFairPageMetadata: Metadata = \{ robots: robotsFor\('private'\), alternates: \{ canonical: null \} \}/.test(sub) && !/robots/.test(sub.slice(sub.indexOf('export async function'), sub.indexOf('/** Cart'))),
  'public sub-pages inherit the fair layout\'s robots; private ones are robotsFor(private)')
// Every page under the fair has a layout between it and the fair layout that decides its canonical
// or makes it private, so a new sub-page can't silently inherit the fair home's canonical.
const fairPages = walk(F).filter(f => f.endsWith('/page.tsx') && f !== `${F}/page.tsx`)
const uncovered = fairPages.filter(p => {
  const top = p.slice(F.length + 1).split('/')[0]
  const lay = top === 'vendor' ? `${F}/vendor/[vendorSlug]/layout.tsx` : `${F}/${top}/layout.tsx`
  return !existsSync(lay) || !/fairSubpageMetadata|privateFairPageMetadata/.test(readFileSync(lay, 'utf8'))
})
assert(fairPages.length >= 9 && uncovered.length === 0, `all ${fairPages.length} fair sub-pages have a canonical or private layout${uncovered.length ? `: missing ${uncovered.join(', ')}` : ''}`)
const fairPage = strip(readFileSync(`${F}/page.tsx`, 'utf8'))
assert(!/'use client'/.test(fairPage) && /application\/ld\+json/.test(fairPage) && /jsonLdScript\(fairEventJsonLd\(fair\)\)/.test(fairPage), 'fair home renders the Event JSON-LD on the server')
assert(/robotsFile\(\)/.test(readFileSync('app/robots.ts', 'utf8')) && /sitemapEntries\(fairs\)/.test(readFileSync('app/sitemap.ts', 'utf8')) && /if \(fairsIndexable\(\)\)/.test(readFileSync('app/sitemap.ts', 'utf8')),
  'robots.ts and sitemap.ts use lib/seo; the sitemap only reads fairs when they are indexable')
// The JSON-LD's offers (free admission) must match what the page shows; it used to render a
// hardcoded "Paid entry" on first paint.
const fairsSrc = strip(readFileSync('lib/fairs.ts', 'utf8'))
assert(/admissionFree: raw\.admissionFree,/.test(fairsSrc) && !/admissionFree: false/.test(fairsSrc), 'the fair page shows the stored admission, the same value the JSON-LD uses')
assert(existsSync('app/opengraph-image.tsx') && existsSync(`${F}/opengraph-image.tsx`), 'site and per-fair share images exist')
for (const f of ['bebas-neue-latin-400-normal.woff', 'inter-latin-400-normal.woff', 'inter-latin-600-normal.woff', 'BebasNeue-OFL.txt', 'Inter-OFL.txt'])
  assert(existsSync(`assets/fonts/${f}`), `assets/fonts/${f}`)
assert(/SIL Open Font License/.test(readFileSync('assets/fonts/BebasNeue-OFL.txt', 'utf8')) && /SIL Open Font License/.test(readFileSync('assets/fonts/Inter-OFL.txt', 'utf8')), 'both licence files are the OFL')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} seo: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
