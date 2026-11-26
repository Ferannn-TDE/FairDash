/**
 * EVENT LISTING (Batch 1 item 5b) — PUBLIC / UNLISTED / SIGNUP_ONLY, against real readers.
 *
 * Real route handlers and lib readers on the test DB; only Clerk identity and next/cache are
 * mocked (scripts/_route-loader.mjs). Every negative check has a positive control.
 *
 *   [1] Static guard: every customer ACTIVE-event filter carries a scope fragment (a planted
 *       unscoped query must fail), the non-status readers carry theirs, and no app code writes
 *       `listing` except the creation path.
 *   [2] Lists / sitemap: only PUBLIC ACTIVE fairs appear (UNLISTED + SIGNUP_ONLY never).
 *   [3] Fair page, SEO, vendors, menu: SIGNUP_ONLY never reachable (even forced ACTIVE);
 *       UNLISTED reachable when ACTIVE but not indexable; UPCOMING PUBLIC still 404s (unchanged).
 *   [4] Orders: SIGNUP_ONLY → 409 at any status; UPCOMING PUBLIC → 409 EVENT_INACTIVE (unchanged);
 *       PUBLIC and UNLISTED ACTIVE get past the event check.
 *   [5] Go Live refuses SIGNUP_ONLY; a PUBLIC fair reaches its normal checklist.
 *   [6] /api/vendor-signup/event: none / one / two-or-more; UNLISTED never counted.
 *   [7] Vendor joins: SIGNUP_ONLY and UNLISTED accept applications, DRAFT still refused;
 *       the wizard honours ?fair= then ?event=.
 *   [8] Creation: refuses unknown / unapproved / suspended organizers, a second sign-up event,
 *       a taken slug; creates exactly the agreed event otherwise.
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/event-listing-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST
// Listing is under test, not the vendor readiness bar (it has its own suites).
process.env.ENFORCE_VENDOR_READINESS = 'false'

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { NextRequest } from 'next/server'
import { EventListing, EventStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'elst-'
const MAIL = '@elst.local'
const rand = () => Math.random().toString(36).slice(2, 8)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
const login = (clerkId: string | null, roles: string[] = []) => {
  (globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata: { roles } } : undefined
}
const req = (url: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method, headers: { 'Content-Type': 'application/json' },
  body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
})
function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) { const q = join(dir, n); statSync(q).isDirectory() ? walk(q, out) : out.push(q) }
  return out
}

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    await prisma.vendorMember.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  // No network: the role sync's Clerk calls are stubbed (scripts/_network-stubs.ts).
  const stubs = await import('./_network-stubs'); stubs.stubClerkUsers()
  await cleanup()
  // Any sign-up event left in the test DB by something else would skew [6]; this suite owns them.
  const stray = await prisma.event.count({ where: { listing: EventListing.SIGNUP_ONLY, NOT: { urlSlug: { startsWith: PFX } } } })
  assert(stray === 0, `[0] baseline: no foreign SIGNUP_ONLY events in the test DB (${stray})`)

  // ── [1] static guard ───────────────────────────────────────────────────────────────────
  console.log('\n[1] Every customer reader carries its fragment; nothing else writes listing')
  const files = ['app', 'lib'].flatMap(d => walk(join(process.cwd(), d)))
    .filter(f => /\.(ts|tsx)$/.test(f))
    .map(f => ({ path: relative(process.cwd(), f).split(sep).join('/'), text: readFileSync(f, 'utf8') }))
  // Operator surfaces see every event (badged); only customer-facing code is in scope.
  const OPERATOR = /^app\/(admin|organizer|vendor|runner)\/|^app\/api\/(admin|organizer|vendor|runners?|drivers)\//
  const ACTIVE_EVENT_FILTER = /status:\s*EventStatus\.ACTIVE/
  const SCOPED = /publicFairScope\(\)|customerReachableScope\(\)/
  // Updated 2026-11-21: lib/test-fair.ts CREATES the hidden test fair with status ACTIVE (a write, never a customer
  // read), so it's operator tooling like the paths above. Exempted by exact path, not by pattern.
  const OPERATOR_FILES = new Set(['lib/test-fair.ts'])
  const unscopedLines = (fs: { path: string; text: string }[]) => fs.flatMap(f => OPERATOR.test(f.path) || OPERATOR_FILES.has(f.path) ? [] :
    f.text.split('\n').map((l, i) => ({ l, i })).filter(({ l }) => ACTIVE_EVENT_FILTER.test(l) && !SCOPED.test(l) && !/^\s*(\/\/|\*)/.test(l))
      .map(({ i }) => `${f.path}:${i + 1}`))
  const planted = unscopedLines([...files, { path: 'lib/new-reader.ts', text: "await db.event.findMany({ where: { status: EventStatus.ACTIVE, archivedAt: null } })" }])
  assert(planted.includes('lib/new-reader.ts:1'), '[0] positive control: a planted unscoped ACTIVE-event query is flagged')
  const real = unscopedLines(files)
  for (const r of real) console.log(`     ↳ unscoped: ${r}`)
  assert(real.length === 0, 'every customer-facing ACTIVE-event filter carries publicFairScope() or customerReachableScope()')

  const src = (p: string) => files.find(f => f.path === p)!.text
  const MUST: Array<[string, RegExp, string]> = [
    ['lib/fairs.ts', /publicFairScope\(\)[\s\S]*publicFairScope\(\)/, 'homepage/fairs list AND sitemap use publicFairScope'],
    ['app/api/fairs/route.ts', /publicFairScope\(\)/, '/api/fairs uses publicFairScope'],
    ['lib/menu/getGroupedMenuItems.ts', /customerReachableScope\(\)/, 'fair menu uses customerReachableScope'],
    ['app/api/orders/delivery-check/route.ts', /customerReachableScope\(\)/, 'delivery check uses customerReachableScope'],
    ['app/api/vendors/route.ts', /customerReachableScope\(\)/, 'customer vendor list uses customerReachableScope'],
    ['app/api/orders/route.ts', /listing === EventListing\.SIGNUP_ONLY[\s\S]{0,200}EVENT_SIGNUP_ONLY[\s\S]{0,300}status !== EventStatus\.ACTIVE/, 'orders: sign-up check sits BEFORE, and in addition to, the ACTIVE check'],
  ]
  for (const [p, re, label] of MUST) assert(re.test(src(p)), label)
  // The fragments are ADDED to the status filter, never replacing it.
  for (const l of src('lib/fairs.ts').split('\n').filter(l => SCOPED.test(l) && /where:|event:/.test(l))) {
    assert(/status: EventStatus\.ACTIVE/.test(l) && /archivedAt: null/.test(l), `lib/fairs.ts keeps status + archived next to the fragment: ${l.trim().slice(0, 70)}…`)
  }

  const LISTING_WRITE = /listing:\s*(EventListing\.|['"`]|body\b|data\b|input\b|req\b)/
  // Updated 2026-11-21: lib/test-fair.ts creates the hidden B1.17 test fair (UNLISTED) and is the only other writer;
  // its own suite is scripts/test-fair-test.ts.
  const WRITERS_ALLOWED = new Set(['lib/event-listing.ts', 'lib/signup-event.ts', 'lib/test-fair.ts'])
  assert(LISTING_WRITE.test("data: { listing: EventListing.UNLISTED }") && LISTING_WRITE.test("data: { listing: body.listing }"),
    '[0] positive control: the write scanner flags `listing: EventListing.X` and `listing: body.…`')
  assert(!LISTING_WRITE.test('select: { listing: true }') && !LISTING_WRITE.test('listing: f.listing,'), '[0] baseline: selects and response mapping are not writes')
  const writers = files.filter(f => !WRITERS_ALLOWED.has(f.path) && LISTING_WRITE.test(f.text)).map(f => f.path)
  for (const w of writers) console.log(`     ↳ writes listing: ${w}`)
  assert(writers.length === 0, 'no app or lib code writes Event.listing except the creation path')

  // ── fixtures ───────────────────────────────────────────────────────────────────────────
  const now = Date.now()
  const live = { startDate: new Date(now - 864e5), endDate: new Date(now + 3 * 864e5) }
  const mkOrg = async (approval: 'APPROVED' | 'PENDING', suspended = false) => {
    const email = `org-${rand()}${MAIL}`
    const user = await prisma.user.create({ data: { clerkId: `${PFX}u-${rand()}`, email, name: 'Org' } })
    const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}org`, contactEmail: email, approvalStatus: approval, suspendedAt: suspended ? new Date() : null } })
    await prisma.orgMember.create({ data: { organizerId: org.id, userId: user.id, role: 'owner' } })
    return { org, email, user }
  }
  const owner = await mkOrg('APPROVED')
  const mkEvent = (tag: string, status: EventStatus, listing: EventListing) => prisma.event.create({
    data: {
      name: `${PFX}${tag}`, urlSlug: `${PFX}${tag}-${rand()}`, status, listing, organizerId: owner.org.id, ...live,
      venueAddress: '1 Main St', venueCity: 'Springfield', venueState: 'IL', venueZip: '62701',
      fulfillmentConfig: { create: { boothPickupEnabled: true, homeDeliveryEnabled: false, curbsideEnabled: false } },
    },
  })
  const pubActive = await mkEvent('pub-active', EventStatus.ACTIVE, EventListing.PUBLIC)
  const pubUpcoming = await mkEvent('pub-upcoming', EventStatus.UPCOMING, EventListing.PUBLIC)
  const unlisted = await mkEvent('unlisted', EventStatus.ACTIVE, EventListing.UNLISTED)
  const signup = await mkEvent('signup', EventStatus.UPCOMING, EventListing.SIGNUP_ONLY)
  const signupForcedActive = await mkEvent('signup-forced', EventStatus.ACTIVE, EventListing.SIGNUP_ONLY)
  for (const e of [pubActive, unlisted, signupForcedActive]) {
    await prisma.vendor.create({ data: { eventId: e.id, name: `${PFX}v`, slug: `v-${rand()}`, cuisineType: 'Tacos', status: 'ACTIVE' } })
  }

  const fairs = await import('../lib/fairs')
  const slugs = (xs: Array<{ slug?: string; urlSlug?: string }>) => new Set(xs.map(x => x.slug ?? x.urlSlug))

  // ── [2] lists / sitemap ────────────────────────────────────────────────────────────────
  console.log('\n[2] Lists, /api/fairs and the sitemap: PUBLIC ACTIVE only')
  const list = slugs(await fairs.getAllFairsCached() as any)
  const api: any = await (await (await import('../app/api/fairs/route')).GET()).json()
  const apiSlugs = slugs(api.data)
  const sitemap = new Set((await fairs.getSitemapFairsCached()).map(f => f.slug))
  for (const [name, s] of [['homepage + /fairs list', list], ['/api/fairs', apiSlugs], ['sitemap', sitemap]] as const) {
    assert(s.has(pubActive.urlSlug), `[0] control: ${name} shows the PUBLIC ACTIVE fair`)
    assert(!s.has(unlisted.urlSlug) && !s.has(signup.urlSlug) && !s.has(signupForcedActive.urlSlug), `${name} never shows UNLISTED or SIGNUP_ONLY (even forced ACTIVE)`)
    assert(!s.has(pubUpcoming.urlSlug), `${name} still hides an UPCOMING PUBLIC fair (unchanged)`)
  }

  // ── [3] fair page, SEO, vendors, menu ──────────────────────────────────────────────────
  console.log('\n[3] Fair page, SEO, vendor list, menu')
  const page = (slug: string) => fairs.getFairBySlugCached(slug)
  assert(!!(await page(pubActive.urlSlug)), '[0] control: PUBLIC ACTIVE fair page resolves')
  assert(!(await page(pubUpcoming.urlSlug)), 'UPCOMING PUBLIC fair page still 404s (unchanged)')
  assert(!(await page(signup.urlSlug)) && !(await page(signupForcedActive.urlSlug)), 'SIGNUP_ONLY fair page 404s, even if forced ACTIVE')
  assert(!!(await page(unlisted.urlSlug)), 'UNLISTED ACTIVE fair page resolves by direct URL')
  const seoPub = await fairs.getFairSeoBySlugCached(pubActive.urlSlug)
  const seoUnl = await fairs.getFairSeoBySlugCached(unlisted.urlSlug)
  assert(seoPub?.indexable === true, '[0] control: PUBLIC fair is indexable')
  assert(!!seoUnl && seoUnl.indexable === false, 'UNLISTED fair: SEO data loads for the page title but indexable = false (noindex, no JSON-LD)')
  assert(!(await fairs.getFairSeoBySlugCached(signupForcedActive.urlSlug)), 'SIGNUP_ONLY has no SEO data at all')
  const layout = readFileSync('app/fair/[fairSlug]/layout.tsx', 'utf8'), fairPage = readFileSync('app/fair/[fairSlug]/page.tsx', 'utf8')
  assert(/fair\.indexable \? robotsFor\('fair'\) : robotsFor\('private'\)/.test(layout), 'fair layout: non-indexable → noindex robots')
  assert(/fair\?\.indexable && <script type="application\/ld\+json"/.test(fairPage), 'fair page: JSON-LD only when indexable')
  assert((await fairs.getVendorsBySlugCached(pubActive.urlSlug)).length === 1, '[0] control: PUBLIC fair vendor list has its vendor')
  assert((await fairs.getVendorsBySlugCached(signupForcedActive.urlSlug)).length === 0, 'SIGNUP_ONLY vendor list is empty to customers')
  const vendorsGET = (await import('../app/api/vendors/route')).GET
  const vPub = await vendorsGET(req(`/api/vendors?eventSlug=${pubActive.urlSlug}`) as any)
  const vSig = await vendorsGET(req(`/api/vendors?eventSlug=${signup.urlSlug}`) as any)
  assert(vPub.status === 200, `[0] control: GET /api/vendors for a PUBLIC fair → 200 (got ${vPub.status})`)
  assert(vSig.status === 404, `GET /api/vendors for the SIGNUP_ONLY event → 404 (got ${vSig.status})`)

  // ── [4] orders ─────────────────────────────────────────────────────────────────────────
  console.log('\n[4] Ordering')
  const ordersPOST = (await import('../app/api/orders/route')).POST
  const customer = await prisma.user.create({ data: { clerkId: `${PFX}cust-${rand()}`, email: `cust-${rand()}${MAIL}`, name: 'C' } })
  const order = async (eventId: string) => {
    login(customer.clerkId)
    const r = await ordersPOST(req('/api/orders', 'POST', {
      eventId, fulfillmentType: 'BOOTH_PICKUP', customerName: 'C', customerPhone: '6185550100',
      items: [{ menuItemId: `${PFX}nope`, vendorId: `${PFX}nope`, quantity: 1 }],
    }) as any)
    const j: any = await r.json().catch(() => ({}))
    return { status: r.status, code: j?.error?.code as string | undefined }
  }
  const oSig = await order(signup.id), oSigF = await order(signupForcedActive.id)
  assert(oSig.status === 409 && oSig.code === 'EVENT_SIGNUP_ONLY', `SIGNUP_ONLY (UPCOMING) → 409 EVENT_SIGNUP_ONLY (got ${oSig.status} ${oSig.code})`)
  assert(oSigF.status === 409 && oSigF.code === 'EVENT_SIGNUP_ONLY', `SIGNUP_ONLY forced ACTIVE → still 409 EVENT_SIGNUP_ONLY (got ${oSigF.status} ${oSigF.code})`)
  const oUp = await order(pubUpcoming.id)
  assert(oUp.status === 409 && oUp.code === 'EVENT_INACTIVE', `UPCOMING PUBLIC → 409 EVENT_INACTIVE, exactly as before (got ${oUp.status} ${oUp.code})`)
  const oPub = await order(pubActive.id), oUnl = await order(unlisted.id)
  const pastEvent = (o: { code?: string }) => !['EVENT_SIGNUP_ONLY', 'EVENT_INACTIVE', 'EVENT_NOT_FOUND'].includes(o.code ?? '')
  assert(pastEvent(oPub), `[0] control: PUBLIC ACTIVE gets past the event check (stopped later at ${oPub.status} ${oPub.code})`)
  assert(pastEvent(oUnl), `UNLISTED ACTIVE gets past the event check too (stopped later at ${oUnl.status} ${oUnl.code})`)

  // ── [5] Go Live ────────────────────────────────────────────────────────────────────────
  console.log('\n[5] Go Live')
  const statusPATCH = (await import('../app/api/admin/events/[id]/status/route')).PATCH
  login(`${PFX}super`, ['super_admin'])
  const goLive = async (id: string) => {
    const r = await statusPATCH(req(`/api/admin/events/${id}/status`, 'PATCH', { status: 'ACTIVE' }), { params: Promise.resolve({ id }) })
    return { status: r.status, code: ((await r.json()) as any)?.error?.code as string | undefined }
  }
  const gSig = await goLive(signup.id)
  assert(gSig.status === 409 && gSig.code === 'EVENT_SIGNUP_ONLY', `Go Live on SIGNUP_ONLY → 409 EVENT_SIGNUP_ONLY (got ${gSig.status} ${gSig.code})`)
  assert((await prisma.event.findUnique({ where: { id: signup.id } }))?.status === EventStatus.UPCOMING, 'and it stayed UPCOMING')
  const gPub = await goLive(pubUpcoming.id)
  assert(gPub.code !== 'EVENT_SIGNUP_ONLY', `[0] control: a PUBLIC fair reaches its normal checklist (got ${gPub.status} ${gPub.code})`)

  // ── [6] the sign-up event endpoint ─────────────────────────────────────────────────────
  console.log('\n[6] /api/vendor-signup/event')
  const signupGET = (await import('../app/api/vendor-signup/event/route')).GET
  const ask = async () => { const r = await signupGET(); return { status: r.status, body: (await r.json()) as any } }
  // Two sign-up fixtures exist right now (signup + signupForcedActive) → refuse.
  const two = await ask()
  assert(two.status === 409 && two.body.error?.code === 'SIGNUP_EVENT_AMBIGUOUS', `two sign-up events → 409, no guess (got ${two.status})`)
  await prisma.event.update({ where: { id: signupForcedActive.id }, data: { archivedAt: new Date() } })
  const one = await ask()
  assert(one.status === 200 && one.body.data.event?.slug === signup.urlSlug, 'exactly one (the other archived) → that event')
  assert(one.body.data.event?.slug !== unlisted.urlSlug, 'the UNLISTED test fair is never counted as a sign-up event')
  await prisma.event.update({ where: { id: signup.id }, data: { status: EventStatus.DRAFT } })
  const none = await ask()
  assert(none.status === 200 && none.body.data.event === null, 'none (draft or archived don\'t count) → null, the wizard falls back to its picker')
  await prisma.event.update({ where: { id: signup.id }, data: { status: EventStatus.UPCOMING } })

  // ── [7] vendor joins + wizard routing ─────────────────────────────────────────────────
  console.log('\n[7] Vendor applications and the wizard')
  const vendorsPOST = (await import('../app/api/vendors/route')).POST
  const apply = async (slug: string) => {
    const u = await prisma.user.create({ data: { clerkId: `${PFX}vu-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'V' } })
    login(u.clerkId)
    const r = await vendorsPOST(req('/api/vendors', 'POST', { eventSlug: slug, name: `${PFX}Booth ${rand()}`, cuisineType: 'Tacos', legalName: 'Test Vendor', agreedToVendorAgreement: true }) as any)
    return { status: r.status, code: ((await r.json()) as any)?.error?.code as string | undefined }
  }
  const aSig = await apply(signup.urlSlug), aUnl = await apply(unlisted.urlSlug)
  assert(aSig.status === 201, `a vendor can apply to the SIGNUP_ONLY holding event (got ${aSig.status} ${aSig.code})`)
  assert(aUnl.status === 201, `a vendor can apply to the UNLISTED test fair by link (got ${aUnl.status} ${aUnl.code})`)
  const draft = await mkEvent('draft', EventStatus.DRAFT, EventListing.PUBLIC)
  const aDraft = await apply(draft.urlSlug)
  assert(aDraft.status !== 201 && aDraft.code === 'FAIR_NOT_JOINABLE', `[0] control: a DRAFT fair still refuses applications, for being a draft (got ${aDraft.status} ${aDraft.code})`)
  const wizard = readFileSync('app/become-vendor/VendorOnboarding.tsx', 'utf8')
  assert(/query\.get\('fair'\) \?\? query\.get\('event'\)/.test(wizard), 'wizard: ?fair= first, the older ?event= still works')
  assert(/fetch\('\/api\/vendor-signup\/event'\)/.test(wizard) && /if \(json\?\.success\) return loadPicker\(\)/.test(wizard), 'wizard: holding event first, picker only when there is none')
  assert(wizard.includes("You're applying to sell with FairSynq. Once you're approved, you'll be able to add the events you're working as they're announced."), 'wizard: the agreed step-1 wording, verbatim')
  assert(!/Loading fairs…/.test(wizard), 'wizard: no "Loading fairs…" stuck forever when nothing is live (skeleton, then a real state)')

  // ── [8] creation ───────────────────────────────────────────────────────────────────────
  console.log('\n[8] Creating the holding event')
  const { createSignupEvent, planSignupEvent, SignupEventRefused } = await import('../lib/signup-event')
  const db = (await import('../lib/db')).db
  const input = (email: string, slug = `${PFX}hold-${rand()}`) => ({ organizerEmail: email, name: `${PFX}Hold`, slug, startDate: new Date('2026-11-09'), endDate: new Date('2027-12-31') })
  const refused = async (p: Promise<unknown>) => { try { await p; return null } catch (e) { return e instanceof SignupEventRefused ? e.code : 'OTHER' } }
  assert(await refused(planSignupEvent(db, input(owner.email))) === 'ALREADY_EXISTS', 'refuses while a live sign-up event exists')
  await prisma.event.update({ where: { id: signup.id }, data: { archivedAt: new Date() } })
  const pending = await mkOrg('PENDING'), suspended = await mkOrg('APPROVED', true)
  assert(await refused(planSignupEvent(db, input(`nobody${MAIL}`))) === 'NO_ORGANIZER', 'refuses an email with no organizer')
  assert(await refused(planSignupEvent(db, input(pending.email))) === 'NOT_APPROVED', 'refuses an organizer that is not approved')
  assert(await refused(planSignupEvent(db, input(suspended.email))) === 'SUSPENDED', 'refuses a suspended organizer')
  assert(await refused(planSignupEvent(db, input(owner.email, pubActive.urlSlug))) === 'SLUG_TAKEN', 'refuses a slug another event uses')
  const before = await prisma.event.count({ where: { urlSlug: { startsWith: PFX } } })
  assert(before === 6, `[0] none of the refusals wrote an event (${before} fixtures)`)
  const made = await createSignupEvent(db, input(owner.email))
  const row = await prisma.event.findUnique({ where: { id: made.id }, include: { fulfillmentConfig: true } })
  assert(row?.status === EventStatus.UPCOMING && row.listing === EventListing.SIGNUP_ONLY && row.organizerId === owner.org.id,
    '[0] control: an approved organizer with none live → UPCOMING, SIGNUP_ONLY, owned by them')
  assert(row?.venueAddress === null && row.fulfillmentConfig?.homeDeliveryEnabled === false && row.fulfillmentConfig?.curbsideEnabled === false, 'no venue; delivery and curbside off')
  assert(await refused(createSignupEvent(db, input(owner.email))) === 'ALREADY_EXISTS', 'running it again refuses (exactly one)')
  const unlistedCount = await prisma.event.count({ where: { listing: EventListing.UNLISTED, archivedAt: null, urlSlug: { startsWith: PFX } } })
  assert(unlistedCount === 1 && (await refused(planSignupEvent(db, input(owner.email)))) === 'ALREADY_EXISTS',
    'with an UNLISTED test fair live, the exactly-one rule still sees only the one sign-up event')
  assert(stubs.stubCalls.clerkGetUser > 0 && stubs.stubCalls.clerkUpdate === 0, `[stub] the role sync reached the Clerk stub (${stubs.stubCalls.clerkGetUser} call(s)), never the network`)
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
