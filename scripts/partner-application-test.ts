/**
 * PARTNER ORGANIZATION APPLICATION (Batch 1 item 7: B1.8 + B1.11) — real route, test DB.
 *
 *   [1] Validation (shared client/server module): every required field, state codes, "Other"
 *       description, length caps — each refusal with a valid control
 *   [2] POST /api/partners/apply writes exactly one PENDING row, normalised, with the IP
 *   [3] Duplicate pending email → the "already being reviewed" message, nothing written; a rejected one doesn't block
 *   [4] Honeypot → the same success, nothing written
 *   [5] Rate limit: 3 per IP per hour → the 4th is 429 (fake limiter, real route)
 *   [6] Copy and wiring: the client's text verbatim on the card and /partners, top link, footer,
 *       /become-driver → /partners, runner sign-in untouched, the admin pending count
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/partner-application-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'

const prisma = testPrisma()
const MAIL = '@pt.local'
const rand = () => Math.random().toString(36).slice(2, 8)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
const post = (body: unknown, ip = `10.0.0.${Math.floor(Math.random() * 250)}`) => new NextRequest('http://localhost/api/partners/apply', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body),
})

async function cleanup() { await prisma.partnerOrganization.deleteMany({ where: { contactEmail: { endsWith: MAIL } } }) }

async function main() {
  await cleanup()
  const v = await import('../lib/partner-application')
  const VALID = {
    name: 'St. Mary PTA', groupType: 'school', contactName: 'Pat Lee', email: `Pat.Lee-${rand()}${MAIL}`.replace('@', '@'),
    phone: '(618) 555-0100', city: 'Edwardsville', state: 'il', interests: 'Italian Fest', staffHours: 'Saturdays 10–4', note: '',
    agreedToTerms: true, // the required Terms + Privacy box (sign-up-fixes commit 4)
  }

  // ── [1] validation ─────────────────────────────────────────────────────────────────────
  console.log('\n[1] Validation')
  assert(Object.keys(v.validatePartnerApplication(VALID)).length === 0, '[0] control: a complete application has no errors')
  const REQUIRED: Array<[string, string]> = [['name', 'name'], ['groupType', 'groupType'], ['contactName', 'contactName'], ['email', 'email'], ['phone', 'phone'], ['city', 'city'], ['state', 'state']]
  for (const [field, key] of REQUIRED) {
    const e = v.validatePartnerApplication({ ...VALID, [field]: '   ' })
    assert(typeof e[key] === 'string', `missing ${field} → error on ${key}`)
  }
  assert(!!v.validatePartnerApplication({ ...VALID, state: 'ZZ' }).state, 'an unknown state code → error')
  assert(!v.validatePartnerApplication({ ...VALID, state: 'dc' }).state, '[0] control: a real code in lower case (dc) is accepted')
  assert(!!v.validatePartnerApplication({ ...VALID, groupType: 'cult' }).groupType, 'an unlisted group type → error')
  assert(!!v.validatePartnerApplication({ ...VALID, groupType: 'other' }).groupTypeOther, '"Other" without a description → error')
  assert(!v.validatePartnerApplication({ ...VALID, groupType: 'other', groupTypeOther: 'Scout troop' }).groupTypeOther, '[0] control: "Other" with a description is fine')
  assert(!!v.validatePartnerApplication({ ...VALID, email: 'nope' }).email && !!v.validatePartnerApplication({ ...VALID, phone: '12' }).phone, 'bad email / phone → errors (US phone rule)')
  assert(!!v.validatePartnerApplication({ ...VALID, note: 'x'.repeat(2001) }).note, 'a note over 2,000 characters → error')
  assert(Object.keys(v.validatePartnerApplication({ ...VALID, interests: '', staffHours: '', note: '' })).length === 0, '[0] control: the optional fields can be empty')
  assert(v.US_STATES.length === 51, 'the state dropdown has 50 states + DC')

  // ── [2] a real application ─────────────────────────────────────────────────────────────
  console.log('\n[2] POST /api/partners/apply')
  // The limiter talks to the test Upstash container, whose counts persist between runs; a fixed IP
  // used by earlier runs in the same hour would hit 429 here. Sections 2–4 run with an always-allow
  // limiter; section 5 swaps in a counting one. The route's own limit check stays real code.
  const rl = await import('../lib/ratelimit')
  const allowAll = { limit: async () => ({ success: true, limit: 3, remaining: 3, reset: Date.now() + 3600e3 }) }
  rl.__setStateForTest({ type: 'ready', limiters: new Proxy({}, { get: () => allowAll }) as any })
  const { POST } = await import('../app/api/partners/apply/route')
  const call = async (body: unknown, ip?: string) => { const r = await POST(post(body, ip)); return { status: r.status, body: (await r.json()) as any } }
  const count = () => prisma.partnerOrganization.count({ where: { contactEmail: { endsWith: MAIL } } })
  const before = await count()
  const ok = await call(VALID, '203.0.113.7')
  assert(ok.status === 201 && ok.body.data?.message === v.PARTNER_APPLY_SUCCESS, `valid → 201 with the success message (got ${ok.status})`)
  assert((await count()) === before + 1, 'exactly one row written')
  const row = await prisma.partnerOrganization.findFirst({ where: { contactEmail: VALID.email.toLowerCase() } })
  assert(row?.approvalStatus === 'PENDING' && row.state === 'IL' && row.contactEmail === VALID.email.toLowerCase() && row.requestIp === '203.0.113.7' && row.note === null,
    'the row is PENDING, normalised (state upper-cased, email lower-cased, empty note → null), with the IP')
  const bad = await call({ ...VALID, email: `other-${rand()}${MAIL}`, state: '' })
  assert(bad.status === 400 && typeof bad.body.error?.details?.fieldErrors?.state === 'string' && (await count()) === before + 1, 'invalid → 400 with field errors, nothing written')

  // ── [3] duplicates ─────────────────────────────────────────────────────────────────────
  console.log('\n[3] A second application from the same email')
  const dup = await call({ ...VALID, email: VALID.email.toUpperCase(), name: 'Different name' })
  assert(dup.status === 200 && dup.body.data?.message === v.PARTNER_APPLY_DUPLICATE && dup.body.data?.duplicate === true, 'duplicate pending email (any case) → the "already being reviewed" message')
  assert(v.PARTNER_APPLY_DUPLICATE === "We already have an application from this email, and it's being reviewed. We'll be in touch soon, so there's no need to apply again.", 'the duplicate message is the agreed wording, verbatim')
  assert((await count()) === before + 1, 'and nothing was written')
  await prisma.partnerOrganization.update({ where: { id: row!.id }, data: { approvalStatus: 'REJECTED' } })
  const again = await call(VALID)
  assert(again.status === 201 && (await count()) === before + 2, '[0] control: once the earlier one is rejected, a new application is stored')

  // ── [4] honeypot ───────────────────────────────────────────────────────────────────────
  console.log('\n[4] Honeypot')
  const bot = await call({ ...VALID, email: `bot-${rand()}${MAIL}`, [v.HONEYPOT_FIELD]: 'http://spam.example' })
  assert(bot.status === 200 && bot.body.data?.message === v.PARTNER_APPLY_SUCCESS, 'honeypot filled → the same success message')
  assert((await count()) === before + 2, 'and nothing was written')

  // ── [5] rate limit ─────────────────────────────────────────────────────────────────────
  console.log('\n[5] Rate limit: 3 per IP per hour')
  assert(rl.RATE_LIMITS.partnerApply.requests === 3 && rl.RATE_LIMITS.partnerApply.window === '1 h', 'policy is 3 per 1 h')
  const hits = new Map<string, number>()
  const fakeLimiter = { limit: async (key: string) => { const n = (hits.get(key) ?? 0) + 1; hits.set(key, n); return { success: n <= 3, limit: 3, remaining: Math.max(0, 3 - n), reset: Date.now() + 3600e3 } } }
  rl.__setStateForTest({ type: 'ready', limiters: new Proxy({}, { get: () => fakeLimiter }) as any })
  const statuses: number[] = []
  for (let i = 0; i < 4; i++) statuses.push((await call({ ...VALID, email: `rl-${i}-${rand()}${MAIL}` }, '198.51.100.9')).status)
  assert(statuses.slice(0, 3).every(s => s === 201), `[0] control: the first 3 from one IP are accepted (${statuses.slice(0, 3).join(',')})`)
  assert(statuses[3] === 429, `the 4th from the same IP → 429 (got ${statuses[3]})`)
  assert((await call({ ...VALID, email: `rl-other-${rand()}${MAIL}` }, '198.51.100.10')).status === 201, 'a different IP is unaffected')
  rl.__resetForTest()

  // ── [6] copy and wiring ────────────────────────────────────────────────────────────────
  console.log('\n[6] The client\'s copy and the wiring')
  const copy = readFileSync('lib/partner-copy.ts', 'utf8')
  const EXACT = [
    "lead: 'Organizations:', action: 'Partner with us'",
    "heading: 'For Partner Organizations'",
    "text: 'Raise money for your group by running curbside pickup at fairs and festivals.'",
    "'Volunteers walk orders from booths to the curb'",
    "'Your group keeps the curbside fee plus 100% of tips'",
    `"Orders go straight to volunteers' phones, first come, first served"`,
    `"Pick the hours you can staff, and your group's name goes on the curbside signs"`,
    "button: 'Partner with us'",
  ]
  for (const s of EXACT) assert(copy.includes(s), `client copy verbatim: ${s.slice(0, 60)}`)
  // Homepage v2 (2026-11-23, design approved 2026-11-22): the partner card became the "We're a
  // group" tile with the design's wording; the PARTNER_CARD copy is still checked on /partners below.
  const landing = readFileSync('app/MarketplaceLanding.tsx', 'utf8')
  const homeHeader = readFileSync('app/_components/HomeHeader.tsx', 'utf8')
  const signInChooser = readFileSync('app/_components/SignInChooser.tsx', 'utf8')
  const homeSections = readFileSync('app/_components/HomeAudienceSections.tsx', 'utf8')
  const homeCopySrc = readFileSync('lib/homepage-copy.ts', 'utf8')
  const homeAll = [landing, homeHeader, signInChooser, homeSections, homeCopySrc].join('\n')
  const home = await import('../lib/homepage-copy')
  const { PARTNERS_PATH } = await import('../lib/partner-copy')
  assert(PARTNERS_PATH === '/partners', '[0] PARTNERS_PATH is /partners (the checks below compare against it)')
  assert(home.AUDIENCE_HREF.group === PARTNERS_PATH && /export const GROUP_PATH = PARTNERS_PATH/.test(homeCopySrc) && /group: GROUP_PATH,/.test(homeCopySrc),
    'the homepage group path links to /partners')
  assert(home.HOME_TILES.some(t => t.key === 'group' && t.title === "We're a group" && t.line === 'Raise money running curbside')
    && /HOME_TILES\.map\(\(\{ key, title, line \}\)[\s\S]{0,200}?<AudienceLink\s+key=\{key\}\s+audience=\{key\}/.test(landing),
    '"We\'re a group" tile ("Raise money running curbside") → /partners')
  assert(home.AUDIENCES.group.cta === 'Partner with us' && /<AudienceLink\s+audience=\{selected\}/.test(homeSections), 'Groups tab button "Partner with us" → /partners')
  assert(!/Deliver with FairSynq|cta: 'Runner sign-in'|Runner sign-in/.test(homeAll), 'the runner card is gone, and no "Runner sign-in" anywhere on the homepage')
  const navbar = readFileSync('app/_components/MarketplaceNavbar.tsx', 'utf8')
  assert(!/PARTNER_TOP_LINK/.test(homeAll), 'the top link is not on the homepage (hero, header or menu)')
  // Code only: comments may name /partners (HomeHeader's top comment lists the pages that keep the
  // shared navbar). Block comments (incl. JSX {/* */}) and whole-line // comments are removed first.
  const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
  const PARTNER_LINK = /PARTNERS_PATH|GROUP_PATH|\/partners/
  const headerHasPartnerLink = (s: string) => PARTNER_LINK.test(codeOnly(s))
  assert(headerHasPartnerLink(`<nav>\n  <Link href="/partners">Partner with us</Link>\n</nav>`),
    '[0] positive control: a planted /partners link in header code is caught')
  assert(!headerHasPartnerLink(`// other pages (/partners) keep the navbar\n<nav>\n  {/* see /partners */}\n  <Link href="/contact">Contact</Link>\n</nav>`),
    '[0] baseline: the same /partners text inside comments is not counted')
  assert(!home.HOME_HEADER.menu.some(m => (m.href as string) === PARTNERS_PATH) && !headerHasPartnerLink(homeHeader + '\n' + signInChooser),
    'the homepage header menu has no partner link (the top link stays removed pending the client\'s OK)')
  assert(!/PARTNER_TOP_LINK|PARTNERS_PATH|aria-label="Menu"/.test(navbar), 'the top link (and its mobile menu) is not in the navbar: removed pending the client\'s OK')
  assert(/NOT SHOWN: removed from the site on 2026-11-05 pending the client's OK/.test(copy), 'the wording stays on record, marked as not shown')
  // Was: the old footer's "Partner organizations" link. Homepage v2's footer has no links; the
  // "Pick your path" list carries the partner link instead.
  assert(home.PICK_YOUR_PATH.links.some(l => l.key === 'group' && l.label === 'Partner with us')
    && /PICK_YOUR_PATH\.links\.map\([\s\S]{0,120}<AudienceLink[\s\S]{0,40}audience=\{key\}/.test(landing),
    '"Pick your path" "Partner with us" → /partners')
  const page = readFileSync('app/partners/page.tsx', 'utf8')
  const form = readFileSync('app/partners/PartnerApplicationForm.tsx', 'utf8')
  assert(form.includes('label="Which fairs or events would your group like to work?"') && !/<select[^>]*p-interests/.test(form),
    'the optional field asks which fairs or events (free text, no fair picker: linking is Batch 2)')
  assert(/PARTNER_CARD\.heading/.test(page) && /PARTNER_CARD\.points\.map/.test(page) && (() => { const v = page.indexOf('<PartnerVideoSlot />'), f = page.search(/<PartnerApplicationForm[\s/]/); return v >= 0 && f > v })(),
    '/partners: the card copy, then the video slot, then the form')
  const nextConfig = readFileSync('next.config.mjs', 'utf8')
  assert(/source: '\/become-driver', destination: '\/partners', permanent: false/.test(nextConfig), '/become-driver redirects (temporarily) to /partners')
  assert(!/source: '\/sign-in\/runner'/.test(nextConfig), 'runner sign-in is NOT redirected (existing runners keep it)')
  const fairsRoute = readFileSync('app/api/admin/fairs/route.ts', 'utf8'), picker = readFileSync('app/admin/_components/FairPicker.tsx', 'utf8')
  assert(/countPendingApplications\(\)/.test(fairsRoute) && /requireStrictAdminAuth\(\)/.test(fairsRoute),
    'the pending count (vendors, organizers and partners since item 9) comes from the strict-admin fairs route')
  assert(/!loading && pending > 0 &&[\s\S]{0,120}href="\/admin\/approvals"/.test(picker), 'the picker shows it only once loaded, only when above zero, linking to /admin/approvals')
}

main()
  .catch((e) => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(64)}`)
    console.log(fail === 0 ? `  ${pass} passed, 0 failed` : `  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(64)}\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
