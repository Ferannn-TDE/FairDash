/**
 * HOMEPAGE COPY GUARD — homepage v2 (design approved by Jordan 2026-11-22, homepage-v2-design.html).
 *
 * File name kept (scripts/verify-all.ts lists it as "homepage-stats"). Until 2026-11-23 it locked
 * the B1.7 stats card (213 orders, 23 vendors, $45 average order, FREE for vendors, "Last
 * season"). Homepage v2 removes that card, so each old check now has a replacement here:
 *
 *   [0] parser and scanner controls: the strip parser reads a planted list and finds nothing where
 *       there is none (was: the same two controls for the tile parser); every negative scanner
 *       catches a planted bad string and passes clean text
 *   [1] the three-item strip, exact and in order (was: the four stat tiles, exact)
 *   [2] the stats card is gone: no STAT_TILES, no "Last season", 213, "23 vendors", $45,
 *       "average order" or "FREE for vendors" (was: the "Last season" caption)
 *   [3] the old figures are gone: no 288, $16K, "nearly" or "first two seasons" (unchanged)
 *   [4] every design string, word for word, and each one rendered by the page
 *   [5] negative checks on every homepage file and on the rendered copy: no 10% / 15%, no sold
 *       out, no deliver/delivery words, no competitor names, no "Get Started"
 *   [6] links: every path's destination; the vendor sign-up path; header choices; no legal links
 *       until the legal pages are rewritten (Jordan, 2026-11-23)
 *
 * Run:  npx tsx scripts/homepage-stats-guard.ts
 */

import { readFileSync, existsSync } from 'node:fs'
import * as copy from '../lib/homepage-copy'
import { authDestinations } from '../lib/auth-destinations'
import { initialAuthMode } from '../lib/auth-mode'

let pass = 0, fail = 0
const assert = (ok: boolean, label: string) => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Comments may name the removed copy for the record; only code is scanned.
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')

const FILES = {
  landing: 'app/MarketplaceLanding.tsx',
  header: 'app/_components/HomeHeader.tsx',
  sections: 'app/_components/HomeAudienceSections.tsx',
  copy: 'lib/homepage-copy.ts',
  page: 'app/page.tsx',
} as const
const raw = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, readFileSync(p, 'utf8')])) as Record<keyof typeof FILES, string>
const src = Object.fromEntries(Object.entries(raw).map(([k, s]) => [k, code(s)])) as Record<keyof typeof FILES, string>
const allCode = Object.values(src).join('\n')

// Every string the page can render, collected from the copy module (values, not keys).
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach(x => strings(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out))
  return out
}
const rendered = strings(Object.values(copy)).join('\n')

function stripItems(s: string): { title: string; line: string }[] {
  const block = s.match(/export const HOME_STRIP = \[([\s\S]*?)\n\] as const/)
  if (!block) return []
  return [...block[1].matchAll(/\{\s*title:\s*'([^']*)',\s*line:\s*'([^']*)'\s*\}/g)].map(m => ({ title: m[1], line: m[2] }))
}

const PCT = /\b1[05]\s*(%|percent\b)/i
const SOLD_OUT = /\bsold[\s-]*out\b/i
const DELIVER = /\b(deliver|delivers|delivered|delivering|delivery|deliveries)\b/i
const COMPETITOR = /\b(DoorDash|Uber|Uber\s*Eats|Grubhub|Postmates|Square|Clover|Shopify|Eventbrite|Waitwhile)\b/i
const TOAST = /\bToast\b/ // capital T only: "toast" is also the app's notification word
const GET_STARTED = /get started/i
const LEGAL = /\/(vendor-agreement|refund-policy|privacy|terms)\b|Vendor Agreement|Refund policy|>\s*Privacy\s*<|>\s*Terms\s*<|'Privacy'|'Terms'/i

