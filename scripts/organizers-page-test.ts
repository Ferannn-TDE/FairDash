/**
 * /organizers "FOR FAIRS & FESTIVALS" PAGE (C-15, BATCH-1 §21 Q2 to Q5) — static checks, no DB.
 *
 *   [0] scanner controls: the proxy-pattern reader catches a planted path and the old pattern
 *   [1] proxy: /organizers is public; the organizer portal (/organizer, /organizer/…) is still gated
 *   [2] ?mode=apply (Q2): opens sign-up; no param = sign-in; admin ignores it; other values ignored;
 *       the toggle works both ways. Plus RoleAuthCard's wiring of the same function.
 *   [3] page copy (Q5): the approved text word for word, every field rendered, in order
 *   [4] homepage (Q3): Host an Event card → /organizers "Learn more", rest unchanged; footer
 *       "Organizer sign-in" still → /organizer/login; no footer link to /organizers
 *   [5] /organizer/login blurb: "see and manage the vendors at your fair", no "approve vendors"
 *   [6] title, noindex, not in the sitemap (even with indexing on)
 *
 * Run:  npx tsx scripts/organizers-page-test.ts
 */
import { readFileSync } from 'node:fs'
import { initialAuthMode, toggleAuthMode } from '../lib/auth-mode'
import { ORGANIZERS_PAGE, ORGANIZERS_PATH, ORGANIZER_LOGIN_BLURB } from '../lib/organizer-copy'
import { robotsFor, sitemapEntries, SITE_URL } from '../lib/seo'

let pass = 0, fail = 0
const assert = (ok: boolean, label: string) => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

// ── [0]/[1] proxy ─────────────────────────────────────────────────────────────────────────
console.log('[0] scanner controls')
const proxy = readFileSync('proxy.ts', 'utf8')
const start = proxy.indexOf('isProtectedRoute = createRouteMatcher([')
const block = proxy.slice(start, proxy.indexOf('])', start))
const patterns = [...block.matchAll(/^\s*'([^']+)',/gm)].map(m => m[1])
const toRe = (p: string) => new RegExp('^' + p.replace(/\(\.\*\)/g, '.*') + '$')
const isProtected = (path: string) => patterns.some(p => toRe(p).test(path))
assert(start > 0 && patterns.length >= 8, `[0] read ${patterns.length} protected patterns from proxy.ts`)
assert(isProtected('/admin/settings'), '[0] positive control: the reader sees a gated path (/admin/settings)')
assert(!isProtected('/partners'), '[0] baseline: a public page (/partners) is not gated')
assert(toRe('/organizer(.*)').test('/organizers'), '[0] positive control: the old pattern /organizer(.*) WOULD have gated /organizers')

console.log('\n[1] proxy')
assert(!isProtected('/organizers'), '/organizers is public')
assert(isProtected('/organizer') && isProtected('/organizer/fairs') && isProtected('/organizer/fairs/x/vendors'),
  'the organizer portal (/organizer, /organizer/…) is still gated')
assert(!patterns.includes('/organizer(.*)'), 'the broad /organizer(.*) pattern is gone')
assert(/'\/organizer\/login',/.test(proxy.slice(proxy.indexOf('isAuthPage = createRouteMatcher(['))), '/organizer/login is still an auth page (no ping-pong)')

// ── [2] ?mode=apply ───────────────────────────────────────────────────────────────────────
console.log('\n[2] ?mode=apply')
assert(initialAuthMode('apply', true) === 'sign-up', '?mode=apply opens on sign-up')
assert(initialAuthMode(null, true) === 'sign-in', 'no parameter opens on sign-in')
assert(initialAuthMode('apply', false) === 'sign-in', 'admin (allowSignUp=false) ignores it')
assert(['', 'Apply', 'signup', 'sign-up', 'apply ', 'login'].every(v => initialAuthMode(v, true) === 'sign-in'), 'any other value opens on sign-in')
assert(toggleAuthMode('sign-in') === 'sign-up' && toggleAuthMode('sign-up') === 'sign-in'
  && toggleAuthMode(toggleAuthMode(initialAuthMode('apply', true))) === 'sign-up', 'the toggle switches both ways')
const card = readFileSync('app/_components/RoleAuthCard.tsx', 'utf8')
assert(card.includes('useState<AuthMode>(() => initialAuthMode(searchParams.get(AUTH_MODE_PARAM), allowSignUp))'),
  'RoleAuthCard opens on initialAuthMode(?mode, allowSignUp)')
assert((card.match(/onClick=\{\(\) => setMode\(toggleAuthMode\)\}/g) ?? []).length === 2 && !/setMode\("sign-(in|up)"\)/.test(card),
  'both toggle links use toggleAuthMode')
