/**
 * /organizers "FOR FAIRS & FESTIVALS" PAGE (C-15, BATCH-1 §21 Q2 to Q5) — static checks, no DB.
 *
 *   [0] scanner controls: the proxy-pattern reader catches a planted path and the old pattern
 *   [1] proxy: /organizers is public; the organizer portal (/organizer, /organizer/…) is still gated
 *   [2] ?mode=apply (Q2): opens sign-up; no param = sign-in; admin ignores it; other values ignored;
 *       the tabs switch both ways (2026-11-17: tabs replaced the toggle links, sign-in redesign).
 *       Plus RoleAuthCard's wiring of the same function.
 *   [3] page copy (Q5): the approved text word for word, every field rendered, in order
 *   [4] homepage v2 (2026-11-23): "I run an event" tile, Organizers tab button and "Bring FairSynq to
 *       your event" path → /organizer/login?mode=apply; organizer copy exact; header chooser
 *       "Organizer sign-in" → /organizer/login; no homepage link to /organizers
 *   [4b] /organizers is parked: a temporary redirect to /organizer/login; nothing in the app links to it
 *   [5] /organizer/login: the old blurb is removed (sign-in redesign Q7b); no "approve vendors"
 *   [6] title, noindex, not in the sitemap (even with indexing on)
 *
 * Run:  npx tsx scripts/organizers-page-test.ts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const stripLineComments = (s: string) => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
import { initialAuthMode } from '../lib/auth-mode'
import { SIGNIN_COPY } from '../lib/signin-copy'
import { ORGANIZERS_PAGE, ORGANIZERS_PATH, ORGANIZER_APPLY_PATH } from '../lib/organizer-copy'
import { robotsFor, sitemapEntries, SITE_URL } from '../lib/seo'
import { AUDIENCES, AUDIENCE_HREF, HOME_TILES, PICK_YOUR_PATH, HOME_HEADER } from '../lib/homepage-copy'

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
const card = readFileSync('app/_components/RoleAuthCard.tsx', 'utf8')
assert(card.includes('useState<AuthMode>(() => initialAuthMode(searchParams.get(AUTH_MODE_PARAM), allowSignUp))'),
  'RoleAuthCard opens on initialAuthMode(?mode, allowSignUp)')
// Updated 2026-11-17 (sign-in redesign Q5): two tabs replace the two toggle links. Each tab sets its
// own mode, so the tabs switch both ways; the old toggle function is gone.
assert(/\(\["sign-in", "sign-up"\] as const\)\.map\(\(m\) =>/.test(card) && /onClick=\{\(\) => setMode\(m\)\}/.test(card)
  && !/toggleAuthMode/.test(card), 'two tabs, each setting its own mode (switches both ways)')
assert(/\{allowSignUp && \(\s*<div role="tablist"/.test(card), 'the tabs only show where sign-up is allowed')
assert(!SIGNIN_COPY.admin.signUpTab && card.includes('const allowSignUp = Boolean(copy.signUpTab)'), 'admin has no sign-up (no sign-up tab in its copy)')

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
    'Review price increases and new items before they go live.',
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
// Homepage v2 (2026-11-23, design approved 2026-11-22) replaced the "Host an Event" card and the old
// footer. Each old check has a replacement: the organizer tile, tab button and path link go to
// organizer sign-up; the organizer copy is exact; organizer sign-in moved to the header chooser.
console.log('\n[4] homepage organizer paths and header sign-in')
const homeCopySrc = readFileSync('lib/homepage-copy.ts', 'utf8')
const landing = readFileSync('app/MarketplaceLanding.tsx', 'utf8')
const homeHeader = readFileSync('app/_components/HomeHeader.tsx', 'utf8')
const homeSections = readFileSync('app/_components/HomeAudienceSections.tsx', 'utf8')
assert(AUDIENCE_HREF.organizer === ORGANIZER_APPLY_PATH && ORGANIZER_APPLY_PATH === '/organizer/login?mode=apply'
  && /organizer: ORGANIZER_SIGNUP_PATH,/.test(homeCopySrc) && /export const ORGANIZER_SIGNUP_PATH = ORGANIZER_APPLY_PATH/.test(homeCopySrc),
  'organizer paths → /organizer/login?mode=apply')
assert(HOME_TILES.some(t => t.key === 'organizer' && t.title === 'I run an event' && t.line === 'Run it from one dashboard')
  && /HOME_TILES\.map\(\(\{ key, title, line \}\)[\s\S]{0,200}?<AudienceLink\s+key=\{key\}\s+audience=\{key\}/.test(landing),
  '"I run an event" tile ("Run it from one dashboard") links through the organizer path')
assert(AUDIENCES.organizer.cta === 'Bring FairSynq to your event' && /<AudienceLink\s+audience=\{selected\}/.test(homeSections),
  'Organizers tab button "Bring FairSynq to your event" → the organizer path')
assert(PICK_YOUR_PATH.links.some(l => l.key === 'organizer' && l.label === 'Bring FairSynq to your event') && /PICK_YOUR_PATH\.links\.map\([\s\S]{0,120}<AudienceLink[\s\S]{0,40}audience=\{key\}/.test(landing),
  '"Pick your path" "Bring FairSynq to your event" → the organizer path')
assert(initialAuthMode(new URLSearchParams(ORGANIZER_APPLY_PATH.split('?')[1]).get('mode'), true) === 'sign-up', 'that link opens the "Apply to host" tab')
assert(JSON.stringify(AUDIENCES.organizer.steps) === JSON.stringify([
  ['Create your event', "Save it as a draft and publish when you're ready."],
  ['Bring in your vendors', 'Invite them, or approve the ones who request to join.'],
  ['Watch it run', 'See orders come in booth by booth, all from one dashboard.'],
]) && JSON.stringify(AUDIENCES.organizer.faqs) === JSON.stringify([
  ['How do vendors join my event?', 'Send them your invite link, or approve vendors who request to join.'],
  ['Can I run more than one event?', 'Yes. Run several events from one account.'],
  ['Who runs curbside pickup?', "A local partner group brings its own volunteers, so you don't need extra staff."],
]), 'the organizer steps and FAQs are the approved text, word for word')
assert(HOME_HEADER.signInChoices.some(c => c.label === 'Organizer sign-in' && c.href === '/organizer/login') && /HOME_HEADER\.signInChoices\.map\(/.test(homeHeader),
  'header sign-in chooser "Organizer sign-in" → /organizer/login')
for (const [name, s] of [['lib/homepage-copy.ts', homeCopySrc], ['app/MarketplaceLanding.tsx', landing], ['app/_components/HomeHeader.tsx', homeHeader], ['app/_components/HomeAudienceSections.tsx', homeSections]] as const) {
  assert(!/ORGANIZERS_PATH|'\/organizers'|"\/organizers"|\/organizers\b/.test(stripLineComments(s)), `${name}: no link to /organizers`)
}

// ── [4b] /organizers parked ───────────────────────────────────────────────────────────────
console.log('\n[4b] /organizers redirects to /organizer/login')
const nextCfg = readFileSync('next.config.mjs', 'utf8')
assert(/\{ source: '\/organizers', destination: '\/organizer\/login', permanent: false \}/.test(nextCfg), 'a temporary (307) redirect /organizers → /organizer/login')
assert(existsSync('app/organizers/page.tsx'), 'the page code is kept, in case the client wants it back')
// No link to it anywhere a visitor can see: app/ and lib/ (the page's own files excepted).
const linkRe = /['"`(]\/organizers(?![\w/-])|ORGANIZERS_PATH/
const scan = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(d => {
  const q = join(dir, d.name); return d.isDirectory() ? scan(q) : /\.(tsx?|jsx?)$/.test(d.name) ? [q] : [] })
assert(linkRe.test("href: '/organizers'") && linkRe.test('href={ORGANIZERS_PATH}') && !linkRe.test("'/admin/organizers'") && !linkRe.test("'/api/admin/organizers'"),
  '[0] control: the link scanner finds a planted /organizers link and ignores /admin/organizers')
const linking = ['app', 'lib'].flatMap(scan)
  .filter(f => !f.startsWith('app/organizers/') && f !== 'lib/organizer-copy.ts')
  .filter(f => linkRe.test(stripLineComments(readFileSync(f, 'utf8'))))
assert(linking.length === 0, `nothing links to /organizers (found: ${linking.join(', ') || 'none'})`)

// ── [5] login blurb ───────────────────────────────────────────────────────────────────────
console.log('\n[5] /organizer/login')
// Updated 2026-11-17 (sign-in redesign Q7b): ORGANIZER_LOGIN_BLURB is removed; the page renders the
// shared shell with the organizer copy (locked in scripts/signin-copy-test.ts).
const login = readFileSync('app/organizer/login/page.tsx', 'utf8')
const orgCopy = readFileSync('lib/organizer-copy.ts', 'utf8')
assert(/<RoleAuthCard role="organizer"/.test(login) && !/blurb/.test(login) && !/ORGANIZER_LOGIN_BLURB/.test(orgCopy), 'the old blurb is gone; the page renders the organizer sign-in copy')
assert(/approve vendors/i.test('Create fairs, approve vendors, monitor') && !/approve vendors/i.test(login + JSON.stringify(SIGNIN_COPY.organizer)),
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