console.log('[0] parser and scanner controls')
const planted = `export const HOME_STRIP = [\n  { title: 'A', line: 'b c' },\n  { title: 'D', line: 'e' },\n] as const`
assert(same(stripItems(planted), [{ title: 'A', line: 'b c' }, { title: 'D', line: 'e' }]), '[0] positive control: the strip parser reads a planted list')
assert(stripItems('const OTHER = [1, 2]').length === 0, '[0] baseline: finds no strip where there is none')
for (const [re, bad, ok] of [
  [PCT, 'a 10% service fee', 'free to join'], [PCT, '15 % off', '2015 season'], [PCT, '10 percent', '100 orders'],
  [SOLD_OUT, 'Mark items sold out', 'sell more'], [SOLD_OUT, 'never sold-out', 'soldier'],
  [DELIVER, 'We deliver to you', 'homeDeliveryEnabled'], [DELIVER, 'Delivery fee', 'curbside'],
  [COMPETITOR, 'unlike DoorDash', 'door'], [COMPETITOR, 'Uber Eats', 'tuber'], [COMPETITOR, 'an Uber ride', 'Uberty'],
  [TOAST, 'switch from Toast', 'toast.error(x)'], [GET_STARTED, 'Get Started', 'Get notified'],
  [LEGAL, "href: '/privacy'", "href: '/partners'"], [LEGAL, 'Refund policy', 'refunded'],
] as const) {
  assert(re.test(bad) && !re.test(ok), `[0] ${re.source.slice(0, 28)}… catches "${bad}", passes "${ok}"`)
}