assert(/\{allowSignUp && \(/.test(card), 'the toggle only shows where sign-up is allowed')
const admin = readFileSync('app/admin/login/page.tsx', 'utf8')
assert(/allowSignUp=\{false\}/.test(admin), 'admin login passes allowSignUp={false}')

// ── [3] copy ──────────────────────────────────────────────────────────────────────────────
console.log('\n[3] page copy (approved 2026-11-14)')
const APPROVED = {
  title: 'For Fairs & Festivals — FairSynq',
  eyebrow: 'FOR FAIRS & FESTIVALS',
  heading: 'Shorter lines. Busier booths.',
  intro: "FairSynq lets fairgoers order from your food vendors on their own phones, then pick up at the booth when it's ready. You run your fair from one dashboard.",
  primaryButton: { label: 'Get started', href: '/organizer/login?mode=apply' },
  secondaryButton: { label: 'Already hosting? Sign in', href: '/organizer/login' },
  canDo: { heading: 'What you can do', points: [
    "Set up your fair. Name, dates, venue, hours and accent color. Save it as a draft, then publish when it's ready.",
    'See and manage your vendors. Booth details, menu and required documents. Pause or reactivate a vendor.',
    'Review menu changes before they go live.',
    'Watch orders as they come in, booth by booth, with sales for the day.',
    "Handle customer issues, including refunding an order or one vendor's part.",
    'Run several fairs from one account.',
  ] },
  noInstall: { heading: 'Nothing to install', points: [
    "Fairgoers order on your fair's page. No app to download.",
    'Vendors use their own phone or tablet.',
    'Booth pickup at every fair, and we can set up curbside for yours.',
  ] },
  steps: { heading: 'How to get started', points: [
    'Create your organizer account.',
    'FairSynq reviews and approves it.',
    'Create your fair and publish it.',
    'We give you a sign-up link for your vendors, and FairSynq reviews each vendor.',
  ] },
}
assert(JSON.stringify(ORGANIZERS_PAGE) === JSON.stringify(APPROVED), 'lib/organizer-copy.ts is the approved text, word for word')
assert(JSON.stringify({ ...APPROVED, heading: 'x' }) !== JSON.stringify(APPROVED), '[0] positive control: a one-field change is detected')
assert(ORGANIZERS_PATH === '/organizers', 'the page lives at /organizers')
const page = readFileSync('app/organizers/page.tsx', 'utf8')
const order = ['{P.eyebrow}', '{P.heading}', '{P.intro}', '{P.primaryButton.label}', '{P.secondaryButton.label}', '<OrganizerVideoSlot />',
  'P.canDo.heading', 'P.noInstall.heading', '{P.steps.heading}']
const at = order.map(s => page.indexOf(s))
assert(at.every(i => i > 0), 'every field is rendered (eyebrow, heading, intro, both buttons, video, three sections)')
assert(at.every((i, k) => k === 0 || i > at[k - 1]), 'in the approved order')
assert(/href=\{P\.primaryButton\.href\}/.test(page) && /href=\{P\.secondaryButton\.href\}/.test(page), 'both buttons use the approved links')
assert(/<ol[\s\S]{0,80}P\.steps\.points\.map/.test(page), 'the steps are a numbered list')
assert(!/contact|mailto|support@/i.test(page), 'no contact line (waits for C-20)')

// ── [4] homepage ──────────────────────────────────────────────────────────────────────────
console.log('\n[4] homepage card and footer')
const landing = readFileSync('app/MarketplaceLanding.tsx', 'utf8')
const host = landing.slice(landing.indexOf("title: 'Host an Event'"), landing.indexOf('},', landing.indexOf("title: 'Host an Event'")))
assert(host.length > 0 && /href: ORGANIZERS_PATH,/.test(host) && /cta: 'Learn more',/.test(host), 'Host an Event → /organizers, button "Learn more"')
assert(host.includes("desc: 'Run your fair end to end from one dashboard.'")
  && host.includes(`"Save your fair as a draft and publish when it's ready",`)
  && host.includes("'See and manage the vendors at your fair',")
  && host.includes("'Watch orders as they come in, booth by booth',")
  && host.includes("'Run several fairs from one account',"), 'title, description and the four points are unchanged')
const footer = landing.slice(landing.indexOf('<footer'))
assert(landing.indexOf('<footer') > 0 && /<Link href="\/organizer\/login"[^>]*>Organizer sign-in<\/Link>/.test(footer), 'footer "Organizer sign-in" still → /organizer/login')
assert(!/\/organizers|ORGANIZERS_PATH/.test(footer), 'no footer link to /organizers')
assert((landing.match(/ORGANIZERS_PATH/g) ?? []).length === 2, 'ORGANIZERS_PATH is used once on the page (import + the card)')

// ── [5] login blurb ───────────────────────────────────────────────────────────────────────
console.log('\n[5] /organizer/login blurb')
assert(ORGANIZER_LOGIN_BLURB === 'Create fairs, see and manage the vendors at your fair, monitor orders live, and run your event end to end.',
  'the blurb is the corrected text')
const login = readFileSync('app/organizer/login/page.tsx', 'utf8')
assert(/blurb=\{ORGANIZER_LOGIN_BLURB\}/.test(login), '/organizer/login renders it')
assert(/approve vendors/i.test('Create fairs, approve vendors, monitor') && !/approve vendors/i.test(login + ORGANIZER_LOGIN_BLURB),
  'no "approve vendors" (scanner positive control included)')

// ── [6] SEO ───────────────────────────────────────────────────────────────────────────────
console.log('\n[6] title, noindex, sitemap')
const live = { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'www.fairsynq.com', SEO_INDEX_FAIRS: '1' }
assert(robotsFor('public', live).index === true, '[0] positive control: a public page IS indexable on production')
assert(/robots: robotsFor\('private'\)/.test(page) && robotsFor('private', live).index === false, '/organizers is noindex, even on production')
assert(/title: ORGANIZERS_PAGE\.title/.test(page), 'the page title is "For Fairs & Festivals — FairSynq"')
const entries = sitemapEntries([], live)
assert(entries.some(e => e.url === `${SITE_URL}/fairs`), '[0] positive control: the sitemap lists /fairs with indexing on')
assert(!entries.some(e => e.url.includes('/organizers')) && !/organizers/.test(readFileSync('app/sitemap.ts', 'utf8')), '/organizers is not in the sitemap')

console.log(`\n${fail === 0 ? '✅' : '❌'} organizers page: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