console.log('[1] three-item strip')
const wantStrip = [
  { title: 'No app to download', line: 'Customers order from their browser' },
  { title: 'No new equipment', line: 'Runs on the phone or tablet you have' },
  { title: 'No monthly fees', line: 'Free to join' },
]
const gotStrip = stripItems(raw.copy)
assert(same(gotStrip, wantStrip), `three items, exact, in order: ${gotStrip.map(t => t.title).join(' | ')}`)
assert(same(copy.HOME_STRIP, wantStrip), 'the module exports the same three items')
assert(/HOME_STRIP\.map\(/.test(src.landing), 'the page renders the strip')

console.log('[2] stats card gone')
assert(!/STAT_TILES|StatsTiles|ProofSection/.test(allCode), 'no stats tile list or stats section')
assert(!/Last season|\b213\b|23 vendors|\$45\b|average order|FREE for vendors/i.test(allCode + rendered), 'no "Last season", 213, "23 vendors", $45, "average order" or "FREE for vendors"')

console.log('[3] old figures gone')
assert(!/'288'|\b288\b|\$16K|nearly|first two seasons/i.test(allCode + rendered), 'no 288, $16K, "nearly" or "first two seasons"')

console.log('[4] design copy, word for word')
assert(same(copy.HOME_HERO, {
  eyebrow: 'LAUNCHING AT FAIRS & FESTIVALS IN 2027',
  headingLine1: 'LONG LINES ARE',
  headingLine2: 'LOST SALES.',
  subhead: 'Fairgoers order ahead and skip the line. Vendors sell more. Organizers run it all from one dashboard.',
  vendorButton: 'Vendors: sign-up is open now →',
}), 'hero: eyebrow, heading, subhead, vendor button')
assert(copy.WHO_ARE_YOU === 'WHO ARE YOU?', '"WHO ARE YOU?"')
assert(same(copy.HOME_TILES, [
  { key: 'food', title: 'I want food', line: 'Ordering opens in 2027' },
  { key: 'vendor', title: "I'm a vendor", line: 'Sell more. Free to join.' },
  { key: 'organizer', title: 'I run an event', line: 'Run it from one dashboard' },
  { key: 'group', title: "We're a group", line: 'Raise money running curbside' },
]), 'four tiles, exact, in order ("I want food" says "Ordering opens in 2027", no "Get notified" yet)')
assert(same(copy.HOW_IT_WORKS, { eyebrow: 'HOW IT WORKS', heading: 'THREE STEPS.', headingAccent: "THAT'S IT.", tabsLabel: 'Choose who you are' }), 'How it works heading')
assert(same(copy.FAQ_HEADER, { eyebrow: 'NEED HELP?', heading: 'QUESTIONS,', headingAccent: 'ANSWERED', showingFor: 'Showing answers for', pickAnother: 'Pick another above.' }), 'FAQ heading')
assert(same(copy.AUDIENCE_ORDER, ['food', 'vendor', 'organizer', 'group']), 'tab order: Fairgoers, Vendors, Organizers, Groups')
assert(same(copy.AUDIENCES, {
  food: {
    name: 'Fairgoers', cta: 'Find a Fair',
    steps: [
      ['Find your fair', 'See which fairs and festivals near you are on FairSynq.'],
      ['Order on your phone', "Browse every vendor's menu and pay ahead. No app needed."],
      ['Pick it up', "We text you when it's ready. Grab it at the booth, or curbside at select events."],
    ],
    faqs: [
      ['How do I get my food?', 'Order and pay on your phone. When the vendor marks it ready, you get a text. Pick it up at their booth, or curbside at events that offer it.'],
      ['What fees will I pay?', 'A small service fee per order. You see the full total before you pay, with no surprises.'],
      ['Can I cancel an order?', 'Yes, before the vendor accepts it, and you get a full refund.'],
    ],
  },
  vendor: {
    name: 'Vendors', cta: 'Sign up free',
    steps: [
      ['Sign up free', 'Create your account and add your menu with photos and prices.'],
      ['Join your events', 'Request to join a fair, or set up booth pickup at any event you work.'],
      ['Take orders ahead', 'Orders hit your phone or tablet. Mark them ready and the customer comes to you.'],
    ],
    faqs: [
      ['What does it cost me?', 'Free to join. No commission and no monthly fees. You only pay standard card processing on your own sales.'],
      ['How do orders reach me?', 'On your phone or tablet at the booth, with an alert for every new order.'],
      ['When do I get paid?', 'After each event, and weekly at longer fairs.'],
    ],
  },
  organizer: {
    name: 'Organizers', cta: 'Bring FairSynq to your event',
    steps: [
      ['Create your event', "Save it as a draft and publish when you're ready."],
      ['Bring in your vendors', 'Invite them, or approve the ones who request to join.'],
      ['Watch it run', 'See orders come in booth by booth, all from one dashboard.'],
    ],
    faqs: [
      ['How do vendors join my event?', 'Send them your invite link, or approve vendors who request to join.'],
      ['Can I run more than one event?', 'Yes. Run several events from one account.'],
      ['Who runs curbside pickup?', "A local partner group brings its own volunteers, so you don't need extra staff."],
    ],
  },
  group: {
    name: 'Groups', cta: 'Partner with us',
    steps: [
      ['Sign up your group', 'Tap Partner with us. We approve every group.'],
      ['Run curbside', 'Your volunteers walk orders from the booths to the curb.'],
      ['Raise money', 'Your group keeps the curbside fee plus 100% of tips.'],
    ],
    faqs: [
      ['How does our group earn?', 'You keep the curbside fee on every curbside order, plus 100% of tips.'],
      ['Who are the runners?', 'Your own volunteers. Orders go straight to their phones, first come, first served.'],
      ['What kind of groups can join?', 'Clubs, teams, service groups and other local organizations.'],
    ],
  },
}), 'all four tabs: name, button, three steps and three FAQs, exact')
assert(copy.AUDIENCES.vendor.faqs[0][1] === 'Free to join. No commission and no monthly fees. You only pay standard card processing on your own sales.',
  'the vendor cost answer, exact')
assert(copy.DEFAULT_TAB === 'vendor', 'the tabs open on Vendors until ordering opens (DEFAULT_TAB)')
assert(/useState<AudienceKey>\(DEFAULT_TAB\)/.test(src.sections), 'the tabs start on DEFAULT_TAB')
assert(copy.FOOD_PATH === '/fairs' && copy.FOOD_PATH_LABEL === 'Find a Fair', 'fairgoer paths: "Find a Fair" → /fairs until the notify sign-up exists')
assert(same(copy.PICK_YOUR_PATH, {
  heading: 'READY?', headingAccent: 'PICK YOUR PATH.',
  links: [
    { key: 'food', label: 'Find a Fair' },
    { key: 'vendor', label: 'Vendor sign-up, free' },
    { key: 'organizer', label: 'Bring FairSynq to your event' },
    { key: 'group', label: 'Partner with us' },
  ],
}), '"Ready? Pick your path": heading and four links, exact, same order as the tiles')
assert(same(copy.HOME_FOOTER, { supportEmail: 'support@fairsynq.com', questionsLead: 'Questions? Email', copyright: '© 2026 FairSynq, formerly Fair Dash' }), 'footer: support email and "© 2026 FairSynq, formerly Fair Dash"')
assert(copy.HOME_HEADER.signIn === 'Sign in', 'header button says "Sign in"')

// Each field rendered, page in design order.
for (const f of ['HOME_HERO.eyebrow', 'HOME_HERO.headingLine1', 'HOME_HERO.headingLine2', 'HOME_HERO.subhead', 'HOME_HERO.vendorButton',
  '{WHO_ARE_YOU}', 'HOME_TILES.map(', 'PICK_YOUR_PATH.heading', 'PICK_YOUR_PATH.headingAccent', 'PICK_YOUR_PATH.links.map(',
  'HOME_FOOTER.questionsLead', 'HOME_FOOTER.supportEmail', 'HOME_FOOTER.copyright']) {
  assert(src.landing.includes(f), `page renders ${f}`)
}
for (const f of ['HOW_IT_WORKS.eyebrow', 'HOW_IT_WORKS.heading', 'HOW_IT_WORKS.headingAccent', 'audience.steps.map(', 'audience.cta',
  'AUDIENCES[key].name', 'FAQ_HEADER.eyebrow', 'FAQ_HEADER.heading', 'FAQ_HEADER.headingAccent', 'FAQ_HEADER.showingFor',
  'FAQ_HEADER.pickAnother', 'audience.faqs.map(', 'AUDIENCE_ORDER.map(']) {
  assert(src.sections.includes(f), `tabs/FAQ render ${f}`)
}
for (const f of ['HOME_HEADER.signIn', 'HOME_HEADER.signInChoices.map(', 'HOME_HEADER.menu.map(', 'HOME_HEADER.menuLabel']) {
  assert(src.header.includes(f), `header renders ${f}`)
}
const order = ['<HomeHeader />', '<Hero />', '<Strip />', '<HomeAudienceSections />', '<PickYourPath />', '<HomeFooter />'].map(s => src.landing.indexOf(s))
assert(order.every(i => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]), 'sections in design order: header, hero + tiles, strip, how it works + FAQ, pick your path, footer')
assert(/grid-cols-2 lg:grid-cols-4/.test(src.landing), 'tiles: two across on phones, four across on wide screens')

console.log('[5] negative checks (code of every homepage file, and the rendered copy)')
const neg: [RegExp, string][] = [[PCT, '10% / 15%'], [SOLD_OUT, '"sold out"'], [DELIVER, 'deliver/delivery words'], [COMPETITOR, 'competitor names'], [TOAST, '"Toast"'], [GET_STARTED, '"Get Started"']]
for (const [re, what] of neg) {
  const hits = [...Object.entries(src).filter(([, s]) => re.test(s)).map(([k]) => FILES[k as keyof typeof FILES]), ...(re.test(rendered) ? ['rendered copy'] : [])]
  assert(hits.length === 0, `no ${what}${hits.length ? ` — ${hits.join(', ')}` : ''}`)
}

console.log('[6] links')
assert(same(copy.AUDIENCE_HREF, { food: '/fairs', organizer: '/organizer/login?mode=apply', group: '/partners' }), 'I want food → /fairs; I run an event → organizer sign-up; We\'re a group → /partners')
assert(initialAuthMode('apply', true) === 'sign-up', 'organizer sign-up link opens the sign-up tab')
assert(copy.VENDOR_SIGNUP_SIGNED_OUT === '/sign-in/vendor?mode=apply' && copy.VENDOR_SIGNUP_SIGNED_IN === '/onboarding?role=vendor', 'vendor sign-up: signed out → vendor sign-up tab; signed in → /onboarding?role=vendor')
assert(authDestinations('vendor', null, '/vendor').afterSignUp === '/onboarding?role=vendor', 'after vendor sign-up → /onboarding?role=vendor')
assert(/vendor: '\/become-vendor'/.test(readFileSync('app/onboarding/page.tsx', 'utf8')), '/onboarding?role=vendor → /become-vendor')
assert(/isLoaded && isSignedIn === true \? VENDOR_SIGNUP_SIGNED_IN : VENDOR_SIGNUP_SIGNED_OUT/.test(src.sections), 'the vendor link picks its path only once Clerk has loaded')
const audienceLinks = (src.landing.match(/<AudienceLink\b/g) ?? []).length
assert(audienceLinks === 3 && /audience="vendor"/.test(src.landing) && /audience=\{key\}/.test(src.landing), 'hero button, tiles and path links all go through AudienceLink')
assert(/<AudienceLink\s+audience=\{selected\}/.test(src.sections), 'each tab button goes through AudienceLink for its audience')
assert(!/<Link\b|href=/.test(src.landing.replace(/href=\{`mailto:\$\{HOME_FOOTER\.supportEmail\}`\}/, '')), 'the page has no other links besides the support email')
assert(same(copy.HOME_HEADER.signInChoices, [
  { label: 'Vendor sign-in', href: '/sign-in/vendor' },
  { label: 'Organizer sign-in', href: '/organizer/login' },
  { label: 'Fairgoer sign-in', href: '/sign-in/customer' },
]), 'sign-in chooser: Vendor first, then Organizer, then Fairgoer (no partner sign-in page exists)')
assert(!existsSync('app/sign-in/partner'), 'no partner sign-in page exists (so none is listed)')
const routes: Record<string, string> = {
  '/fairs': 'app/fairs/page.tsx', '/partners': 'app/partners/page.tsx', '/organizer/login': 'app/organizer/login/page.tsx',
  '/sign-in/vendor': 'app/sign-in/vendor/page.tsx', '/sign-in/customer': 'app/sign-in/customer/page.tsx',
  '/onboarding': 'app/onboarding/page.tsx', '/account': 'app/account/page.tsx', '/contact': 'app/contact/page.tsx',
}
const hrefs = [...Object.values(copy.AUDIENCE_HREF), copy.VENDOR_SIGNUP_SIGNED_OUT, copy.VENDOR_SIGNUP_SIGNED_IN,
  ...copy.HOME_HEADER.signInChoices.map(c => c.href), copy.HOME_HEADER.account.href, ...copy.HOME_HEADER.menu.map(m => m.href)]
for (const h of hrefs.filter(h => !h.startsWith('#'))) {
  const path = h.split('?')[0]
  assert(!!routes[path] && existsSync(routes[path]), `${h} goes to a page that exists`)
}
for (const h of copy.HOME_HEADER.menu.map(m => m.href).filter(h => h.startsWith('#'))) {
  const id = h.slice(1)
  assert(new RegExp(`id="${id}"`).test(src.landing + src.sections), `menu anchor ${h} exists on the page`)
}
const legalHits = Object.entries(src).filter(([, s]) => LEGAL.test(s)).map(([k]) => FILES[k as keyof typeof FILES])
assert(legalHits.length === 0 && !LEGAL.test(rendered), `no legal links on the homepage yet (Vendor Agreement, Privacy, Terms, Refund policy)${legalHits.length ? ` — ${legalHits.join(', ')}` : ''}`)

console.log(`\n${fail === 0 ? '✅' : '❌'} homepage copy guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
