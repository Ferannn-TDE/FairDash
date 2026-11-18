/**
 * ONLINE PRICE MARKUP — audit H5, step 2h. Real routes, test DB.
 *
 * Decisions (Jordan, Nov 15): per event, basis points 0–1000 (0%–10%, the cap is a code constant);
 * default 0%; set by that event's organizer before the event starts, or by a strict admin at any
 * time; refused out of range, never clamped; every change logged in the same transaction; a change
 * clears vendor-menu, fair and event-menu-{slug}.
 *
 *   [1] pricing helpers: onlinePriceCents (per unit, half-up), parseMarkupBps, percentToBps (7.15 → 715)
 *   [2] organizer route: set, log row, cache tags, unchanged value, refusals, mixed body, 0 and 1000
 *   [3] who may set it: 401 / 403 wrong role / 404 another organizer's fair; admin route roles
 *   [4] lock: organizer refused 409 MARKUP_LOCKED once started (ACTIVE, or start date passed);
 *       re-sending the same value still saves other settings; strict admin can still change it
 *   [5] admin route: set, ADMIN log row, tags, refusals, markup-only body, GET shows the value
 *   [6] one transaction: a failed log write leaves the markup unchanged; simultaneous changes chain
 *   [7] checkout at 0%: unchanged from before 2h; snapshots written
 *   [8] checkout at 10%: online unit price, fee on the in-person base, two vendors, Stripe amount
 *   [9] checkout floor uses the online subtotal (passes only because of the markup; still refused)
 *   [10] refunds use what the customer paid (stored line totals), at 10%
 *   [11] client-sent prices refused: menu create, menu edit, menu request, checkout line and body
 *   [12] never charge more than the customer saw: 409 PRICE_CHANGED, confirm, missing total 400
 *   [13] page total == server total exactly: two vendors, curbside, 15% tip, odd prices; a grid
 *   [21] organizer settings on an ACTIVE fair save again (a status equal to the current one is a
 *        no-op); an organizer still can't set ACTIVE; the markup stays locked
 *
 * Stripe is never called: the key is replaced with an obvious fake and paymentIntents.create /
 * update are replaced with recorders before the first order.
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/online-markup-test.ts
 * Self-cleaning, prefix omk-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST
// A fake test-mode key: the route needs a non-placeholder key to proceed, and the Stripe calls it
// makes are replaced with recorders below, so nothing is ever sent to Stripe.
process.env.STRIPE_SECRET_KEY = 'sk_test_omk_fake_key_never_sent'
// Pricing is under test, not the vendor readiness bar (it has its own suites).
process.env.ENFORCE_VENDOR_READINESS = 'false'

import { createRequire, register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)
// TEST-ONLY SHIM, as in scripts/menu-immediate-delete-test.ts: lib/menu/getGroupedMenuItems.ts uses
// a bare `require('next/cache')` that does not exist in an ES-module script. Here `next/cache` is
// answered with the same test stand-in the route loader uses (scripts/_next-cache-mock.mjs:
// unstable_cache(fn) just runs fn), so the real menu loaders can be called against the test DB
// ([15]). Every other require loads normally.
import * as nextCacheMock from './_next-cache-mock.mjs'
const realRequire = createRequire(import.meta.url)
;(globalThis as unknown as { require?: unknown }).require =
  Object.assign((id: string) => (id === 'next/cache' ? nextCacheMock : realRequire(id)), realRequire)

import { NextRequest } from 'next/server'

const prisma = testPrisma()
const PFX = 'omk-'
const MAIL = '@omk.test'
const rand = () => Math.random().toString(36).slice(2, 9)
const TRIGGER_FN = 'omk_fail_markup_log'
const TRIGGER = 'omk_fail_markup_log_trg'
const DAY = 864e5

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

function login(clerkId: string | null, roles?: string[]) {
  const g = globalThis as unknown as { __MOCK_CLERK?: { userId: string; publicMetadata?: unknown } }
  g.__MOCK_CLERK = clerkId ? { userId: clerkId, ...(roles && { publicMetadata: { roles } }) } : undefined
}
type Body = { success?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } }
async function bodyOf(res: Response): Promise<Body> {
  try { return await res.json() as Body } catch { return {} }
}

async function dropTrigger() {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRIGGER} ON "EventMarkupChange"`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TRIGGER_FN}()`)
}

async function cleanup() {
  await dropTrigger()
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const orders = await prisma.order.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const oids = orders.map(o => o.id)
    if (oids.length) {
      await prisma.vendorOrderStatus.deleteMany({ where: { orderId: { in: oids } } })
      await prisma.orderItem.deleteMany({ where: { orderId: { in: oids } } })
      await prisma.order.deleteMany({ where: { id: { in: oids } } })
    }
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const vids = vs.map(v => v.id)
    await prisma.menuChangeEvent.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuRequest.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorAuditLog.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
    // The log is ON DELETE RESTRICT: remove it before its events.
    await prisma.eventMarkupChange.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { OR: [{ email: { endsWith: MAIL } }, { clerkId: { startsWith: PFX } }] } })
}

async function main() {
  console.log('\n══ ONLINE PRICE MARKUP (H5, step 2h) ══')
  await cleanup()

  const price = await import('../lib/menu/price')
  const markupLib = await import('../lib/event-markup')
  const cache = await import('next/cache') as unknown as { revalidated: string[] }
  const orgRoute = await import('../app/api/organizer/fairs/[fairSlug]/settings/route')
  const adminRoute = await import('../app/api/admin/events/[id]/settings/route')

  const orgPatch = (slug: string, body: unknown) => (orgRoute.PATCH as unknown as (r: NextRequest, c: unknown) => Promise<Response>)(
    new NextRequest(`http://localhost/api/organizer/fairs/${slug}/settings`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ fairSlug: slug }) })
  const orgGet = (slug: string) => (orgRoute.GET as unknown as (r: NextRequest, c: unknown) => Promise<Response>)(
    new NextRequest(`http://localhost/api/organizer/fairs/${slug}/settings`), { params: Promise.resolve({ fairSlug: slug }) })
  const adminPatch = (id: string, body: unknown) => (adminRoute.PATCH as unknown as (r: NextRequest, c: unknown) => Promise<Response>)(
    new NextRequest(`http://localhost/api/admin/events/${id}/settings`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id }) })
  const adminGet = (id: string) => (adminRoute.GET as unknown as (r: NextRequest, c: unknown) => Promise<Response>)(
    new NextRequest(`http://localhost/api/admin/events/${id}/settings`), { params: Promise.resolve({ id }) })

  // ── fixture ─────────────────────────────────────────────────────────────────────────────────
  const mkUser = (tag: string) => prisma.user.create({
    data: { clerkId: `${PFX}${tag}-${rand()}`, email: `${tag}-${rand()}${MAIL}`, name: tag },
  })
  const mkOrg = async (tag: string) => {
    const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}${tag}`, contactEmail: `${tag}-${rand()}${MAIL}`, approvalStatus: 'APPROVED' } })
    const user = await mkUser(tag)
    await prisma.orgMember.create({ data: { organizerId: org.id, userId: user.id, role: 'owner' } })
    return { org, user }
  }
  const now = Date.now()
  const mkFair = (organizerId: string, tag: string) => prisma.event.create({
    data: { name: `${PFX}${tag}`, urlSlug: `${PFX}${tag}-${rand()}`, status: 'UPCOMING', organizerId, startDate: new Date(now + 7 * DAY), endDate: new Date(now + 9 * DAY) },
  })
  const A = await mkOrg('orga')
  const B = await mkOrg('orgb')
  const fairA = await mkFair(A.org.id, 'fair-a')
  const fairB = await mkFair(B.org.id, 'fair-b')
  const customer = await mkUser('customer')
  const admin = await mkUser('admin')
  const bpsOf = async (id: string) => (await prisma.event.findUniqueOrThrow({ where: { id }, select: { onlineMarkupBps: true } })).onlineMarkupBps
  const logsOf = (id: string) => prisma.eventMarkupChange.findMany({ where: { eventId: id }, orderBy: { createdAt: 'asc' } })
  const tagsFor = (slug: string) => ['vendor-menu', 'fair', `event-menu-${slug}`]
  const hasAllTags = (slug: string) => tagsFor(slug).every(t => cache.revalidated.includes(t))
  const clearTags = () => { cache.revalidated.length = 0 }

  // ── [1] pricing helpers ─────────────────────────────────────────────────────────────────────
  console.log('\n[1] pricing helpers (lib/menu/price.ts)')
  {
    const { onlinePriceCents, onlinePrice, parseMarkupBps, percentToBps, MARKUP_BPS_DEFAULT, MARKUP_BPS_MAX } = price
    assert(MARKUP_BPS_DEFAULT === 0 && MARKUP_BPS_MAX === 1000, 'default 0 bp (0%), cap 1000 bp (10%), constants in code')
    assert(onlinePriceCents(333, 750) === 358, '$3.33 at 7.5% → $3.58 (357.975¢ rounds half-up)')
    assert(onlinePriceCents(100, 1000) === 110, '$1.00 at 10% → $1.10')
    assert(onlinePriceCents(105, 1000) === 116, '$1.05 at 10% → $1.16 (115.5¢: half a cent rounds up)')
    assert(onlinePriceCents(1000, 0) === 1000 && onlinePriceCents(1000, 1000) === 1100, '$10.00 at 0% → $10.00; at 10% → $11.00')
    assert(onlinePriceCents(1_000_000, 1000) === 1_100_000, '$10,000 at 10% → $11,000 (integer maths, no overflow)')
    assert(onlinePrice(7.15, 1000) === 7.87, '$7.15 at 10% → $7.87 (786.5¢ rounds up)')
    let threw = 0
    for (const bad of [-1, 1001, 2.5]) { try { onlinePriceCents(100, bad) } catch { threw++ } }
    assert(threw === 3, 'onlinePriceCents refuses a markup outside 0–1000 or a fraction')
    for (const ok of [0, 1, 715, 1000]) assert(parseMarkupBps(ok).ok, `parseMarkupBps accepts ${ok}`)
    for (const bad of [-1, 1001, 2.5, '5', null, true, NaN, Infinity, undefined, {}]) {
      const label = typeof bad === 'number' ? String(bad) : (JSON.stringify(bad) ?? String(bad))
      assert(!parseMarkupBps(bad).ok, `parseMarkupBps refuses ${label}`)
    }
    // Why Math.round: many percentages are not whole numbers once multiplied by 100 in JavaScript.
    // (7.15 × 100 happens to be exactly 715; 8.2, 4.35 and 9.95 are not.)
    assert(8.2 * 100 !== 820 && 4.35 * 100 !== 435 && 9.95 * 100 !== 995, '[0] control: 8.2 × 100, 4.35 × 100 and 9.95 × 100 are not whole numbers in JavaScript')
    assert(percentToBps(7.15) === 715 && percentToBps('7.15') === 715, 'percentToBps: 7.15% → 715')
    assert(percentToBps(4.35) === 435 && percentToBps(9.95) === 995, 'percentToBps: 4.35% → 435, 9.95% → 995 (Math.round)')
    assert(percentToBps(8.2) === 820 && percentToBps(0.29) === 29 && percentToBps(10) === 1000 && percentToBps(0) === 0, 'percentToBps: 8.2 → 820, 0.29 → 29, 10 → 1000, 0 → 0')
    assert(percentToBps('') === null && percentToBps('abc') === null, 'percentToBps: empty or non-numeric → null')
  }

  // ── [2] organizer route ─────────────────────────────────────────────────────────────────────
  console.log('\n[2] organizer sets the markup (before the event starts)')
  {
    login(A.user.clerkId)
    assert(await bpsOf(fairA.id) === 0, 'a new event starts at 0%')
    clearTags()
    const r = await orgPatch(fairA.urlSlug, { onlineMarkupBps: 500 })
    const b = await bodyOf(r)
    const logs = await logsOf(fairA.id)
    assert(r.status === 200 && b.data?.onlineMarkupBps === 500 && await bpsOf(fairA.id) === 500, `5% saved (${r.status})`)
    assert(logs.length === 1 && logs[0].oldBps === 0 && logs[0].newBps === 500 && logs[0].actorRole === 'ORGANIZER'
      && logs[0].actorClerkId === A.user.clerkId && logs[0].actorUserId === A.user.id && logs[0].createdAt instanceof Date,
    'one log row: who (organizer, Clerk id, User id), old 0, new 500, when')
    assert(hasAllTags(fairA.urlSlug), `clears vendor-menu, fair and event-menu-{slug} (${cache.revalidated.join(', ')})`)

    clearTags()
    const same = await orgPatch(fairA.urlSlug, { onlineMarkupBps: 500 })
    assert(same.status === 200 && (await logsOf(fairA.id)).length === 1, 'sending the same value: 200, no new log row')
    assert(!cache.revalidated.includes(`event-menu-${fairA.urlSlug}`) && !cache.revalidated.includes('vendor-menu'), 'and the menu caches are not cleared')

    const refused: unknown[] = [-1, 1001, 2.5, '5', null, true, 'abc']
    for (const v of refused) {
      clearTags()
      const res = await orgPatch(fairA.urlSlug, { onlineMarkupBps: v })
      assert(res.status === 400 && cache.revalidated.length === 0, `${JSON.stringify(v)} → 400 (${res.status}), no caches cleared`)
    }
    assert(await bpsOf(fairA.id) === 500 && (await logsOf(fairA.id)).length === 1, 'none of those changed the markup or wrote a log row (refused, not clamped)')

    const mixed = await orgPatch(fairA.urlSlug, { welcomeMessage: `${PFX}should-not-save`, onlineMarkupBps: 2000 })
    const wm = (await prisma.event.findUniqueOrThrow({ where: { id: fairA.id } })).welcomeMessage
    assert(mixed.status === 400 && wm !== `${PFX}should-not-save`, 'a bad markup refuses the whole request: the welcome message in the same request is not saved')

    const zero = await orgPatch(fairA.urlSlug, { onlineMarkupBps: 0 })
    const max = await orgPatch(fairA.urlSlug, { onlineMarkupBps: 1000 })
    assert(zero.status === 200 && max.status === 200 && await bpsOf(fairA.id) === 1000, 'exactly 0 and exactly 1000 are accepted')

    const seven = await orgPatch(fairA.urlSlug, { onlineMarkupBps: price.percentToBps(7.15) })
    assert(seven.status === 200 && await bpsOf(fairA.id) === 715, '7.15% typed on the screen saves as 715')
    const raw = await orgPatch(fairA.urlSlug, { onlineMarkupBps: 8.2 * 100 })
    assert(raw.status === 400 && await bpsOf(fairA.id) === 715, '[0] control: sending 8.2 × 100 without Math.round (819.9999999999999) is refused, not a whole number')
    const eight = await orgPatch(fairA.urlSlug, { onlineMarkupBps: price.percentToBps(8.2) })
    assert(eight.status === 200 && await bpsOf(fairA.id) === 820, '8.2% through percentToBps saves as 820')
    await orgPatch(fairA.urlSlug, { onlineMarkupBps: 715 })

    const both = await orgPatch(fairA.urlSlug, { welcomeMessage: `${PFX}hello`, onlineMarkupBps: 250 })
    const after = await prisma.event.findUniqueOrThrow({ where: { id: fairA.id } })
    assert(both.status === 200 && after.welcomeMessage === `${PFX}hello` && after.onlineMarkupBps === 250, 'markup and another setting in one request: both saved')
    const ok = await orgPatch(fairA.urlSlug, { welcomeMessage: `${PFX}hi` })
    assert(ok.status === 200 && await bpsOf(fairA.id) === 250, '[0] control: a request without the markup leaves it alone')

    const g = await bodyOf(await orgGet(fairA.urlSlug))
    assert(g.data?.onlineMarkupBps === 250 && g.data?.markupLocked === false, 'GET shows the markup and markupLocked false')
    const chain = await logsOf(fairA.id)
    assert(chain.every((l, i) => i === 0 || l.oldBps === chain[i - 1].newBps), `the log chains: each old value is the previous new value (${chain.length} rows)`)
  }

  // ── [3] who may set it ──────────────────────────────────────────────────────────────────────
  console.log('\n[3] who may set it')
  {
    const before = await bpsOf(fairA.id)
    login(null)
    assert((await orgPatch(fairA.urlSlug, { onlineMarkupBps: 100 })).status === 401, 'organizer route, signed out → 401')
    login(customer.clerkId)
    assert((await orgPatch(fairA.urlSlug, { onlineMarkupBps: 100 })).status === 403, 'organizer route, a customer → 403 (wrong role)')
    login(B.user.clerkId)
    const other = await orgPatch(fairA.urlSlug, { onlineMarkupBps: 100 })
    assert(other.status === 404, `organizer route, another organizer's fair → 404 (${other.status})`)
    assert(await bpsOf(fairA.id) === before, 'none of them changed it')

    login(null)
    assert((await adminPatch(fairA.id, { onlineMarkupBps: 100 })).status === 401, 'admin route, signed out → 401')
    for (const [label, roles] of [['an organizer (no admin role)', undefined], ['event_operator', ['event_operator']], ['platform_manager', ['platform_manager']]] as const) {
      login(A.user.clerkId, roles as string[] | undefined)
      const res = await adminPatch(fairA.id, { onlineMarkupBps: 100 })
      assert(res.status === 403, `admin route, ${label} → 403 (${res.status})`)
    }
    login(admin.clerkId, ['admin'])
    assert((await adminPatch(`${PFX}no-such-event`, { onlineMarkupBps: 100 })).status === 404, 'admin route, unknown event → 404')
    assert(await bpsOf(fairA.id) === before, 'still unchanged')
  }

  // ── [4] lock once the event has started ─────────────────────────────────────────────────────
  console.log('\n[4] organizers are locked once the event has started')
  {
    const t = new Date(now)
    assert(!markupLib.markupStarted({ status: 'UPCOMING', startDate: new Date(now + DAY) }, t), 'markupStarted: upcoming, start tomorrow → not started')
    assert(markupLib.markupStarted({ status: 'ACTIVE', startDate: new Date(now + DAY) }, t), 'markupStarted: ACTIVE → started')
    assert(markupLib.markupStarted({ status: 'UPCOMING', startDate: new Date(now - 1000) }, t), 'markupStarted: start date passed → started')
    assert(markupLib.markupStarted({ status: 'UPCOMING', startDate: new Date(now) }, t), 'markupStarted: exactly at the start → started')

    login(A.user.clerkId)
    const before = await bpsOf(fairA.id)
    const logsBefore = (await logsOf(fairA.id)).length

    await prisma.event.update({ where: { id: fairA.id }, data: { status: 'ACTIVE' } })
    const r1 = await orgPatch(fairA.urlSlug, { onlineMarkupBps: 300 })
    const b1 = await bodyOf(r1)
    assert(r1.status === 409 && b1.error?.code === 'MARKUP_LOCKED', `ACTIVE event: organizer change → 409 MARKUP_LOCKED (${r1.status} ${b1.error?.code})`)

    await prisma.event.update({ where: { id: fairA.id }, data: { status: 'UPCOMING', startDate: new Date(now - DAY) } })
    const r2 = await orgPatch(fairA.urlSlug, { onlineMarkupBps: 300 })
    assert(r2.status === 409 && (await bodyOf(r2)).error?.code === 'MARKUP_LOCKED', 'start date passed (still UPCOMING): organizer change → 409 MARKUP_LOCKED')

    const r3 = await orgPatch(fairA.urlSlug, { onlineMarkupBps: 300, welcomeMessage: `${PFX}locked` })
    assert(r3.status === 409 && (await prisma.event.findUniqueOrThrow({ where: { id: fairA.id } })).welcomeMessage !== `${PFX}locked`,
      'a locked change refuses the whole request (the other setting is not saved either)')
    assert(await bpsOf(fairA.id) === before && (await logsOf(fairA.id)).length === logsBefore, 'markup unchanged, no log row')

    const r4 = await orgPatch(fairA.urlSlug, { onlineMarkupBps: before, welcomeMessage: `${PFX}still-saves` })
    assert(r4.status === 200 && (await prisma.event.findUniqueOrThrow({ where: { id: fairA.id } })).welcomeMessage === `${PFX}still-saves`,
      're-sending the SAME markup after the start is not a change: the other setting still saves (a form that sends every field keeps working)')
    const g = await bodyOf(await orgGet(fairA.urlSlug))
    assert(g.data?.markupLocked === true, 'GET shows markupLocked true')

    login(admin.clerkId, ['admin'])
    clearTags()
    const r5 = await adminPatch(fairA.id, { onlineMarkupBps: 300 })
    const last = (await logsOf(fairA.id)).at(-1)
    assert(r5.status === 200 && await bpsOf(fairA.id) === 300, `a strict admin can still change it after the start (${r5.status})`)
    assert(last?.actorRole === 'ADMIN' && last.oldBps === before && last.newBps === 300 && last.actorUserId === admin.id, 'logged as ADMIN with old and new values')
    assert(hasAllTags(fairA.urlSlug), 'admin change clears all three tags')
    await prisma.event.update({ where: { id: fairA.id }, data: { startDate: new Date(now + 7 * DAY) } })
  }

  // ── [5] admin route ─────────────────────────────────────────────────────────────────────────
  console.log('\n[5] admin route')
  {
    login(admin.clerkId, ['super_admin'])
    clearTags()
    const r = await adminPatch(fairB.id, { onlineMarkupBps: 900 })
    const b = await bodyOf(r)
    const logs = await logsOf(fairB.id)
    assert(r.status === 200 && b.data?.onlineMarkupBps === 900 && await bpsOf(fairB.id) === 900, `a markup-only body works (no "no editable fields" error) (${r.status})`)
    assert(logs.length === 1 && logs[0].actorRole === 'ADMIN' && logs[0].oldBps === 0 && logs[0].newBps === 900 && logs[0].actorClerkId === admin.clerkId, 'one ADMIN log row, old 0 new 900')
    assert(hasAllTags(fairB.urlSlug), 'clears vendor-menu, fair and event-menu-{slug}')

    for (const v of [-1, 1001, 2.5, '5', null, false]) {
      const res = await adminPatch(fairB.id, { onlineMarkupBps: v })
      assert(res.status === 400, `${JSON.stringify(v)} → 400 (${res.status})`)
    }
    const nameBefore = (await prisma.event.findUniqueOrThrow({ where: { id: fairB.id } })).name
    const mixed = await adminPatch(fairB.id, { onlineMarkupBps: 1001, name: `${PFX}renamed` })
    assert(mixed.status === 400 && (await prisma.event.findUniqueOrThrow({ where: { id: fairB.id } })).name === nameBefore, 'a bad markup refuses the whole request: the name is not changed')
    assert(await bpsOf(fairB.id) === 900 && (await logsOf(fairB.id)).length === 1, 'still 900, still one log row')

    const both = await adminPatch(fairB.id, { onlineMarkupBps: 450, name: `${PFX}fair-b-renamed` })
    const after = await prisma.event.findUniqueOrThrow({ where: { id: fairB.id } })
    assert(both.status === 200 && after.onlineMarkupBps === 450 && after.name === `${PFX}fair-b-renamed`, 'markup and name together: both saved')
    const noFields = await adminPatch(fairB.id, { status: 'ACTIVE' })
    assert(noFields.status === 400 && (await prisma.event.findUniqueOrThrow({ where: { id: fairB.id } })).status === 'UPCOMING', '[0] control: a body with no editable fields is still refused, and status is never written')
    const g = await bodyOf(await adminGet(fairB.id))
    assert(g.data?.onlineMarkupBps === 450, 'admin GET shows the markup')
  }

  // ── [6] one transaction ─────────────────────────────────────────────────────────────────────
  console.log('\n[6] the change and its log row are one transaction')
  {
    login(admin.clerkId, ['admin'])
    const before = await bpsOf(fairB.id)
    const logsBefore = (await logsOf(fairB.id)).length
    // Test DB only: make the log insert fail for newBps 777, then remove the trigger.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${TRIGGER_FN}() RETURNS trigger AS $$
      BEGIN IF NEW."newBps" = 777 THEN RAISE EXCEPTION 'omk forced log failure'; END IF; RETURN NEW; END
      $$ LANGUAGE plpgsql`)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${TRIGGER} BEFORE INSERT ON "EventMarkupChange" FOR EACH ROW EXECUTE FUNCTION ${TRIGGER_FN}()`)
    let failed: Response
    try { failed = await adminPatch(fairB.id, { onlineMarkupBps: 777, name: `${PFX}not-saved` }) } finally { await dropTrigger() }
    const ev = await prisma.event.findUniqueOrThrow({ where: { id: fairB.id } })
    assert(failed.status >= 500, `a failed log write fails the request (${failed.status})`)
    assert(ev.onlineMarkupBps === before && ev.name !== `${PFX}not-saved` && (await logsOf(fairB.id)).length === logsBefore,
      'and nothing was saved: markup, name and log all unchanged')
    const control = await adminPatch(fairB.id, { onlineMarkupBps: 777 })
    assert(control.status === 200 && await bpsOf(fairB.id) === 777, '[0] control: without the trigger the same change saves')

    // Two simultaneous changes: the row lock makes them apply one after the other.
    login(A.user.clerkId)
    const [x, y] = await Promise.all([
      orgPatch(fairA.urlSlug, { onlineMarkupBps: 111 }),
      orgPatch(fairA.urlSlug, { onlineMarkupBps: 222 }),
    ])
    const chain = await logsOf(fairA.id)
    const final = await bpsOf(fairA.id)
    const lastTwo = chain.slice(-2)
    assert(x.status === 200 && y.status === 200, 'two simultaneous organizer changes both succeed')
    assert(lastTwo.length === 2 && lastTwo[1].oldBps === lastTwo[0].newBps && final === lastTwo[1].newBps,
      `they chain correctly in the log (${lastTwo.map(l => `${l.oldBps}→${l.newBps}`).join(', ')}; final ${final})`)
  }

  // ════ CHECKOUT ════════════════════════════════════════════════════════════════════════════════
  const rl = await import('../lib/ratelimit')
  const allowAll = { limit: async () => ({ success: true, limit: 999, remaining: 999, reset: Date.now() + 3600e3 }) }
  rl.__setStateForTest({ type: 'ready', limiters: new Proxy({}, { get: () => allowAll }) as never })

  // Stripe is never called: record the PaymentIntent the route would create.
  const { stripe } = await import('../lib/stripe')
  type PiParams = { amount: number; metadata?: Record<string, string> }
  const piCalls: PiParams[] = []
  const pis = stripe.paymentIntents as unknown as {
    create: (p: PiParams) => Promise<unknown>
    update: (...a: unknown[]) => Promise<unknown>
  }
  pis.create = async (p: PiParams) => {
    piCalls.push(p)
    return { id: `pi_${PFX}${rand()}`, client_secret: `pi_${PFX}secret_${rand()}`, metadata: p.metadata ?? {} }
  }
  pis.update = async () => ({})

  const orderPOST = (await import('../app/api/orders/route')).POST as unknown as (r: NextRequest) => Promise<Response>
  const { checkoutTotals, toCents } = await import('../lib/checkout-total')
  const { estimatedStripeFeeCents } = await import('../lib/checkout-floor')
  const { itemizeOrder } = await import('../lib/order-itemization')
  const { readFileSync } = await import('node:fs')

  const mkLiveFair = (tag: string, data: Record<string, unknown> = {}) => prisma.event.create({
    data: {
      name: `${PFX}${tag}`, urlSlug: `${PFX}${tag}-${rand()}`, status: 'ACTIVE',
      startDate: new Date(now - DAY), endDate: new Date(now + DAY),
      fulfillmentConfig: { create: { boothPickupEnabled: true, curbsideEnabled: true, curbsideFee: 3.99 } },
      ...data,
    },
  })
  const mkVendor = (eventId: string, tag: string) => prisma.vendor.create({
    data: { eventId, name: `${PFX}${tag}`, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' },
  })
  const mkItem = (vendorId: string, name: string, p: number) => prisma.menuItem.create({
    data: { vendorId, name: `${PFX}${name}`, price: p, category: 'Mains', isAvailable: true },
  })
  const setMarkup = (eventId: string, bps: number) => prisma.event.update({ where: { id: eventId }, data: { onlineMarkupBps: bps } })

  type Item = { id: string; price: number; vendorId: string }
  type Line = { item: Item; qty: number }
  const customer2 = `${PFX}cust-${rand()}`
  /** What the checkout page shows: the SAME checkoutTotals, from the in-person prices and the markup. */
  const pageTotals = (lines: Line[], bps: number, o: { deliveryFeeCents?: number; serviceChargeCents?: number; tip?: number } = {}) =>
    checkoutTotals({
      lines: lines.map(l => ({ inPersonCents: toCents(l.item.price), quantity: l.qty })),
      markupBps: bps,
      deliveryFeeCents: o.deliveryFeeCents ?? 0,
      serviceChargeCents: o.serviceChargeCents ?? 0,
      tipCents: toCents(o.tip ?? 0),
    })
  type OrderRes = { status: number; code?: string; message?: string; details?: Record<string, unknown>; data?: Record<string, unknown> }
  const place = async (eventId: string, lines: Line[], extra: Record<string, unknown> = {}, itemExtra: Record<string, unknown> = {}): Promise<OrderRes> => {
    login(customer2)
    const res = await orderPOST(new NextRequest('http://localhost/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId, fulfillmentType: 'BOOTH_PICKUP', customerName: 'C', customerPhone: '6185550100',
        items: lines.map(l => ({ menuItemId: l.item.id, vendorId: l.item.vendorId, quantity: l.qty, ...itemExtra })),
        ...extra,
      }),
    }))
    const j = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { code?: string; message?: string; details?: Record<string, unknown> } }
    return { status: res.status, code: j.error?.code, message: j.error?.message, details: j.error?.details, data: j.data }
  }
  const orderOf = (id: unknown) => prisma.order.findUniqueOrThrow({ where: { id: String(id) }, include: { orderItems: true } })
  const ordersIn = (eventId: string) => prisma.order.count({ where: { eventId } })
  const cents = (d: number | null | undefined) => Math.round((d ?? 0) * 100)

  const live = await mkLiveFair('live')
  const V1 = await mkVendor(live.id, 'v1')
  const V2 = await mkVendor(live.id, 'v2')
  const i10 = await mkItem(V1.id, 'ten', 10)
  const i1299 = await mkItem(V2.id, 'twelve99', 12.99)

  // ── [7] checkout at 0% ──────────────────────────────────────────────────────────────────────
  console.log('\n[7] checkout at 0%: the same as before 2h')
  let twoVendorOrderId: unknown = null
  {
    const r = await place(live.id, [{ item: i10, qty: 1 }], { expectedTotalCents: 1100 })
    assert(r.status === 201, `$10.00 item, booth pickup, expected 1100 → 201 (${r.status} ${r.code ?? ''} ${r.message ?? ''})`)
    const o = await orderOf(r.data?.orderId)
    const it = o.orderItems[0]
    assert(o.subtotal === 10 && o.fairSynqFee === 1 && o.total === 11, `subtotal 10.00, fee 1.00, total 11.00 (got ${o.subtotal}, ${o.fairSynqFee}, ${o.total})`)
    assert(o.serviceFeeBase === 10 && o.onlineMarkupBps === 0, 'snapshots: serviceFeeBase 10.00, onlineMarkupBps 0')
    assert(it.unitPrice === 10 && it.inPersonUnitPrice === 10 && it.subtotal === 10, 'item: unitPrice 10.00 = inPersonUnitPrice 10.00')
    const pi = piCalls.at(-1)
    assert(pi?.amount === 1100 && pi.metadata?.serviceFeeBase === '10.00' && pi.metadata?.onlineMarkupBps === '0', 'PaymentIntent 1100¢, metadata serviceFeeBase 10.00, onlineMarkupBps 0')
  }

  // ── [8] checkout at 10% ─────────────────────────────────────────────────────────────────────
  console.log('\n[8] checkout at 10%: online unit price, fee on the in-person price')
  {
    await setMarkup(live.id, 1000)
    const r = await place(live.id, [{ item: i10, qty: 1 }], { expectedTotalCents: 1200 })
    assert(r.status === 201, `$10.00 item at 10%, expected 1200 → 201 (${r.status} ${r.code ?? ''})`)
    const o = await orderOf(r.data?.orderId)
    const it = o.orderItems[0]
    assert(it.unitPrice === 11 && it.subtotal === 11 && it.inPersonUnitPrice === 10, `unit 11.00 online, in-person snapshot 10.00 (got ${it.unitPrice}, ${it.inPersonUnitPrice})`)
    assert(o.subtotal === 11 && o.fairSynqFee === 1 && o.total === 12, `subtotal 11.00, fee 1.00 (NOT 1.10), total 12.00 (got ${o.subtotal}, ${o.fairSynqFee}, ${o.total})`)
    assert(o.serviceFeeBase === 10 && o.onlineMarkupBps === 1000, 'snapshots: serviceFeeBase 10.00, onlineMarkupBps 1000')
    const pi = piCalls.at(-1)
    assert(pi?.amount === 1200 && pi.metadata?.serviceFee === '1.00' && pi.metadata?.serviceFeeBase === '10.00' && pi.metadata?.onlineMarkupBps === '1000',
      'PaymentIntent 1200¢; metadata serviceFee 1.00, serviceFeeBase 10.00, onlineMarkupBps 1000')
    assert(JSON.stringify(JSON.parse(pi?.metadata?.vendorSubtotalCents ?? '{}')) === JSON.stringify({ [V1.id]: 1100 }), 'vendor subtotal 1100¢ (the markup goes to the vendor)')
    assert((r.data?.summary as Record<string, unknown>)?.serviceFee === 1 && (r.data?.summary as Record<string, unknown>)?.total === 12, 'response summary: fee 1.00, total 12.00')

    const lines = [{ item: i10, qty: 1 }, { item: i1299, qty: 1 }]
    const expected = pageTotals(lines, 1000).totalCents
    assert(expected === 2759, `two vendors: page total 2759¢ = 1100 + 1429 food + 230 fee (got ${expected})`)
    const r2 = await place(live.id, lines, { expectedTotalCents: expected })
    assert(r2.status === 201, `two-vendor order → 201 (${r2.status} ${r2.code ?? ''})`)
    const o2 = await orderOf(r2.data?.orderId)
    twoVendorOrderId = o2.id
    const byVendor = (v: string) => o2.orderItems.filter(x => x.vendorId === v).reduce((s, x) => s + cents(x.subtotal), 0)
    assert(byVendor(V1.id) === 1100 && byVendor(V2.id) === 1429, `each vendor's line total includes its markup: V1 1100¢, V2 1429¢ ($12.99 → $14.29) (got ${byVendor(V1.id)}, ${byVendor(V2.id)})`)
    assert(o2.serviceFeeBase === 22.99 && o2.fairSynqFee === 2.3 && o2.total === 27.59, `fee 2.30 on the in-person 22.99, total 27.59 (got ${o2.fairSynqFee} on ${o2.serviceFeeBase}, ${o2.total})`)
    assert(cents(o2.subtotal) + cents(o2.fairSynqFee) + cents(o2.deliveryFee) + cents(o2.serviceCharge) + cents(o2.tip) === cents(o2.total), 'the 5-term identity holds')
    assert(piCalls.at(-1)?.amount === 2759, 'PaymentIntent 2759¢')
  }

  // ── [9] checkout floor uses the online subtotal ─────────────────────────────────────────────
  console.log('\n[9] the checkout floor uses the online subtotal')
  {
    // $1.00 item + $23.22 service charge. At 0%: food 100¢, total 2432¢, estimate 101¢ → refused.
    // At 10%: food 110¢, total 2442¢, estimate 101¢ → passes, only because of the markup.
    assert(estimatedStripeFeeCents(2432) === 101 && estimatedStripeFeeCents(2442) === 101, 'estimates: 2432¢ → 101¢, 2442¢ → 101¢')
    const f2 = await mkLiveFair('floor', { serviceChargeEnabled: true, serviceChargeAmount: 23.22 })
    const v3 = await mkVendor(f2.id, 'v3')
    const one = await mkItem(v3.id, 'one', 1)
    const line = [{ item: one, qty: 1 }]
    const at0 = await place(f2.id, line, { expectedTotalCents: pageTotals(line, 0, { serviceChargeCents: 2322 }).totalCents })
    assert(at0.status === 400 && at0.code === 'ORDER_BELOW_PROCESSING_FEE', `at 0%: food 100¢ < estimate 101¢ → 400 ORDER_BELOW_PROCESSING_FEE (got ${at0.status} ${at0.code})`)
    await setMarkup(f2.id, 1000)
    const exp10 = pageTotals(line, 1000, { serviceChargeCents: 2322 }).totalCents
    const at10 = await place(f2.id, line, { expectedTotalCents: exp10 })
    assert(exp10 === 2442 && at10.status === 201, `at 10%: online food 110¢ ≥ estimate 101¢ → passes and is placed (total ${exp10}¢, got ${at10.status} ${at10.code ?? ''})`)

    // $1.00 + $26.56 at 10%: food 110¢, total 2776¢, estimate 111¢ → still refused.
    assert(estimatedStripeFeeCents(2776) === 111, 'estimate: 2776¢ → 111¢')
    const f3 = await mkLiveFair('floor2', { serviceChargeEnabled: true, serviceChargeAmount: 26.56, onlineMarkupBps: 1000 })
    const v4 = await mkVendor(f3.id, 'v4')
    const one2 = await mkItem(v4.id, 'one', 1)
    const line2 = [{ item: one2, qty: 1 }]
    const still = await place(f3.id, line2, { expectedTotalCents: pageTotals(line2, 1000, { serviceChargeCents: 2656 }).totalCents })
    assert(still.status === 400 && still.code === 'ORDER_BELOW_PROCESSING_FEE', `at 10%: online food 110¢ < estimate 111¢ → still 400 (got ${still.status} ${still.code})`)
    assert(await ordersIn(f3.id) === 0, 'no Order row for the refused order')
  }

  // ── [10] refunds use what the customer paid ─────────────────────────────────────────────────
  console.log('\n[10] refunds at 10% use the stored line totals (what the customer paid)')
  {
    const o2 = await orderOf(twoVendorOrderId)
    // Exactly as lib/process-refund.ts derives each vendor's refund slice: Σ stored OrderItem.subtotal.
    const slices: Record<string, number> = {}
    for (const x of o2.orderItems) slices[x.vendorId] = (slices[x.vendorId] ?? 0) + cents(x.subtotal)
    const sliceSum = Object.values(slices).reduce((s, c) => s + c, 0)
    assert(slices[V1.id] === 1100 && slices[V2.id] === 1429, 'refund slices are the online amounts paid: V1 1100¢, V2 1429¢')
    assert(sliceSum + cents(o2.fairSynqFee) + cents(o2.deliveryFee) + cents(o2.serviceCharge) + cents(o2.tip) === cents(o2.total),
      'process-refund\'s charge identity holds on the stored 10% order (slices + fee + extras = charge)')
    const full = itemizeOrder({
      fulfillmentType: o2.fulfillmentType, subtotal: o2.subtotal, fairSynqFee: o2.fairSynqFee, deliveryFee: o2.deliveryFee,
      serviceCharge: o2.serviceCharge, tip: o2.tip, total: o2.total, orderItems: o2.orderItems,
      refunds: [{ vendorId: V1.id, status: 'COMPLETED', amountCents: 1100 }, { vendorId: V2.id, status: 'COMPLETED', amountCents: 1429 }],
    })
    assert(full.reconciles && full.refundedCents === 2529 && full.fullCancel, `the receipt reconciles, a full food refund is 2529¢ and counts as a full cancel (got ${full.refundedCents})`)
    const src = readFileSync('lib/process-refund.ts', 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert(/orderItems: \{ select: \{ vendorId: true, subtotal: true \} \}/.test(src) && !/menuItem/.test(src) && !/\.price\b/.test(src),
      'lib/process-refund.ts reads the stored orderItems.subtotal and never a live menu price (unchanged)')
  }

  // ── [11] client-sent prices refused ─────────────────────────────────────────────────────────
  console.log('\n[11] client-sent prices are refused')
  {
    const vm = await mkUser('vmember')
    await prisma.vendorMember.create({ data: { vendorId: V1.id, userId: vm.id, role: 'owner', approvalStatus: 'APPROVED' } })
    const menuPOST = (await import('../app/api/menu/route')).POST as unknown as (r: Request) => Promise<Response>
    const menuPATCH = (await import('../app/api/menu/[id]/route')).PATCH as unknown as (r: Request, c: unknown) => Promise<Response>
    const reqPOST = (await import('../app/api/menu-requests/route')).POST as unknown as (r: NextRequest) => Promise<Response>
    const json = (url: string, method: string, body: unknown) => new NextRequest(`http://localhost${url}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    login(vm.clerkId)
    const c1 = await menuPOST(json('/api/menu', 'POST', { vendorId: V1.id, name: `${PFX}sneaky`, price: 5, category: 'Mains', onlinePrice: 5.5 }))
    const c1b = await bodyOf(c1)
    assert(c1.status === 400 && c1b.error?.code === 'CLIENT_PRICE_NOT_ACCEPTED', `menu create with onlinePrice → 400 CLIENT_PRICE_NOT_ACCEPTED (got ${c1.status} ${c1b.error?.code})`)
    assert(await prisma.menuItem.count({ where: { name: `${PFX}sneaky` } }) === 0 && await prisma.menuRequest.count({ where: { name: `${PFX}sneaky` } }) === 0, 'nothing created or filed')
    const e1 = await menuPATCH(json(`/api/menu/${i10.id}`, 'PATCH', { price: 9, onlineMarkupBps: 1000 }), { params: Promise.resolve({ id: i10.id }) })
    assert(e1.status === 400 && (await bodyOf(e1)).error?.code === 'CLIENT_PRICE_NOT_ACCEPTED', `menu edit with onlineMarkupBps → 400 (got ${e1.status})`)
    assert((await prisma.menuItem.findUniqueOrThrow({ where: { id: i10.id } })).price === 10, 'the item price is unchanged (10.00)')
    const m1 = await reqPOST(json('/api/menu-requests', 'POST', { vendorId: V1.id, type: 'EDIT', menuItemId: i10.id, price: 9, markup: 0.1 }))
    assert(m1.status === 400 && (await bodyOf(m1)).error?.code === 'CLIENT_PRICE_NOT_ACCEPTED', `menu request with markup → 400 (got ${m1.status})`)
    assert(await prisma.menuRequest.count({ where: { vendorId: V1.id } }) === 0, 'no menu request filed')

    const before = await ordersIn(live.id), piBefore = piCalls.length
    const exp = pageTotals([{ item: i10, qty: 1 }], 1000).totalCents
    for (const [label, itemExtra] of [['price: 0.01', { price: 0.01 }], ['unitPrice: 0.01', { unitPrice: 0.01 }], ['onlinePrice: 1', { onlinePrice: 1 }]] as const) {
      const r = await place(live.id, [{ item: i10, qty: 1 }], { expectedTotalCents: exp }, itemExtra)
      assert(r.status === 400 && r.code === 'CLIENT_PRICE_NOT_ACCEPTED', `checkout line with ${label} → 400 CLIENT_PRICE_NOT_ACCEPTED (got ${r.status} ${r.code})`)
    }
    const b1 = await place(live.id, [{ item: i10, qty: 1 }], { expectedTotalCents: exp, onlineMarkupBps: 0 })
    assert(b1.status === 400 && b1.code === 'CLIENT_PRICE_NOT_ACCEPTED', `checkout body with onlineMarkupBps → 400 (got ${b1.status} ${b1.code})`)
    assert(await ordersIn(live.id) === before && piCalls.length === piBefore, 'nothing written, nothing sent to Stripe')
  }

  // ── [12] never charge more than the customer saw ────────────────────────────────────────────
  console.log('\n[12] the safety net: a changed total is refused until the customer confirms')
  {
    const f4 = await mkLiveFair('net')
    const v5 = await mkVendor(f4.id, 'v5')
    const ten = await mkItem(v5.id, 'ten', 10)
    const line = [{ item: ten, qty: 1 }]
    const shown = pageTotals(line, 0).totalCents
    assert(shown === 1100, 'customer adds a $10.00 item at 0%: the page shows $11.00 (1100¢)')

    login(admin.clerkId, ['admin'])
    const raise = await adminPatch(f4.id, { onlineMarkupBps: 1000 })
    assert(raise.status === 200 && await bpsOf(f4.id) === 1000, 'a strict admin raises the markup to 10% while it sits in the cart')

    const piBefore = piCalls.length
    const r = await place(f4.id, line, { expectedTotalCents: shown })
    assert(r.status === 409 && r.code === 'PRICE_CHANGED', `checkout with the old total → 409 PRICE_CHANGED (got ${r.status} ${r.code})`)
    assert(r.details?.newTotalCents === 1200 && r.details?.newTotal === 12 && r.details?.expectedTotalCents === 1100, `returns the new total 1200¢ ($12.00) (got ${r.details?.newTotalCents})`)
    const bd = r.details?.breakdown as Record<string, unknown> | undefined
    assert(bd?.subtotal === 11 && bd?.serviceFee === 1 && bd?.total === 12 && bd?.onlineMarkupBps === 1000, 'with the new breakdown: food 11.00, fee 1.00, total 12.00')
    assert(r.message === 'Prices updated — new total $12.00', `message: "${r.message}"`)
    assert(await ordersIn(f4.id) === 0 && piCalls.length === piBefore, 'nothing written, nothing charged (no Order row, no PaymentIntent)')

    const higher = await place(f4.id, line, { expectedTotalCents: 1250 })
    const lower = await place(f4.id, line, { expectedTotalCents: 1150 })
    assert(higher.status === 409 && higher.code === 'PRICE_CHANGED' && lower.status === 409 && lower.code === 'PRICE_CHANGED',
      'any difference is refused: a shown total of 1250¢ or 1150¢ (real 1200¢) → 409 both')
    assert(await ordersIn(f4.id) === 0 && piCalls.length === piBefore, 'still nothing written or charged')
    const confirmed = await place(f4.id, line, { expectedTotalCents: r.details?.newTotalCents })
    assert(confirmed.status === 201 && piCalls.at(-1)?.amount === 1200 && (await orderOf(confirmed.data?.orderId)).total === 12,
      `the customer confirms the new total → 201, charged exactly 1200¢ (got ${confirmed.status})`)
    const again = await place(f4.id, line, { expectedTotalCents: 1200 })
    assert(again.status === 201, '[0] control: a matching total checks out normally')

    const ordersNow = await ordersIn(f4.id), piNow = piCalls.length
    for (const [label, v] of [['missing', undefined], ['1200.5', 1200.5], ['"1200"', '1200'], ['-1', -1], ['null', null]] as const) {
      const res = await place(f4.id, line, v === undefined ? {} : { expectedTotalCents: v })
      assert(res.status === 400 && res.code === 'VALIDATION_ERROR', `expectedTotalCents ${label} → 400 (got ${res.status} ${res.code})`)
    }
    assert(await ordersIn(f4.id) === ordersNow && piCalls.length === piNow, 'none of those wrote or charged anything')
  }

  // ── [13] page total == server total ─────────────────────────────────────────────────────────
  console.log('\n[13] the page and the server always agree (no false PRICE_CHANGED)')
  {
    await setMarkup(live.id, 1000)
    const a = await mkItem(V1.id, 'a333', 3.33)
    const b = await mkItem(V1.id, 'b715', 7.15)
    const lines = [{ item: a, qty: 3 }, { item: b, qty: 1 }, { item: i1299, qty: 2 }]
    const curb = { fulfillmentType: 'CURBSIDE', vehicleMake: 'Honda', vehicleColor: 'Blue' }
    const food = pageTotals(lines, 1000).onlineSubtotalCents
    const tip15 = (food / 100) * 0.15 // 15% of the food, as a raw dollar number with fractional cents
    assert(!Number.isInteger(tip15 * 100), `the 15% tip has fractional cents ($${tip15})`)
    const page = pageTotals(lines, 1000, { deliveryFeeCents: 399, tip: tip15 })
    const r = await place(live.id, lines, { ...curb, tip: tip15, expectedTotalCents: page.totalCents })
    assert(r.status === 201, `two vendors, curbside $3.99, 15% tip, $3.33×3 + $7.15 + $12.99×2 at 10% → 201, no false 409 (${r.status} ${r.code ?? ''} ${r.message ?? ''})`)
    const o = await orderOf(r.data?.orderId)
    assert(cents(o.total) === page.totalCents && piCalls.at(-1)?.amount === page.totalCents, `charged exactly the page total, ${page.totalCents}¢`)
    assert(cents(o.tip) === toCents(tip15) && o.deliveryFee === 3.99, 'tip and curbside fee as the page showed them')

    const custom = pageTotals(lines, 1000, { deliveryFeeCents: 399, tip: 3.335 })
    const r2 = await place(live.id, lines, { ...curb, tip: 3.335, expectedTotalCents: custom.totalCents })
    assert(r2.status === 201 && cents((await orderOf(r2.data?.orderId)).total) === custom.totalCents, `a 3-decimal custom tip (3.335) → 201, same total on both sides (${r2.status} ${r2.code ?? ''})`)

    // A grid: varied prices, quantities, markups, fulfillment and tips, through the real route.
    const pricesPool = [1, 1.05, 2.49, 3.33, 4.35, 7.15, 9.95, 12.99, 19.99, 99.99]
    const pool: Item[] = []
    for (const [i, p] of pricesPool.entries()) pool.push(await mkItem(i % 2 ? V2.id : V1.id, `g${i}`, p))
    const markups = [0, 1, 250, 333, 715, 820, 999, 1000]
    let seed = 20261115
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    let agreed = 0, runs = 0
    const misses: string[] = []
    for (let k = 0; k < 24; k++) {
      const bps = markups[rnd(markups.length)]
      await setMarkup(live.id, bps)
      const n = 1 + rnd(4)
      const gl: Line[] = []
      for (let j = 0; j < n; j++) gl.push({ item: pool[rnd(pool.length)], qty: 1 + rnd(3) })
      const curbside = rnd(2) === 1
      const tip = curbside ? (rnd(1000) / 100) + (rnd(10) / 1000) : 0
      const exp = pageTotals(gl, bps, { deliveryFeeCents: curbside ? 399 : 0, tip }).totalCents
      const res = await place(live.id, gl, { ...(curbside ? { ...curb, tip } : {}), expectedTotalCents: exp })
      runs++
      if (res.status === 201 && cents((await orderOf(res.data?.orderId)).total) === exp) agreed++
      else misses.push(`#${k} bps ${bps} → ${res.status} ${res.code ?? ''} ${res.message ?? ''}`)
    }
    assert(agreed === runs && runs === 24, `grid: ${agreed}/${runs} orders placed at exactly the page total${misses.length ? ` (misses: ${misses.join('; ')})` : ''}`)
  }

  // ── [14] the largest order the route accepts ────────────────────────────────────────────────
  // Limits (Jordan, Nov 17; lib/order-limits.ts): at most MAX_ITEMS_PER_ORDER (15) items in all and
  // MAX_QTY_PER_ITEM (5) of one dish. The older line cap (`items.length > 20` → 400) still answers
  // first for 21+ lines. There is NO vendor cap (MAX_VENDORS_PER_ORDER is dead; Event.maxVendorsPerOrder
  // is a stored setting the route never reads), so the largest order is 15 lines from 15 vendors.
  const { MAX_ITEMS_PER_ORDER } = await import('../lib/order-limits')
  console.log(`\n[14] the largest order: ${MAX_ITEMS_PER_ORDER} lines from ${MAX_ITEMS_PER_ORDER} vendors, 10%, curbside, tip`)
  {
    const MAX_LINES = MAX_ITEMS_PER_ORDER
    const LINE_CAP = 20
    const fmax = await mkLiveFair('max', { onlineMarkupBps: 1000 })
    const maxItems: Item[] = []
    for (let i = 0; i < LINE_CAP + 1; i++) {
      const v = await mkVendor(fmax.id, `mv${i}`)
      // Varied, awkward prices: $1.05, $2.42, $3.79, …, so rounding is exercised on every line.
      const p = Math.round((1.05 + i * 1.37) * 100) / 100
      maxItems.push(await mkItem(v.id, `m${i}`, p))
    }
    const lines: Line[] = maxItems.slice(0, MAX_LINES).map(item => ({ item, qty: 1 }))
    const curb = { fulfillmentType: 'CURBSIDE', vehicleMake: 'Honda', vehicleColor: 'Blue' }
    const tip = 12.345
    const page = pageTotals(lines, 1000, { deliveryFeeCents: 399, tip })
    const piBefore = piCalls.length

    const r = await place(fmax.id, lines, { ...curb, tip, expectedTotalCents: page.totalCents })
    assert(r.status === 201, `${MAX_LINES} lines from ${MAX_LINES} vendors at 10%, curbside, $12.345 tip → 201 (${r.status} ${r.code ?? ''} ${r.message ?? ''})`)
    const o = await orderOf(r.data?.orderId)
    assert(new Set(o.orderItems.map(x => x.vendorId)).size === MAX_LINES, `${MAX_LINES} distinct vendors on the order`)

    const ownMarkup = lines.every(l => {
      const row = o.orderItems.find(x => x.vendorId === l.item.vendorId)
      return row !== undefined && cents(row.subtotal) === price.onlinePriceCents(toCents(l.item.price), 1000) && row.inPersonUnitPrice === l.item.price
    })
    assert(ownMarkup, 'each vendor\'s subtotal is its own item at its own 10% online price (in-person snapshot kept per line)')

    const inPersonTotal = lines.reduce((s, l) => s + toCents(l.item.price), 0)
    const onlineTotal = lines.reduce((s, l) => s + price.onlinePriceCents(toCents(l.item.price), 1000), 0)
    assert(cents(o.serviceFeeBase) === inPersonTotal && cents(o.fairSynqFee) === Math.round(inPersonTotal * 0.1),
      `fee ${cents(o.fairSynqFee)}¢ = 10% of the combined in-person total ${inPersonTotal}¢`)
    assert(cents(o.fairSynqFee) !== Math.round(onlineTotal * 0.1), `[0] control: and not 10% of the online total ${onlineTotal}¢ (${Math.round(onlineTotal * 0.1)}¢)`)
    assert(cents(o.subtotal) === onlineTotal && cents(o.deliveryFee) === 399 && cents(o.tip) === toCents(tip), 'food = Σ online lines; curbside 3.99; tip as shown')
    assert(cents(o.total) === page.totalCents, `server total ${cents(o.total)}¢ == page total ${page.totalCents}¢ exactly`)
    const pi = piCalls.at(-1)
    assert(piCalls.length === piBefore + 1 && pi?.amount === page.totalCents, `PaymentIntent amount ${pi?.amount}¢ matches`)
    const piSlices = JSON.parse(pi?.metadata?.vendorSubtotalCents ?? '{}') as Record<string, number>
    assert(lines.every(l => piSlices[l.item.vendorId] === price.onlinePriceCents(toCents(l.item.price), 1000)), 'PaymentIntent vendorSubtotalCents carries each vendor\'s online amount')

    // Refund slices exactly as lib/process-refund.ts derives them: Σ stored OrderItem.subtotal per vendor.
    const slices: Record<string, number> = {}
    for (const x of o.orderItems) slices[x.vendorId] = (slices[x.vendorId] ?? 0) + cents(x.subtotal)
    const sliceSum = Object.values(slices).reduce((s, c) => s + c, 0)
    assert(Object.keys(slices).length === MAX_LINES && sliceSum === cents(o.subtotal), `${MAX_LINES} refund slices add up to the food total (${sliceSum}¢ = ${cents(o.subtotal)}¢)`)
    assert(sliceSum + cents(o.fairSynqFee) + cents(o.deliveryFee) + cents(o.serviceCharge) + cents(o.tip) === cents(o.total), 'slices + fee + curbside + tip = the charge')

    // FINDING, printed and NOT a pass/fail check (Jordan, Nov 17): Stripe limits each metadata value
    // to 500 characters and the recorder above accepts anything. vendorSubtotalCents is
    // 436 + 15 × (digits of each vendor's cents) at 15 vendors with 25-char cuids: 541 chars at
    // $10,000 per booth, over 500 once ~5 of 15 booths exceed $100 (real Stripe would refuse the
    // PaymentIntent: no charge, no Order row, it fails closed). This order's small test prices stay
    // under, so a pass here would prove nothing. Pre-existing (the old 20-line cap was worse). Fix:
    // drop vendorSubtotalCents from the PaymentIntent metadata, its own step (progress note, "Stripe
    // metadata at 15 booths").
    const vscLen = (pi?.metadata?.vendorSubtotalCents ?? '').length
    const vidLen = (pi?.metadata?.vendorIds ?? '').length
    console.log(`  ⚠️  FINDING (not counted): at ${MAX_LINES} vendors this order's PaymentIntent metadata is vendorSubtotalCents ${vscLen} chars, vendorIds ${vidLen} chars (Stripe's limit: 500 per value; 541 at $10,000 per booth)`)

    // One over the item limit: refused at validation, before anything is read, written or charged.
    const over16: Line[] = maxItems.slice(0, MAX_LINES + 1).map(item => ({ item, qty: 1 }))
    const before16 = await ordersIn(fmax.id), pi16 = piCalls.length
    const page16 = pageTotals(over16, 1000, { deliveryFeeCents: 399, tip })
    const r16 = await place(fmax.id, over16, { ...curb, tip, expectedTotalCents: page16.totalCents })
    assert(over16.length === MAX_LINES + 1 && r16.status === 400 && r16.code === 'ORDER_ITEM_LIMIT',
      `${MAX_LINES + 1} lines → 400 ORDER_ITEM_LIMIT (got ${r16.status} ${r16.code} "${r16.message}")`)
    assert(await ordersIn(fmax.id) === before16 && piCalls.length === pi16, `${MAX_LINES + 1} lines: nothing written, nothing sent to Stripe`)

    // One over the older line cap: refused at validation, before anything is read, written or charged.
    const over: Line[] = maxItems.map(item => ({ item, qty: 1 }))
    const ordersBefore = await ordersIn(fmax.id), piNow = piCalls.length
    const overPage = pageTotals(over, 1000, { deliveryFeeCents: 399, tip })
    const r21 = await place(fmax.id, over, { ...curb, tip, expectedTotalCents: overPage.totalCents })
    assert(over.length === LINE_CAP + 1 && r21.status === 400 && r21.code === 'VALIDATION_ERROR' && r21.message === 'Cart cannot exceed 20 items',
      `21 lines → 400 "Cart cannot exceed 20 items" (got ${r21.status} ${r21.code} "${r21.message}")`)
    assert(await ordersIn(fmax.id) === ordersBefore && piCalls.length === piNow, 'nothing written, nothing sent to Stripe')
  }

  // ── [15] customer price readers (step 5, screen 1) ──────────────────────────────────────────
  console.log('\n[15] every price a customer is sent is the online price')
  {
    const { onlineUnitCents, onlineUnitPrice, checkoutTotals: ct } = await import('../lib/checkout-total')
    const grouped = await import('../lib/menu/getGroupedMenuItems')
    const vendorRoute = (await import('../app/api/vendors/[id]/route')).GET as unknown as (r: NextRequest, c: unknown) => Promise<Response>
    const itemRoute = (await import('../app/api/menu/[id]/route')).GET as unknown as (r: Request, c: unknown) => Promise<Response>
    const favRoute = (await import('../app/api/favorites/route')).GET as unknown as () => Promise<Response>
    const eventRoute = (await import('../app/api/events/[slug]/route')).GET as unknown as (r: NextRequest, c: unknown) => Promise<Response>
    const { getFairBySlugCached } = await import('../lib/fairs')

    // One calculator: the display function and the checkout calculator give the same unit price.
    const sameAsCheckout = [100, 105, 333, 715, 1299, 99999].every(c =>
      [0, 1, 715, 1000].every(b => onlineUnitCents(c, b) === ct({ lines: [{ inPersonCents: c, quantity: 1 }], markupBps: b, deliveryFeeCents: 0, serviceChargeCents: 0, tipCents: 0 }).unitCents[0]))
    assert(sameAsCheckout, 'onlineUnitCents (menus, cart) and checkoutTotals (checkout) give the same unit price for every case')
    assert(onlineUnitPrice(12.99, 1000) === 14.29 && onlineUnitPrice(10, 0) === 10, 'onlineUnitPrice: $12.99 at 10% → $14.29; $10 at 0% → $10')

    await setMarkup(live.id, 1000)
    const variantOf = (groups: Array<{ variants: Array<{ id: string; price: number; inPersonPrice: number }> }>, id: string) =>
      groups.flatMap(g => g.variants).find(v => v.id === id)
    const byVendor = variantOf(await grouped.getGroupedMenuItemsByVendor(V1.id), i10.id)
    assert(byVendor?.price === 11 && byVendor.inPersonPrice === 10, `menu by vendor at 10%: price 11.00 (online), inPersonPrice 10.00 (got ${byVendor?.price} / ${byVendor?.inPersonPrice})`)
    const byEvent = variantOf(await grouped.getGroupedMenuItemsByEvent(live.urlSlug), i1299.id)
    assert(byEvent?.price === 14.29 && byEvent.inPersonPrice === 12.99, `fair menu at 10%: price 14.29, inPersonPrice 12.99 (got ${byEvent?.price} / ${byEvent?.inPersonPrice})`)

    login(null)
    const vb = await bodyOf(await vendorRoute(new NextRequest(`http://localhost/api/vendors/${V1.id}`), { params: Promise.resolve({ id: V1.id }) }))
    const vItem = (vb.data?.menuItems as Array<{ id: string; price: number; inPersonPrice: number }> | undefined)?.find(m => m.id === i10.id)
    assert(vItem?.price === 11 && vItem.inPersonPrice === 10, `public vendor detail: price 11.00, inPersonPrice 10.00 (got ${vItem?.price} / ${vItem?.inPersonPrice})`)
    assert(vb.data !== undefined && !('event' in vb.data) && !('onlineMarkupBps' in vb.data) && !('stripeVerified' in vb.data), 'and the public vendor payload gained no other field (no event, no markup, gate field still stripped)')

    const ib = await bodyOf(await itemRoute(new Request(`http://localhost/api/menu/${i10.id}`), { params: Promise.resolve({ id: i10.id }) }))
    assert(ib.data?.price === 11 && ib.data?.inPersonPrice === 10 && (ib.data?.vendor as { id?: string } | undefined)?.id === V1.id,
      `public item lookup: price 11.00, inPersonPrice 10.00, vendor kept (got ${ib.data?.price} / ${ib.data?.inPersonPrice})`)

    const cust = await prisma.user.findFirstOrThrow({ where: { clerkId: customer2 } })
    await prisma.favoriteItem.create({ data: { userId: cust.id, menuItemId: i10.id } })
    login(customer2)
    const fb = await bodyOf(await favRoute())
    type Fav = { menuItem: { id: string; price: number; inPersonPrice: number; vendor: { event: Record<string, unknown> } } }
    const fav = (fb.data?.favorites as Fav[] | undefined)?.find(f => f.menuItem.id === i10.id)
    assert(fav?.menuItem.price === 11 && fav.menuItem.inPersonPrice === 10, `favorites: price 11.00 (what the page shows), inPersonPrice 10.00 (got ${fav?.menuItem.price})`)
    assert(fav !== undefined && JSON.stringify(Object.keys(fav.menuItem.vendor.event).sort()) === '["name","urlSlug"]', 'favorites: the event keeps only urlSlug and name (the markup is not sent)')

    const eb = await bodyOf(await eventRoute(new NextRequest(`http://localhost/api/events/${live.urlSlug}`), { params: Promise.resolve({ slug: live.urlSlug }) }))
    assert(eb.data?.onlineMarkupBps === 1000, `public event payload carries onlineMarkupBps for the calculator (got ${eb.data?.onlineMarkupBps})`)
    const fd = await getFairBySlugCached(live.urlSlug)
    assert(fd?.onlineMarkupBps === 1000, `server-rendered fair data carries onlineMarkupBps (got ${fd?.onlineMarkupBps})`)
    const ctx = readFileSync('app/_contexts/FairContext.tsx', 'utf8').replace(/\r\n/g, '\n')
    assert(/onlineMarkupBps: typeof raw\.onlineMarkupBps === 'number' \? raw\.onlineMarkupBps : 0,/.test(ctx), 'the client fair context keeps it (missing → 0, which can only make the page total LOWER, answered by 409)')

    await setMarkup(live.id, 0)
    const at0 = variantOf(await grouped.getGroupedMenuItemsByVendor(V1.id), i10.id)
    assert(at0?.price === 10 && at0.inPersonPrice === 10, '[0] control: at 0% the online price equals the in-person price')

    // Customer screens show only the online price: no customer file formats inPersonPrice for display.
    const { readdirSync, statSync } = await import('node:fs')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => {
      const p = `${dir}/${n}`
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []
    })
    const customerFiles = [...walk('app/fair'), ...walk('components/menu'), ...walk('app/account'), 'components/ui/FoodCard.tsx']
    const shows = customerFiles.filter(f => /inPersonPrice[^\n]*toFixed|toFixed[^\n]*inPersonPrice|\{[^}\n]*inPersonPrice[^}\n]*\}\s*<\/|>\s*\$?\{[^}\n]*inPersonPrice/.test(readFileSync(f, 'utf8')))
    assert(customerFiles.length > 20 && shows.length === 0, `no customer screen displays inPersonPrice (${customerFiles.length} files scanned${shows.length ? `; found in ${shows.join(', ')}` : ''})`)
  }

  // ── [16] the cart (step 5, screen 2) ────────────────────────────────────────────────────────
  console.log('\n[16] the cart prices with the same calculator; old saved carts never overcharge')
  {
    const { cartPricing, cartCalculatorLines, cartInPersonCents, safeMarkupBps, checkoutTotals: ct } = await import('../lib/checkout-total')
    await setMarkup(live.id, 1000)

    // A line added after this change carries inPersonPrice.
    const modern = { menuItemId: i10.id, price: 11, inPersonPrice: 10, quantity: 2 }
    const p = cartPricing([modern], 1000)
    assert(p.unitCents[i10.id] === 1100 && p.lineCents[i10.id] === 2200 && p.onlineSubtotalCents === 2200, 'cart at 10%: $10 in-person ×2 → $11.00 each, $22.00 line, $22.00 subtotal')
    assert(safeMarkupBps(undefined) === 0 && safeMarkupBps(1500) === 0 && safeMarkupBps(2.5) === 0 && safeMarkupBps('1000') === 0 && safeMarkupBps(1000) === 1000,
      'a missing or invalid markup counts as 0 (lower page total → 409, never an overcharge)')
    assert(cartInPersonCents({ menuItemId: 'x', price: 7, inPersonPrice: Number.NaN, quantity: 1 }) === 700, 'a broken inPersonPrice falls back to the stored price')

    // The checkout page will total the cart exactly like this (screen 3): checkoutTotals on the
    // cart's calculator lines and the fair's markup.
    const pageTotal = (items: Array<{ menuItemId: string; price: number; inPersonPrice?: number; quantity: number }>) =>
      ct({ lines: cartCalculatorLines(items), markupBps: 1000, deliveryFeeCents: 0, serviceChargeCents: 0, tipCents: 0 }).totalCents
    const asLines = (items: Array<{ quantity: number }>) => [{ item: i10, qty: items[0].quantity }]

    // Old cart A, saved BEFORE 2h (0% markup everywhere): no inPersonPrice, stored price = $10.
    const oldA = [{ menuItemId: i10.id, price: 10, quantity: 1 }]
    const totalA = pageTotal(oldA)
    const rA = await place(live.id, asLines(oldA), { expectedTotalCents: totalA })
    assert(totalA === 1200 && rA.status === 201 && piCalls.at(-1)?.amount === 1200,
      `old cart saved before 2h: shows $12.00, the server agrees, placed and charged 1200¢ (no 409) (${rA.status} ${rA.code ?? ''})`)

    // Old cart B: no inPersonPrice but its stored price is an online $11 (a line that somehow lost
    // its in-person price). The page counts $11 as in-person and shows MORE than the real total.
    const oldB = [{ menuItemId: i10.id, price: 11, quantity: 1 }]
    const totalB = pageTotal(oldB)
    const before = await ordersIn(live.id), piBefore = piCalls.length
    const rB = await place(live.id, asLines(oldB), { expectedTotalCents: totalB })
    // $11 counted as in-person → $12.10 online + 10% fee on $11 ($1.10) = $13.20 shown.
    assert(totalB === 1320 && rB.status === 409 && rB.code === 'PRICE_CHANGED' && rB.details?.newTotalCents === 1200,
      `old cart with an online stored price: page shows $13.20, server refuses 409 with the real $12.00 (shown ${totalB}; ${rB.status} ${rB.code} ${rB.details?.newTotalCents})`)
    assert(await ordersIn(live.id) === before && piCalls.length === piBefore, 'nothing written, nothing charged')
    const confirmB = await place(live.id, asLines(oldB), { expectedTotalCents: rB.details?.newTotalCents })
    assert(confirmB.status === 201 && piCalls.at(-1)?.amount === 1200 && 1200 <= totalB,
      'the customer confirms the server\'s total → charged 1200¢, never more than was shown')

    // "Order again" works from the stored snapshot: the order API returns inPersonUnitPrice.
    const orderGET = (await import('../app/api/orders/[id]/route')).GET as unknown as (r: NextRequest, c: unknown) => Promise<Response>
    login(customer2)
    const og = await bodyOf(await orderGET(new NextRequest(`http://localhost/api/orders/${String(confirmB.data?.orderId)}`), { params: Promise.resolve({ id: String(confirmB.data?.orderId) }) }))
    const oi = (og.data?.orderItems as Array<{ unitPrice: number; inPersonUnitPrice: number | null }> | undefined)?.[0]
    assert(oi?.unitPrice === 11 && oi.inPersonUnitPrice === 10, `the order API gives "Order again" the in-person price: unitPrice 11.00, inPersonUnitPrice 10.00 (got ${oi?.unitPrice} / ${oi?.inPersonUnitPrice})`)

    // Source checks (no browser test framework in this repo).
    const src = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    const ctx = src('app/_contexts/FairCartContext.tsx')
    assert(/cartPricing\(state\.items, markupBps\)/.test(ctx) && /cartCalculatorLines\(state\.items\)/.test(ctx) && /safeMarkupBps\(fair\.onlineMarkupBps\)/.test(ctx),
      'cart context: prices with cartPricing / cartCalculatorLines and the fair\'s markup')
    assert(!/\.price \* /.test(ctx) && !/\* i\.quantity/.test(ctx), 'cart context: no price × quantity maths of its own')
    assert(/inPersonPrice: menuItem\.inPersonPrice/.test(ctx), 'cart context: stores inPersonPrice when an item is added')
    assert(/Number\.isInteger\(i\.quantity\) && i\.quantity >= 1/.test(ctx), 'cart context: a saved cart is filtered to lines the calculator can price')
    const cartPage = src('app/fair/[fairSlug]/cart/page.tsx')
    assert(/pricing\.unitCents\[item\.menuItemId\]/.test(cartPage) && /pricing\.lineCents\[item\.menuItemId\]/.test(cartPage), 'cart page: unit and line prices come from the cart\'s pricing')
    assert(!/item\.price/.test(cartPage) && !/inPersonPrice/.test(cartPage), 'cart page: never shows the stored price or the in-person price')
    assert(/inPersonPrice: selected\.inPersonPrice/.test(src('components/menu/GroupedFoodCard.tsx')), 'menu card: passes the variant\'s inPersonPrice to the cart')
    assert(/inPersonPrice: item\.inPersonUnitPrice \?\? item\.unitPrice/.test(src('app/fair/[fairSlug]/order/[orderId]/page.tsx')), '"Order again": in-person snapshot, else the pre-2h unit price')
  }

  // ── [17] the checkout page (step 5, screen 3) ───────────────────────────────────────────────
  console.log('\n[17] checkout page: one calculator, the shown total is sent, a changed price asks again')
  {
    const { cartCalculatorLines, checkoutTotals: ct } = await import('../lib/checkout-total')
    login(admin.clerkId, ['admin'])
    const f5 = await mkLiveFair('ask-again')
    const v6 = await mkVendor(f5.id, 'v6')
    const ten = await mkItem(v6.id, 'ten', 10)
    const line = [{ item: ten, qty: 1 }]
    // What the page does: checkoutTotals on the cart's calculator lines and the fair's markup.
    const cart = [{ menuItemId: ten.id, price: 10, inPersonPrice: 10, quantity: 1 }]
    const pageShows = (bps: number) => ct({ lines: cartCalculatorLines(cart), markupBps: bps, deliveryFeeCents: 0, serviceChargeCents: 0, tipCents: 0 }).totalCents

    const shown = pageShows(0)
    const raise1 = await adminPatch(f5.id, { onlineMarkupBps: 500 })
    const first = await place(f5.id, line, { expectedTotalCents: shown })
    assert(raise1.status === 200 && shown === 1100 && first.status === 409 && first.details?.newTotalCents === 1150, `page showed $11.00; markup raised to 5% → 409, server's total $11.50 (${raise1.status}; ${first.status} ${first.details?.newTotalCents})`)

    // Prices change AGAIN before the customer presses Confirm: the confirmed total is now stale.
    // (place() signs in as the customer, so sign in as the admin again for the change.)
    login(admin.clerkId, ['admin'])
    const raise2 = await adminPatch(f5.id, { onlineMarkupBps: 1000 })
    assert(raise2.status === 200 && await bpsOf(f5.id) === 1000, `the admin raises it again to 10% (${raise2.status})`)
    const piBefore = piCalls.length
    const second = await place(f5.id, line, { expectedTotalCents: first.details?.newTotalCents })
    assert(second.status === 409 && second.code === 'PRICE_CHANGED' && second.details?.newTotalCents === 1200,
      `confirming the old server total after another change → 409 again with $12.00: the customer is asked again (${second.status} ${second.details?.newTotalCents})`)
    assert(await ordersIn(f5.id) === 0 && piCalls.length === piBefore, 'neither attempt wrote or charged anything')
    const third = await place(f5.id, line, { expectedTotalCents: second.details?.newTotalCents })
    assert(third.status === 201 && piCalls.at(-1)?.amount === 1200, 'confirming the newest server total → placed, charged exactly 1200¢')

    // Source checks on the page.
    const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    const page = strip(readFileSync('app/fair/[fairSlug]/checkout/page.tsx', 'utf8'))
    assert(/const totals = useMemo\(\(\) => checkoutTotals\(\{\s*lines: calculatorLines,\s*markupBps,/.test(page), 'every amount comes from checkoutTotals with the cart\'s calculatorLines and markupBps')
    assert(!/calculateServiceFee|estimatedServiceFee|estimatedTotal|item\.price|i\.price|\bsubtotal \*/.test(page), 'no fee or total maths of its own, and no stored item price used')
    const summaryAmounts = ['money(totals.unitCents[idx]', 'money(totals.onlineSubtotalCents)', 'money(totals.deliveryFeeCents)', 'money(totals.serviceChargeCents)', 'money(totals.serviceFeeCents)', 'money(totals.tipCents)', 'money(totals.totalCents)']
    assert(summaryAmounts.every(a => page.includes(a)), 'the summary shows line prices, subtotal, delivery, service charge, fee, tip and total from totals')

    const handlerAt = page.indexOf('const handlePlaceOrder = async (expectedTotalCents: number) => {')
    const handlerEnd = page.indexOf('const handleSuccess', handlerAt)
    const handler = page.slice(handlerAt, handlerEnd)
    assert(handlerAt > 0 && handlerEnd > handlerAt, '[0] control: found the order handler')
    assert(/\n\s*expectedTotalCents,\n/.test(handler), 'the request sends expectedTotalCents')
    const itemsBlock = handler.match(/items: items\.map\(i => \(\{([\s\S]*?)\}\)\)/)?.[1] ?? ''
    assert(itemsBlock.split(',').map(s => s.trim().split(':')[0]).filter(Boolean).sort().join() === 'menuItemId,quantity,vendorId',
      'cart lines carry only menuItemId, vendorId and quantity (no price field)')
    assert(!/onlinePrice|onlineMarkupBps|markup:|unitPrice|inPersonPrice|price:/.test(handler.slice(handler.indexOf("fetch('/api/orders'"), handler.indexOf('const json'))), 'the request body has no price or markup field')
    assert((handler.match(/fetch\('\/api\/orders'/g) ?? []).length === 1 && !/handlePlaceOrder\(/.test(handler) && !/setTimeout|setInterval/.test(handler),
      'no automatic retry: one fetch per press, the handler never calls itself, no timers')
    assert(/json\.error\?\.code === 'PRICE_CHANGED'/.test(handler) && /setPriceChange\(\{ newTotal: d\.newTotal, newTotalCents: d\.newTotalCents, breakdown: d\.breakdown, inputsKey \}\)/.test(handler),
      'on 409 PRICE_CHANGED it keeps the server\'s new total and breakdown, then stops')
    const guardAt = handler.indexOf('if (inFlight.current) return')
    assert(guardAt > 0 && guardAt < handler.indexOf("fetch('/api/orders'") && /finally \{\s*inFlight\.current = false/.test(handler), 'a second press while one is in flight is ignored (guard before the fetch, released after)')
    assert(/onClick=\{\(\) => handlePlaceOrder\(activePriceChange\.newTotalCents\)\}\s*disabled=\{submitting \|\| !!floorRefusal\}/.test(page),
      'Confirm resubmits with the SERVER\'S total (activePriceChange.newTotalCents), disabled while submitting')
    assert(/onClick=\{\(\) => handlePlaceOrder\(totals\.totalCents\)\}\s*disabled=\{submitting \|\| !!floorRefusal\}/.test(page), '"Continue to Payment" sends the page\'s total, disabled while submitting')
    assert(/Prices updated — new total \{money\(activePriceChange\.newTotalCents\)\}/.test(page) && /activePriceChange\.breakdown\.serviceFee/.test(page), 'the panel shows "Prices updated — new total $X" and the server\'s breakdown')
    assert(/const activePriceChange = priceChange && priceChange\.inputsKey === inputsKey \? priceChange : null/.test(page), 'a confirmed total stops applying if the cart, pickup type or tip changes')
  }

  // ── [18] the vendor menu page (step 5, screen 4) ────────────────────────────────────────────
  console.log('\n[18] vendor menu page: edits the in-person price only; no compounding')
  {
    await setMarkup(live.id, 1000)
    const owner = await mkUser('vowner')
    await prisma.vendorMember.create({ data: { vendorId: V1.id, userId: owner.id, role: 'owner', approvalStatus: 'APPROVED' } })
    const menuGET = (await import('../app/api/vendors/[id]/menu/route')).GET as unknown as (r: Request, c: unknown) => Promise<Response>
    const reqPOST = (await import('../app/api/menu-requests/route')).POST as unknown as (r: NextRequest) => Promise<Response>
    const meGET = (await import('../app/api/vendors/me/route')).GET as unknown as (r: Request) => Promise<Response>
    const fileReq = (body: Record<string, unknown>) => reqPOST(new NextRequest('http://localhost/api/menu-requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vendorId: V1.id, ...body }),
    }))
    type Variant = { id: string; price: number; inPersonPrice: number }
    /** What the page loads: GET /api/vendors/{id}/menu, flattened to variants. */
    const loadAsPage = async (itemId: string) => {
      const b = await bodyOf(await menuGET(new Request(`http://localhost/api/vendors/${V1.id}/menu`), { params: Promise.resolve({ id: V1.id }) }))
      const groups = (b.data as unknown as Array<{ variants: Variant[] }> | undefined) ?? []
      return groups.flatMap(g => g.variants).find(v => v.id === itemId)
    }
    const stored = async (id: string) => (await prisma.menuItem.findUniqueOrThrow({ where: { id } })).price

    login(owner.clerkId)
    const me = await bodyOf(await meGET(new Request(`http://localhost/api/vendors/me?fairSlug=${live.urlSlug}`)))
    assert(((me.data?.vendor as { event?: { onlineMarkupBps?: number } } | undefined)?.event?.onlineMarkupBps) === 1000,
      'the vendor portal gets the fair\'s markup from /api/vendors/me (for the "Customers pay … online" hint)')

    // No compounding: load as the page does, save the loaded price, reload, save again.
    const nc = await mkItem(V1.id, 'nocompound', 10)
    const load1 = await loadAsPage(nc.id)
    assert(load1?.price === 11 && load1.inPersonPrice === 10, `at 10% the menu sends online 11.00 and in-person 10.00 (got ${load1?.price} / ${load1?.inPersonPrice})`)
    const save1 = await fileReq({ type: 'EDIT', menuItemId: nc.id, price: load1?.inPersonPrice })
    const load2 = await loadAsPage(nc.id)
    const save2 = await fileReq({ type: 'EDIT', menuItemId: nc.id, price: load2?.inPersonPrice })
    const load3 = await loadAsPage(nc.id)
    assert(save1.status < 300 && save2.status < 300, `the vendor saves the item twice (${save1.status}, ${save2.status})`)
    assert(await stored(nc.id) === 10 && load3?.inPersonPrice === 10 && load3.price === 11,
      `after two saves the stored price is still $10.00 and customers still pay $11.00 (stored ${await stored(nc.id)}, online ${load3?.price})`)
    // Control: had the page loaded the ONLINE price into the form (the bug this prevents), one save
    // would have raised the stored price by the markup.
    const ctrl = await mkItem(V1.id, 'compound-ctrl', 10)
    const ctrlLoad = await loadAsPage(ctrl.id)
    await fileReq({ type: 'EDIT', menuItemId: ctrl.id, price: ctrlLoad?.price })
    assert(await stored(ctrl.id) === 11, `[0] control: saving the online price instead WOULD change the stored price to $11.00 (got ${await stored(ctrl.id)}), so the test can see compounding`)

    // The price rules still judge the in-person price.
    const low = await fileReq({ type: 'EDIT', menuItemId: nc.id, price: 0.95 })
    const high = await fileReq({ type: 'EDIT', menuItemId: nc.id, price: 10000.01 })
    assert(low.status === 400 && high.status === 400 && await stored(nc.id) === 10,
      'the $1.00–$10,000 rule applies to the in-person price ($0.95 and $10,000.01 refused, even though $0.95 is $1.05 online)')
    const del1 = await fileReq({ type: 'DELETE', menuItemId: nc.id })
    const restoreSame = await bodyOf(await fileReq({ type: 'RESTORE', menuItemId: nc.id, price: 10 }))
    assert(del1.status < 300 && restoreSame.data?.status === 'APPROVED' && (await prisma.menuItem.findUniqueOrThrow({ where: { id: nc.id } })).removedAt === null,
      'restoring at the same in-person price ($10.00, $11.00 online) goes straight back on the menu')
    await fileReq({ type: 'DELETE', menuItemId: nc.id })
    const restoreHigher = await bodyOf(await fileReq({ type: 'RESTORE', menuItemId: nc.id, price: 10.5 }))
    assert(restoreHigher.data?.status === 'PENDING' && await stored(nc.id) === 10,
      `restoring at a higher in-person price ($10.50) waits for approval, compared on the in-person price (status ${restoreHigher.data?.status})`)

    // Source checks on the page.
    const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    const page = strip(readFileSync('app/vendor/[fairSlug]/menu/page.tsx', 'utf8'))
    assert(/price: variant\.inPersonPrice,/.test(page) && !/variant\.price\b/.test(page), 'the page loads variant.inPersonPrice into the form, never variant.price')
    assert(/const online = onlineUnitPrice\(inPersonPrice, onlineMarkupBps\)/.test(page) && /const \{ onlineMarkupBps \} = useVendorMeta\(\)/.test(page),
      'the hint uses onlineUnitPrice (lib/checkout-total.ts) with the fair\'s markup')
    assert(/Customers pay \$\$\{online\} online \(\+\$\{bpsToPercent\(onlineMarkupBps\)\}%\)/.test(page), 'the hint reads "Customers pay $X online (+N%)"')
    assert((page.match(/<OnlinePriceHint inPersonPrice=\{form\.price\} \/>/g) ?? []).length === 2, 'the hint sits under both the add and the edit price box')
    assert(/safeMarkupBps\(v\.event\?\.onlineMarkupBps\)/.test(strip(readFileSync('app/vendor/[fairSlug]/layout.tsx', 'utf8'))), 'the vendor layout passes the markup on, made safe')
  }

  // ── [19] organizer event settings (step 5, screen 5) ────────────────────────────────────────
  console.log('\n[19] organizer settings: 0–10% with percentToBps, refused not clamped, locked once started')
  {
    const { parseMarkupPercentInput, MARKUP_LOCKED_MESSAGE, MARKUP_PERCENT_RANGE_MESSAGE, MARKUP_PERCENT_NUMBER_MESSAGE, MARKUP_PERCENT_DECIMALS_MESSAGE } = price
    const { onlineUnitPrice } = await import('../lib/checkout-total')
    const okCases: Array<[string, number]> = [['7.15', 715], ['8.2', 820], ['4.35', 435], ['10', 1000], ['0', 0], [' 5 ', 500], ['0.01', 1]]
    for (const [input, bps] of okCases) {
      const p = parseMarkupPercentInput(input)
      assert(p.ok && p.bps === bps, `"${input}"% → ${bps} bp (got ${p.ok ? p.bps : p.message})`)
    }
    const badCases: Array<[string, string]> = [
      ['10.5', MARKUP_PERCENT_RANGE_MESSAGE], ['10.01', MARKUP_PERCENT_RANGE_MESSAGE], ['25', MARKUP_PERCENT_RANGE_MESSAGE], ['-1', MARKUP_PERCENT_RANGE_MESSAGE],
      ['7.155', MARKUP_PERCENT_DECIMALS_MESSAGE], ['', MARKUP_PERCENT_NUMBER_MESSAGE], ['abc', MARKUP_PERCENT_NUMBER_MESSAGE], ['1e1', MARKUP_PERCENT_NUMBER_MESSAGE], ['5%', MARKUP_PERCENT_NUMBER_MESSAGE],
    ]
    for (const [input, message] of badCases) {
      const p = parseMarkupPercentInput(input)
      assert(!p.ok && p.message === message, `"${input}" refused with "${message}" (not clamped to a valid value)`)
    }
    assert(onlineUnitPrice(10, 715) === 10.72 && onlineUnitPrice(10, 0) === 10 && onlineUnitPrice(10, 1000) === 11,
      'example line: on a $10.00 item customers pay $10.72 at 7.15%, $10.00 at 0%, $11.00 at 10%')

    // Through the route: own events only; the 409 says exactly what the screen shows.
    login(A.user.clerkId)
    const own = await bodyOf(await orgGet(fairA.urlSlug))
    assert(typeof own.data?.onlineMarkupBps === 'number' && typeof own.data?.markupLocked === 'boolean', 'the organizer\'s own fair: settings include the markup and whether it is locked')
    login(B.user.clerkId)
    const other = await orgGet(fairA.urlSlug)
    assert(other.status === 404, `another organizer cannot even read this fair's settings → 404 (${other.status})`)
    login(A.user.clerkId)
    await prisma.event.update({ where: { id: fairA.id }, data: { status: 'ACTIVE' } })
    const locked = await bodyOf(await orgPatch(fairA.urlSlug, { onlineMarkupBps: (await bpsOf(fairA.id)) === 100 ? 200 : 100 }))
    assert(locked.error?.code === 'MARKUP_LOCKED' && locked.error.message === MARKUP_LOCKED_MESSAGE, 'the 409 MARKUP_LOCKED message is the same sentence the screen shows')
    const lockedGet = await bodyOf(await orgGet(fairA.urlSlug))
    assert(lockedGet.data?.markupLocked === true, 'after the start, GET says markupLocked: the screen shows the field read-only')
    await prisma.event.update({ where: { id: fairA.id }, data: { status: 'UPCOMING' } })

    // Source checks on the page.
    const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    const page = strip(readFileSync('app/organizer/fairs/[fairSlug]/settings/page.tsx', 'utf8'))
    assert(/const markupParse = parseMarkupPercentInput\(markupInput\)/.test(page), 'the field is checked by parseMarkupPercentInput (percentToBps with Math.round)')
    assert(!/NumberField[^>]*[Mm]arkup/.test(page) && !/Math\.min\([^)]*markup/i.test(page), 'the markup is not a clamping NumberField and is never Math.min-clamped')
    const saveAt = page.indexOf('async function handleSave()')
    const blockAt = page.indexOf('if (!settings.markupLocked && !markupParse.ok) {', saveAt)
    assert(saveAt > 0 && blockAt > saveAt && blockAt < page.indexOf('fetch(', saveAt), 'an invalid markup blocks the save before anything is sent')
    assert(/\.\.\.\(markupBps !== undefined && \{ onlineMarkupBps: markupBps \}\)/.test(page) && /const markupBps = !settings\.markupLocked && markupParse\.ok && markupParse\.bps !== settings\.onlineMarkupBps/.test(page),
      'the markup is sent only when it changed and the event has not started')
    assert(/disabled=\{settings\.markupLocked\}/.test(page) && /\{MARKUP_LOCKED_MESSAGE\}/.test(page), 'once started the field is read-only with the locked message')
    assert(/json\.error\?\.code === 'MARKUP_LOCKED'/.test(page) && /markupLocked: true/.test(page), 'a 409 MARKUP_LOCKED locks the field and says nothing was saved')
    assert(/onlineUnitPrice\(MARKUP_EXAMPLE_PRICE, markupParse\.bps\)/.test(page) && /const MARKUP_EXAMPLE_PRICE = 10/.test(strip(readFileSync('app/organizer/fairs/[fairSlug]/settings/page.tsx', 'utf8'))),
      'the example ("On a $10.00 item, customers pay $X online") uses onlineUnitPrice')
  }

  // ── [20] admin event settings (step 5, screen 6) ────────────────────────────────────────────
  console.log('\n[20] admin settings: strict admins only, not locked after the start, every change logged')
  {
    // An event that has already started, saved with the SAME body the admin page sends.
    const started = await mkLiveFair('admin-started')
    const pageBody = (extra: Record<string, unknown> = {}) => ({
      name: started.name,
      startDate: started.startDate.toISOString().slice(0, 10),
      endDate: started.endDate.toISOString().slice(0, 10),
      eventLat: null, eventLng: null, serviceChargeEnabled: false, serviceChargeAmount: null,
      ...extra,
    })
    const logs = () => prisma.eventMarkupChange.findMany({ where: { eventId: started.id }, orderBy: { createdAt: 'asc' } })

    for (const [label, roles] of [['event_operator', ['event_operator']], ['platform_manager', ['platform_manager']]] as const) {
      login(admin.clerkId, [...roles])
      const res = await adminPatch(started.id, pageBody({ onlineMarkupBps: 500 }))
      assert(res.status === 403, `${label} → 403 (${res.status})`)
    }
    assert((await logs()).length === 0 && await bpsOf(started.id) === 0, 'neither changed the markup or wrote a log row')

    login(admin.clerkId, ['admin'])
    const res = await adminPatch(started.id, pageBody({ onlineMarkupBps: price.percentToBps(7.15) }))
    const rows = await logs()
    assert(res.status === 200 && await bpsOf(started.id) === 715, `a strict admin changes it on a started (ACTIVE) event: 7.15% saved as 715 (${res.status})`)
    assert(rows.length === 1 && rows[0].actorRole === 'ADMIN' && rows[0].actorClerkId === admin.clerkId && rows[0].actorUserId === admin.id
      && rows[0].oldBps === 0 && rows[0].newBps === 715 && rows[0].createdAt instanceof Date,
    'the change wrote one EventMarkupChange row: ADMIN, who (Clerk id and User id), old 0, new 715, when')

    const same = await adminPatch(started.id, pageBody())
    assert(same.status === 200 && (await logs()).length === 1, 'a save without a markup change (the page sends none) writes no log row')
    const bad = await adminPatch(started.id, pageBody({ onlineMarkupBps: 1001 }))
    assert(bad.status === 400 && (await logs()).length === 1 && await bpsOf(started.id) === 715, 'over 10% → 400, nothing saved, no log row')

    // Source checks on the page.
    const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    const page = strip(readFileSync('app/admin/[eventSlug]/settings/page.tsx', 'utf8'))
    assert(/const markupParse = parseMarkupPercentInput\(markupInput\)/.test(page), 'the field is checked by parseMarkupPercentInput (percentToBps with Math.round)')
    const saveAt = page.indexOf('const handleSave = async () => {')
    assert(saveAt > 0 && page.indexOf('if (!markupParse.ok) {', saveAt) > saveAt && page.indexOf('if (!markupParse.ok) {', saveAt) < page.indexOf('fetch(', saveAt),
      'an invalid markup blocks the whole save before anything is sent (refused, not clamped)')
    assert(/\.\.\.\(markupChanged && \{ onlineMarkupBps: markupParse\.bps \}\)/.test(page) && /const markupChanged = markupParse\.bps !== savedMarkupBps/.test(page), 'only a changed markup is sent')
    assert(!/markupLocked|MARKUP_LOCKED|disabled=\{[^}]*[Mm]arkup/.test(page), 'no lock on the admin screen')
    assert(/Every change is logged/.test(page) && /onlineUnitPrice\(MARKUP_EXAMPLE_PRICE, markupParse\.bps\)/.test(page), 'it says changes are logged and shows the example price')
  }

  // ── [21] organizer settings on an ACTIVE fair (found Nov 17 in the toast step) ──────────────
  // Before this fix an ACTIVE fair's organizer could save nothing: the page re-sent status ACTIVE on
  // every save and the route allows only UPCOMING/INACTIVE. Now a status equal to the fair's current
  // one is dropped (no refusal, no status write), and the page sends status only when it changed and
  // shows an ACTIVE fair's status read-only. What an organizer may SET is unchanged: never ACTIVE.
  console.log('\n[21] organizer settings on an ACTIVE fair: saves work, status rules unchanged, markup still locked')
  {
    const { parseStatementNameInput } = await import('../lib/statement-descriptor')
    const parsedName = parseStatementNameInput('OMK LIVE FAIR')
    const expectedName = parsedName.ok ? parsedName.value : '(refused)'
    const rowOf = (id: string) => prisma.event.findUniqueOrThrow({ where: { id } })
    // The exact body the page sent before this fix: every field, the status re-sent, no markup.
    const oldPageBody = (status: unknown, tag: string, isPaused = true) => ({
      primaryColor: '#123456', welcomeMessage: `${PFX}${tag}`, statementName: 'OMK LIVE FAIR', status,
      orderAcceptanceWindowSec: 120, vendorOfflineHideSec: 300, maxVendorsPerOrder: 4, isPaused,
    })
    const mkStatusFair = async (tag: string, status: 'UPCOMING' | 'ACTIVE' | 'INACTIVE') => {
      const f = await mkFair(A.org.id, tag)
      if (status !== 'UPCOMING') await prisma.event.update({ where: { id: f.id }, data: { status } })
      return f
    }
    login(A.user.clerkId)

    // 1–3: an ACTIVE fair saves.
    const live = await mkStatusFair('live', 'ACTIVE')
    const r1 = await orgPatch(live.urlSlug, oldPageBody('ACTIVE', 'r1'))
    const e1 = await rowOf(live.id)
    assert(r1.status === 200 && e1.status === 'ACTIVE' && e1.welcomeMessage === `${PFX}r1` && e1.statementName === expectedName
      && e1.isPaused === true && e1.maxVendorsPerOrder === 4 && e1.orderAcceptanceWindowSec === 120,
      `ACTIVE fair, the old page's body (status ACTIVE re-sent, Platform Paused on) → 200, every setting saved, still ACTIVE (${r1.status})`)
    const noStatusBody: Record<string, unknown> = { ...oldPageBody(null, 'r2', false) }
    delete noStatusBody.status
    const r2 = await orgPatch(live.urlSlug, noStatusBody)
    const e2 = await rowOf(live.id)
    assert(r2.status === 200 && e2.status === 'ACTIVE' && e2.welcomeMessage === `${PFX}r2` && e2.isPaused === false,
      `ACTIVE fair, the same body WITHOUT status (the new page) → 200, saved, still ACTIVE (${r2.status})`)
    const r3 = await orgPatch(live.urlSlug, { status: 'ACTIVE' })
    const e3 = await rowOf(live.id)
    assert(r3.status === 200 && e3.status === 'ACTIVE' && e3.welcomeMessage === `${PFX}r2` && e3.isPaused === false,
      `ACTIVE fair, body { status: 'ACTIVE' } only → 200, nothing changed (${r3.status})`)

    // 4: the markup stays locked on an ACTIVE fair, with or without the status in the body.
    const bpsBefore = await bpsOf(live.id)
    const logsBefore = (await logsOf(live.id)).length
    for (const [label, body] of [
      ['with status ACTIVE', { ...oldPageBody('ACTIVE', 'r4a'), onlineMarkupBps: bpsBefore === 100 ? 200 : 100 }],
      ['without status', { welcomeMessage: `${PFX}r4b`, onlineMarkupBps: bpsBefore === 100 ? 200 : 100 }],
    ] as const) {
      const r4 = await orgPatch(live.urlSlug, body)
      const b4 = await bodyOf(r4)
      const e4 = await rowOf(live.id)
      assert(r4.status === 409 && b4.error?.code === 'MARKUP_LOCKED' && e4.welcomeMessage === `${PFX}r2`,
        `ACTIVE fair, a markup change ${label} → 409 MARKUP_LOCKED, the other setting not saved (${r4.status} ${b4.error?.code})`)
    }
    assert(await bpsOf(live.id) === bpsBefore && (await logsOf(live.id)).length === logsBefore, 'ACTIVE fair: markup unchanged, no log row')

    // 5: an organizer still can't set ACTIVE.
    for (const from of ['UPCOMING', 'INACTIVE'] as const) {
      const f = await mkStatusFair(`to-active-${from.toLowerCase()}`, from)
      const r5 = await orgPatch(f.urlSlug, oldPageBody('ACTIVE', 'r5'))
      const b5 = await bodyOf(r5)
      const e5 = await rowOf(f.id)
      assert(r5.status === 400 && b5.error?.code === 'VALIDATION_ERROR' && e5.status === from && e5.welcomeMessage !== `${PFX}r5`,
        `${from} fair sending ACTIVE → 400 VALIDATION_ERROR, still ${from}, nothing saved (${r5.status} ${b5.error?.code})`)
    }

    // 6: anything that is not UPCOMING/INACTIVE (and not the current status) is refused.
    const up = await mkStatusFair('garbage', 'UPCOMING')
    for (const bad of ['DRAFT', 'LIVE', null, 1, 'upcoming'] as const) {
      const r6 = await orgPatch(up.urlSlug, oldPageBody(bad, 'r6'))
      const e6 = await rowOf(up.id)
      assert(r6.status === 400 && e6.status === 'UPCOMING' && e6.welcomeMessage !== `${PFX}r6`,
        `UPCOMING fair, status ${JSON.stringify(bad)} → 400, nothing saved (${r6.status})`)
    }

    // 7: the changes an organizer may make today behave exactly as before (S7 noted, not changed).
    const moves: Array<['UPCOMING' | 'ACTIVE' | 'INACTIVE', 'UPCOMING' | 'INACTIVE']> = [
      ['UPCOMING', 'INACTIVE'], ['INACTIVE', 'UPCOMING'], ['ACTIVE', 'INACTIVE'], ['ACTIVE', 'UPCOMING'],
    ]
    for (const [from, to] of moves) {
      const f = await mkStatusFair(`move-${from.toLowerCase()}-${to.toLowerCase()}`, from)
      const r7 = await orgPatch(f.urlSlug, { status: to, welcomeMessage: `${PFX}r7` })
      const e7 = await rowOf(f.id)
      assert(r7.status === 200 && e7.status === to && e7.welcomeMessage === `${PFX}r7`,
        `${from} → ${to} → 200, saved as today (${r7.status} ${e7.status})`)
    }

    // 8: re-sending UPCOMING on an UPCOMING fair still saves (no-op status, as today's result).
    const r8 = await orgPatch(up.urlSlug, oldPageBody('UPCOMING', 'r8'))
    const e8 = await rowOf(up.id)
    assert(r8.status === 200 && e8.status === 'UPCOMING' && e8.welcomeMessage === `${PFX}r8`, `UPCOMING fair re-sending UPCOMING → 200, saved (${r8.status})`)

    // 9–10: source checks on the route and the page.
    const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    const route = strip(readFileSync('app/api/organizer/fairs/[fairSlug]/settings/route.ts', 'utf8'))
    const allowedMatch = route.match(/const ALLOWED_STATUSES: EventStatus\[\] = \[([^\]]*)\]/)
    const allowed = (allowedMatch?.[1].match(/'([A-Z_]+)'/g) ?? []).map(s => s.slice(1, -1)).sort()
    assert(allowed.join(',') === 'INACTIVE,UPCOMING', `route: an organizer may set exactly UPCOMING and INACTIVE (${allowed.join(', ')})`)
    assert(/if \(data\.status === event\.status\) \{\s*delete data\.status\s*\} else if \(!ALLOWED_STATUSES\.includes\(data\.status as EventStatus\)\) \{\s*return apiError\('Invalid status', 400, 'VALIDATION_ERROR'\)/.test(route),
      'route: a status equal to the current one is dropped (not written); any other status still goes through the allow-list')

    const page = strip(readFileSync('app/organizer/fairs/[fairSlug]/settings/page.tsx', 'utf8'))
    assert(/\.\.\.\(statusChanged && \{ status: settings\.status \}\)/.test(page) && /const statusChanged = savedStatus !== null && settings\.status !== savedStatus/.test(page)
      && !/^\s*status:\s+settings\.status,/m.test(page),
      'page: status is sent only when the organizer changed it (no unconditional status: settings.status)')
    const choicesAt = page.indexOf('const ORGANIZER_STATUS_CHOICES')
    const choicesBlock = choicesAt >= 0 ? page.slice(choicesAt, page.indexOf(']\n', choicesAt)) : ''
    const choices = (choicesBlock.match(/value: '([A-Z_]+)'/g) ?? []).map(s => s.slice(8, -1)).sort()
    assert(choices.length > 0 && choices.join(',') === allowed.join(','), `page: the dropdown choices equal the route's list (${choices.join(', ')})`)
    assert(!/value:\s*'ACTIVE'/.test(page), 'page: Active is never offered as a choice')
    assert(/ORGANIZER_STATUS_CHOICES\.some\(c => c\.value === savedStatus\) \? \(\s*<SelectField\s+label="Fair Status"/.test(page)
      && /options=\{ORGANIZER_STATUS_CHOICES\}/.test(page) && /Active — live/.test(page) && /use Platform Paused/.test(page),
      'page: the status dropdown shows only for a status the organizer may set; an ACTIVE fair shows "Active — live" read-only with the Platform Paused pointer')
  }

  // ── [22] order quantity limits (Jordan, Nov 17) + review F8 / F9 ─────────────────────────────
  // lib/order-limits.ts: at most MAX_QTY_PER_ITEM of one dish (every size of it counted together)
  // and at most MAX_ITEMS_PER_ORDER in all. Over either: a clean 400 with a code, never a 500, before
  // anything is written or sent to Stripe. Also: quantities that are not whole numbers (F9), cart
  // lines that are not objects, and price-like fields the route used to ignore (F8).
  console.log('\n[22] order limits: 5 per dish (all sizes together), 15 per order; whole numbers; price fields refused')
  {
    const limits = await import('../lib/order-limits')
    assert(limits.MAX_QTY_PER_ITEM === 5 && limits.MAX_ITEMS_PER_ORDER === 15, 'the limits are 5 per dish and 15 per order, in one constant file')
    assert(limits.ORDER_ITEM_LIMIT_MESSAGE === 'Orders are limited to 15 items. Place a second order for more.'
        && limits.QUANTITY_LIMIT_MESSAGE === 'You can order at most 5 of each item.',
      'both fixed sentences read as agreed (built from the constants)')

    const fl = await mkLiveFair('limits')
    const VA = await mkVendor(fl.id, 'limA')
    const VB = await mkVendor(fl.id, 'limB')
    const A = await mkItem(VA.id, 'lim-a', 4)
    const B = await mkItem(VA.id, 'lim-b', 3)
    const C = await mkItem(VB.id, 'lim-c', 2.5)
    // One dish in two sizes: separate menu items sharing a variantGroup within booth B.
    const sizeOf = (label: string, p: number) => prisma.menuItem.create({ data: {
      vendorId: VB.id, name: `${PFX}soup-${label}`, price: p, category: 'Mains', isAvailable: true,
      variantGroup: `${PFX}Soup`, variantLabel: label,
    } })
    const small = await sizeOf('Small', 3)
    const large = await sizeOf('Large', 5)
    const L = (item: Item, qty: number): Line => ({ item, qty })

    const accept = async (label: string, lines: Line[], extra: Record<string, unknown> = {}, o: { deliveryFeeCents?: number; tip?: number } = {}) => {
      const r = await place(fl.id, lines, { expectedTotalCents: pageTotals(lines, 0, o).totalCents, ...extra })
      assert(r.status === 201, `${label} → 201 (got ${r.status} ${r.code ?? ''} ${r.message ?? ''})`)
    }
    const refuse = async (label: string, lines: Line[], code: string, message: string | null,
      extra: Record<string, unknown> = {}, itemExtra: Record<string, unknown> = {}) => {
      const before = await ordersIn(fl.id), piBefore = piCalls.length
      const r = await place(fl.id, lines, { expectedTotalCents: 1000, ...extra }, itemExtra)
      const nothing = await ordersIn(fl.id) === before && piCalls.length === piBefore
      assert(r.status === 400 && r.code === code && (message === null || r.message === message) && nothing,
        `${label} → 400 ${code}, nothing written or sent to Stripe (got ${r.status} ${r.code ?? ''} "${r.message ?? ''}")`)
    }
    const postRaw = async (items: unknown[]) => {
      login(customer2)
      const res = await orderPOST(new NextRequest('http://localhost/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: fl.id, fulfillmentType: 'BOOTH_PICKUP', customerName: 'C', customerPhone: '6185550100', expectedTotalCents: 1000, items }),
      }))
      const j = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
      return { status: res.status, code: j.error?.code, message: j.error?.message }
    }

    // The exact body the real checkout sends (app/fair/[fairSlug]/checkout/page.tsx:509–541):
    // eventId, fulfillmentType, customerName, customerPhone, tip, expectedTotalCents, items of
    // { menuItemId, vendorId, quantity }, plus the vehicle fields for curbside. A tip is sent only for
    // runner orders (page :357, tipAmount = isRunnerFulfilled ? tip : 0; route :436 counts it only
    // then), so booth pickup sends none; the curbside row proves `tip` stays allowed.
    await accept('the exact checkout body, booth pickup (the page sends no tip for booth pickup)', [L(A, 2), L(C, 1)])
    await accept('the exact checkout body, curbside with vehicle fields and a $2.50 tip', [L(A, 1), L(small, 1)],
      { fulfillmentType: 'CURBSIDE', vehicleMake: 'Honda', vehicleColor: 'Blue', vehiclePlate: 'ABC123', tip: 2.5 }, { deliveryFeeCents: 399, tip: 2.5 })

    // 5 per dish.
    await accept('5 of one item', [L(A, 5)])
    await refuse('6 of one item', [L(A, 6)], 'QUANTITY_LIMIT', limits.QUANTITY_LIMIT_MESSAGE)
    await refuse('the same item as 3 + 3 on two lines', [L(A, 3), L(A, 3)], 'QUANTITY_LIMIT', limits.QUANTITY_LIMIT_MESSAGE)
    await accept('3 Small + 2 Large of one dish (5)', [L(small, 3), L(large, 2)])
    await refuse('3 Small + 3 Large of one dish (6), a clean 400 and not a 500', [L(small, 3), L(large, 3)], 'QUANTITY_LIMIT', limits.QUANTITY_LIMIT_MESSAGE)

    // 15 per order, across booths.
    await accept('5 of A + 5 of B (booth A) + 5 of C (booth B): 15 across two booths', [L(A, 5), L(B, 5), L(C, 5)])
    await refuse('15 across two booths + 1 Small: 16', [L(A, 5), L(B, 5), L(C, 5), L(small, 1)], 'ORDER_ITEM_LIMIT', limits.ORDER_ITEM_LIMIT_MESSAGE)
    await refuse('15 across two booths + 1 more of A: 16', [L(A, 6), L(B, 5), L(C, 5)], 'ORDER_ITEM_LIMIT', limits.ORDER_ITEM_LIMIT_MESSAGE)

    // Whole numbers only (F9: 1.5 used to give a 500; "2" used to be accepted).
    for (const bad of [1.5, '2', 0, true, 'abc'] as const) {
      await refuse(`quantity ${JSON.stringify(bad)}`, [L(A, bad as unknown as number)], 'VALIDATION_ERROR', 'Invalid quantity')
    }

    // A cart line must be an object.
    for (const bad of [null, 'x', 5, []] as const) {
      const before = await ordersIn(fl.id), piBefore = piCalls.length
      const r = await postRaw([bad])
      assert(r.status === 400 && r.code === 'VALIDATION_ERROR' && r.message === 'Invalid item in cart'
          && await ordersIn(fl.id) === before && piCalls.length === piBefore,
        `cart line ${JSON.stringify(bad)} → 400 VALIDATION_ERROR "Invalid item in cart", nothing written (got ${r.status} ${r.code ?? ''} "${r.message ?? ''}")`)
    }

    // Price-like fields are refused, not ignored (F8).
    for (const k of ['total', 'subtotal', 'serviceFee', 'deliveryFee']) {
      await refuse(`checkout body with ${k}`, [L(A, 1)], 'CLIENT_PRICE_NOT_ACCEPTED', null, { [k]: 1 })
    }
    for (const k of ['totalPrice', 'subtotal', 'inPersonPrice']) {
      await refuse(`checkout line with ${k}`, [L(A, 1)], 'CLIENT_PRICE_NOT_ACCEPTED', null, {}, { [k]: 1 })
    }
  }

  // ── [23] order limits on screen (batch 1b) ──────────────────────────────────────────────────────
  // lib/order-limits.ts helpers drive the cart (app/_contexts/FairCartContext.tsx), the menu card,
  // the cart and checkout pages and "order again". The dish key is the server's rule (vendor +
  // variantGroup, else the item), stored in the browser's cart only and never sent. Trims are SAID
  // (the fixed sentences, once), never silent. UI wiring is checked as source (no browser test
  // framework in this repo), the helpers and the order API are called for real.
  console.log('\n[23] order limits on screen: one dish key, + stops at 5 per dish / 15 in all, trims are said, never sent')
  {
    const lim = await import('../lib/order-limits')
    const { dishKeyFor, dishKeyFromGroup, dishKeyOf, dishQuantity, totalQuantity, limitBreach, addBlockReason, capQuantity, mergeLines, trimToLimits } = lim
    type CL = { menuItemId: string; quantity: number; dishKey?: string }
    const ln = (menuItemId: string, quantity: number, dishKey?: string): CL =>
      (dishKey === undefined ? { menuItemId, quantity } : { menuItemId, quantity, dishKey })
    const shape = (lines: CL[]) => lines.map(l => `${l.menuItemId}×${l.quantity}`).join(',')

    // ── dish keys: the server's rule, the same strings ──
    assert(dishKeyFor('v1', 'Soup', 'm1') === 'group|v1|Soup' && dishKeyFor('v1', null, 'm1') === 'item|m1'
        && dishKeyFor('v1', undefined, 'm1') === 'item|m1' && dishKeyFor('v1', '', 'm1') === 'item|m1',
      'dishKeyFor: vendor + variantGroup → group|v|g; no (or empty) variantGroup → item|id')
    assert(dishKeyFromGroup('v1::Soup', 'v1', 'm1') === 'group|v1|Soup' && dishKeyFromGroup('m1', 'v1', 'm1') === 'item|m1',
      'dishKeyFromGroup: menu groupKey v1::Soup → group|v1|Soup; a one-size groupKey (the item id) → item|m1')
    assert(dishKeyFromGroup('v1::A::B', 'v1', 'm1') === 'group|v1|A::B', 'dishKeyFromGroup: a variantGroup containing "::" is kept whole')
    assert(dishKeyOf(ln('m9', 1)) === 'item|m9' && dishKeyOf(ln('m9', 1, '')) === 'item|m9' && dishKeyOf(ln('m9', 1, 'group|v1|Soup')) === 'group|v1|Soup',
      'dishKeyOf: a line saved before 1b (no dishKey) counts as its own size; a stored dishKey is used')
    const raw = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    assert(raw('app/api/orders/route.ts').includes('mi.variantGroup ? `group|${mi.vendorId}|${mi.variantGroup}` : `item|${mi.id}`')
        && raw('lib/order-limits.ts').includes('variantGroup ? `group|${vendorId}|${variantGroup}` : `item|${menuItemId}`'),
      'source: the route and dishKeyFor build exactly the same two forms')
    const groupedSrc = raw('lib/menu/getGroupedMenuItems.ts')
    assert(groupedSrc.includes('? `${vendorId}::${item.variantGroup}`') && groupedSrc.includes('? `${item.vendorId}::${item.variantGroup}`')
        && (groupedSrc.match(/:\s*item\.id\n/g) ?? []).length === 2,
      'source: getGroupedMenuItems builds groupKey as vendorId::variantGroup, else the item id (both loaders)')

    // ── the REAL menu code: a two-size dish's groupKey gives the server's dish key for both sizes ──
    login(admin.clerkId, ['admin'])
    const f23 = await mkLiveFair('screen-limits')
    const v23 = await mkVendor(f23.id, 'scr')
    const VG = `${PFX}Big Soup`
    const size23 = (label: string, p: number) => prisma.menuItem.create({ data: {
      vendorId: v23.id, name: `${PFX}bigsoup-${label}`, price: p, category: 'Mains', isAvailable: true,
      variantGroup: VG, variantLabel: label,
    } })
    const s23 = await size23('Small', 3)
    const l23 = await size23('Large', 5)
    const solo23 = await mkItem(v23.id, 'solo23', 4)
    const grouped = await import('../lib/menu/getGroupedMenuItems')
    const loaders = [
      { how: 'by vendor', groups: await grouped.getGroupedMenuItemsByVendor(v23.id) },
      { how: 'by event', groups: await grouped.getGroupedMenuItemsByEvent(f23.urlSlug) },
    ]
    for (const { how, groups } of loaders) {
      const g = groups.find(x => x.variants.some(v => v.id === s23.id))
      const keys = [s23, l23].map(it => (g ? dishKeyFromGroup(g.groupKey, g.vendorId, it.id) : ''))
      assert(!!g && g.variants.length === 2 && keys[0] === dishKeyFor(v23.id, VG, s23.id) && keys[1] === dishKeyFor(v23.id, VG, l23.id) && keys[0] === keys[1],
        `real getGroupedMenuItems (${how}): both sizes of "${VG}" → dishKeyFromGroup(groupKey) === dishKeyFor(vendor, variantGroup), one key (${keys.join(' / ')})`)
      const gs = groups.find(x => x.variants.some(v => v.id === solo23.id))
      assert(!!gs && dishKeyFromGroup(gs.groupKey, gs.vendorId, solo23.id) === dishKeyFor(v23.id, null, solo23.id),
        `real getGroupedMenuItems (${how}): a one-size dish → item|<id>`)
    }

    // ── "order again": the order API carries variantGroup, and two sizes share one key and stop at 5 together ──
    const lines23 = [{ item: s23, qty: 1 }, { item: l23, qty: 1 }]
    const placed23 = await place(f23.id, lines23, { expectedTotalCents: pageTotals(lines23, 0).totalCents })
    assert(placed23.status === 201, `an order of Small + Large is placed (got ${placed23.status} ${placed23.code ?? ''})`)
    const orderGET23 = (await import('../app/api/orders/[id]/route')).GET as unknown as (r: NextRequest, c: unknown) => Promise<Response>
    login(customer2)
    const oid23 = String(placed23.data?.orderId)
    const got23 = await bodyOf(await orderGET23(new NextRequest(`http://localhost/api/orders/${oid23}`), { params: Promise.resolve({ id: oid23 }) }))
    const ois = (got23.data?.orderItems ?? []) as Array<{ menuItemId: string; vendorId: string; menuItem: { variantGroup?: string | null } }>
    assert(ois.length === 2 && ois.every(i => i.menuItem.variantGroup === VG && i.vendorId === v23.id),
      `the order API gives "order again" each line's vendorId and menuItem.variantGroup (${ois.map(i => i.menuItem.variantGroup).join(', ')})`)
    // What handleOrderAgain → replaceCart does: one line per order line (quantity 1, parked), its
    // dishKey from dishKeyFor(item.vendorId, item.menuItem.variantGroup, item.menuItemId), then
    // mergeLines and trimToLimits.
    const again = trimToLimits(mergeLines(ois.map(i => ln(i.menuItemId, 1, dishKeyFor(i.vendorId, i.menuItem.variantGroup, i.menuItemId)))))
    assert(again.lines.length === 2 && again.lines[0].dishKey === again.lines[1].dishKey && again.lines[0].dishKey === dishKeyFor(v23.id, VG, s23.id)
        && !again.dishTrimmed && !again.totalTrimmed,
      'order again: the two sizes of one dish get ONE dishKey (the menu card\'s key for that dish), nothing trimmed')
    const k23 = dishKeyFor(v23.id, VG, s23.id)
    const atFive = [ln(s23.id, 3, k23), ln(l23.id, 2, k23)]
    assert(addBlockReason(atFive, k23) === 'QUANTITY_LIMIT' && capQuantity(atFive, s23.id, 4) === 3 && capQuantity(atFive, l23.id, 3) === 2
        && limitBreach([ln(s23.id, 3, k23), ln(l23.id, 3, k23)]) === 'QUANTITY_LIMIT',
      'order again: 3 Small + 2 Large of that dish stop at 5 together (+ blocked on both sizes; 3 + 3 is a breach)')

    // ── 5 per dish, all sizes ──
    const SOUP = 'group|v1|Soup'
    assert(addBlockReason([ln('s', 3, SOUP), ln('l', 2, SOUP)], SOUP) === 'QUANTITY_LIMIT', '3 Small + 2 Large (one dish) → QUANTITY_LIMIT')
    assert(addBlockReason([ln('s', 3, SOUP), ln('l', 1, SOUP)], SOUP) === null, '3 Small + 1 Large → may add')
    assert(addBlockReason([ln('s', 3, SOUP), ln('l', 2, SOUP), ln('x', 1, 'item|x')], 'item|x') === null, 'a different dish in the same cart → may add')
    assert(dishQuantity([ln('s', 3, SOUP), ln('l', 2, SOUP), ln('x', 1)], SOUP) === 5 && totalQuantity([ln('s', 3, SOUP), ln('l', 2, SOUP), ln('x', 1)]) === 6,
      'dishQuantity counts all sizes of one dish; totalQuantity counts everything')

    // ── 15 in all ──
    const fifteen = [ln('a', 5, 'item|a'), ln('b', 5, 'item|b'), ln('c', 5, 'item|c')]
    const fourteen = [ln('a', 5, 'item|a'), ln('b', 5, 'item|b'), ln('c', 4, 'item|c')]
    assert(addBlockReason(fifteen, 'item|d') === 'ORDER_ITEM_LIMIT', '15 in the cart (two booths) → ORDER_ITEM_LIMIT for any dish')
    assert(addBlockReason(fourteen, 'item|d') === null && addBlockReason(fourteen, 'item|a') === 'QUANTITY_LIMIT', '14 → may add, unless that dish is full')
    assert(addBlockReason(fifteen, 'item|a') === 'ORDER_ITEM_LIMIT', 'both limits apply → ORDER_ITEM_LIMIT named first (as the server)')
    assert(limitBreach(fourteen) === null && limitBreach([ln('a', 6)]) === 'QUANTITY_LIMIT'
        && limitBreach([...fifteen, ln('d', 1, 'item|d')]) === 'ORDER_ITEM_LIMIT',
      'limitBreach: none within the limits; 6 of a dish → QUANTITY_LIMIT; 16 in all → ORDER_ITEM_LIMIT')

    // ── capQuantity ──
    assert(capQuantity([ln('s', 4, SOUP), ln('l', 1, SOUP)], 's', 6) === 4, 'capQuantity: Small at 4 with Large at 1, asking for 6 → 4')
    assert(capQuantity(fifteen, 'a', 6) === 5 && capQuantity(fifteen, 'c', 7) === 5, 'capQuantity: at 15 in all, asking for more → unchanged')
    assert(capQuantity(fifteen, 'b', 2) === 2, 'capQuantity: asking for less is granted')

    // ── trimToLimits ──
    const t1 = trimToLimits([ln('a', 7)])
    assert(shape(t1.lines) === 'a×5' && t1.dishTrimmed && !t1.totalTrimmed, 'trim: a saved line of 7 → 5, dishTrimmed only')
    const t2 = trimToLimits([ln('a', 5), ln('b', 5), ln('c', 5), ln('d', 5)])
    assert(shape(t2.lines) === 'a×5,b×5,c×5' && !t2.dishTrimmed && t2.totalTrimmed, 'trim: 20 across booths → 15, totalTrimmed only; a line cut to 0 is removed')
    const t3 = trimToLimits([ln('a', 7), ln('b', 5), ln('c', 5), ln('d', 5)])
    assert(shape(t3.lines) === 'a×5,b×5,c×5' && t3.dishTrimmed && t3.totalTrimmed, 'trim: both at once → both flags')
    const within = [ln('a', 2), ln('b', 3, SOUP)]
    const t4 = trimToLimits(within)
    assert(JSON.stringify(t4.lines) === JSON.stringify(within) && !t4.dishTrimmed && !t4.totalTrimmed, 'trim: a cart within the limits is unchanged, no flags')
    const t5 = trimToLimits([ln('s', 3), ln('l', 3)])
    const t6 = trimToLimits([ln('s', 3, SOUP), ln('l', 3, SOUP)])
    assert(shape(t5.lines) === 's×3,l×3' && !t5.dishTrimmed && shape(t6.lines) === 's×3,l×2' && t6.dishTrimmed,
      'trim: old lines without dishKey count per size; with one dishKey the sizes are cut to 5 together')

    // ── mergeLines + order again ──
    const m1 = mergeLines([ln('a', 1), ln('a', 1), ln('b', 1)])
    assert(shape(m1) === 'a×2,b×1', 'mergeLines: the same item on two lines → one line, quantities added, first-seen order')
    assert(mergeLines([ln('a', 1), ln('a', 1, SOUP)])[0].dishKey === SOUP, 'mergeLines: a missing dishKey is filled from a later line of the same item')
    const again20 = trimToLimits(mergeLines(Array.from({ length: 20 }, (_, i) => ln(`o${i}`, 1))))
    assert(again20.lines.length === 15 && totalQuantity(again20.lines) === 15 && again20.totalTrimmed && !again20.dishTrimmed,
      'order again: 20 one-each lines → 15 kept, totalTrimmed only (the 15-item sentence is shown)')
    const again3 = trimToLimits(mergeLines([ln('a', 1), ln('b', 1), ln('c', 1)]))
    assert(shape(again3.lines) === 'a×1,b×1,c×1' && !again3.totalTrimmed && !again3.dishTrimmed, 'order again: 3 lines within the limits → unchanged, nothing shown')

    // ── source rows (comments stripped, as [16] does) ──
    const strip = (f: string) => raw(f)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    const ctx = strip('app/_contexts/FairCartContext.tsx')
    assert(/case 'ADD_ITEM'[\s\S]*?if \(limitBreach\(next\) !== null\) return state/.test(ctx), 'context: ADD_ITEM does nothing when limitBreach(next) is not null')
    assert(/case 'UPDATE_QTY'[\s\S]*?capQuantity\(state\.items, action\.menuItemId, action\.quantity\)/.test(ctx), 'context: UPDATE_QTY uses capQuantity')
    assert(/case 'HYDRATE'[\s\S]*?trimToLimits\(savedCartLines\(action\.state\.items\)\)\.lines/.test(ctx)
        && /Number\.isInteger\(i\.quantity\) && i\.quantity >= 1/.test(ctx),
      'context: HYDRATE keeps the [16] filter (savedCartLines) and then trimToLimits')
    const replaceAt = ctx.indexOf('const replaceCart = useCallback(')
    const replaceBlock = ctx.slice(replaceAt, ctx.indexOf('const addBlockReason = useCallback(', replaceAt))
    assert(replaceAt > 0 && replaceBlock.includes('trimToLimits(mergeLines(lines.map(l => toCartItem(l.item, l.vendor))))')
        && replaceBlock.includes("dispatch({ type: 'REPLACE', items: trim.lines })") && replaceBlock.includes('announceCartTrim(trim)'),
      'context: replaceCart = toCartItem → mergeLines → trimToLimits → REPLACE → announceCartTrim')
    assert(ctx.includes("toast.error(ORDER_ITEM_LIMIT_MESSAGE, { id: 'cart-limit-total' })") && ctx.includes("toast.error(QUANTITY_LIMIT_MESSAGE, { id: 'cart-limit-dish' })"),
      'context: announceCartTrim shows the two fixed constants with fixed toast ids (each once)')
    assert(/const trim = trimToLimits\(savedCartLines\(parsed\.items\)\)\s*dispatch\(\{ type: 'HYDRATE', state: parsed \}\)\s*announceCartTrim\(trim\)/.test(ctx),
      'context: the hydrate effect says what the saved-cart trim cut')
    assert((ctx.match(/dishKey\?: string/g) ?? []).length === 2 && /dishKey: menuItem\.dishKey/.test(ctx), 'context: dishKey is optional on CartItem and AddableMenuItem and stored by toCartItem')
    assert(/const atOrderLimit = itemCount >= MAX_ITEMS_PER_ORDER/.test(ctx), 'context: atOrderLimit = itemCount >= MAX_ITEMS_PER_ORDER')

    const card = strip('components/menu/GroupedFoodCard.tsx')
    assert(/const dishKey = dishKeyFromGroup\(group\.groupKey, group\.vendorId, selected\.id\)/.test(card) && /const blocked = addBlockReason\(dishKey\)/.test(card)
        && /imageUrl: group\.imageUrl,\s*dishKey,/.test(card),
      'card: dishKey from dishKeyFromGroup(group.groupKey, group.vendorId, selected.id), passed to addItem')
    assert(card.includes('disabled={blocked !== null}') && card.includes('disabled={!selected.available || blocked !== null}')
        && card.includes('title={blockedTitle}') && card.includes('title={selected.available ? blockedTitle : undefined}'),
      'card: + and Add are disabled through addBlockReason, with the sentence as hover text')
    assert(/const blockedTitle =\s*blocked === 'ORDER_ITEM_LIMIT' \? ORDER_ITEM_LIMIT_MESSAGE\s*: blocked === 'QUANTITY_LIMIT' \? QUANTITY_LIMIT_MESSAGE\s*: undefined/.test(card),
      'card: blockedTitle is only the two imported constants')
    assert(/\{blockedTitle && !allUnavailable && selected\.available && \(\s*<p className="mt-1 text-xs [^"]*"[^>]*>\s*\{blockedTitle\}\s*<\/p>/.test(card),
      'card: when blocked, the sentence is rendered as visible text-xs text under the buttons (phones have no hover)')
    const addAt = card.indexOf('const handleAdd = () => {')
    const addBody = card.slice(addAt, card.indexOf('toast.success(', addAt))
    assert(addAt > 0 && addBody.includes('if (blocked !== null) return') && addBody.includes('addItem('), 'card: handleAdd returns before addItem and "added" when blocked')

    const cartPage = strip('app/fair/[fairSlug]/cart/page.tsx')
    assert(cartPage.includes('disabled={addBlockReason(dishKeyOf(item)) !== null}') && cartPage.includes('title={limitTitle(addBlockReason(dishKeyOf(item)))}'),
      'cart page: each + is disabled through addBlockReason(dishKeyOf(item)) and keeps its hover text')
    assert(/function limitTitle\(reason: OrderLimitCode \| null\): string \| undefined \{\s*if \(reason === 'ORDER_ITEM_LIMIT'\) return ORDER_ITEM_LIMIT_MESSAGE\s*if \(reason === 'QUANTITY_LIMIT'\) return QUANTITY_LIMIT_MESSAGE\s*return undefined\s*\}/.test(cartPage),
      'cart page: limitTitle returns only the two imported constants')
    const totalMsgAt = cartPage.indexOf('{ORDER_ITEM_LIMIT_MESSAGE}')
    assert((cartPage.match(/\{ORDER_ITEM_LIMIT_MESSAGE\}/g) ?? []).length === 1
        && /\{atOrderLimit && \(\s*<p className="mb-3 text-xs [^"]*"[^>]*>\s*\{ORDER_ITEM_LIMIT_MESSAGE\}/.test(cartPage)
        && totalMsgAt > 0 && totalMsgAt < cartPage.indexOf('Order Summary'),
      'cart page: the 15-item sentence is rendered exactly once, under atOrderLimit, above the Order Summary')
    assert((cartPage.match(/\{QUANTITY_LIMIT_MESSAGE\}/g) ?? []).length === 1
        && /\{addBlockReason\(dishKeyOf\(item\)\) === 'QUANTITY_LIMIT' && \(\s*<p className="mt-1 text-xs [^"]*"[^>]*>\s*\{QUANTITY_LIMIT_MESSAGE\}/.test(cartPage),
      'cart page: the 5-per-dish sentence is visible text-xs text under a line only when that line is at QUANTITY_LIMIT')

    const checkout = strip('app/fair/[fairSlug]/checkout/page.tsx')
    assert(/\{atOrderLimit && \(\s*<p className="[^"]*text-xs[^"]*"[^>]*>\s*\{ORDER_ITEM_LIMIT_MESSAGE\}/.test(checkout), 'checkout: the 15-item sentence is shown under atOrderLimit')
    const hAt = checkout.indexOf('const handlePlaceOrder = async (expectedTotalCents: number) => {')
    const handler = checkout.slice(hAt, checkout.indexOf('const handleSuccess', hAt))
    const totalBranch = handler.search(/if \(code === 'ORDER_ITEM_LIMIT'\) \{\s*toast\.error\(ORDER_ITEM_LIMIT_MESSAGE, \{ id: 'cart-limit-total' \}\)\s*return\s*\}/)
    const dishBranch = handler.search(/if \(code === 'QUANTITY_LIMIT'\) \{\s*toast\.error\(QUANTITY_LIMIT_MESSAGE, \{ id: 'cart-limit-dish' \}\)\s*return\s*\}/)
    // The GENERIC toast (the handler's last one). The address-fields branch earlier has its own
    // `toast.error(message ?? 'Please check the delivery address')`, which a limit refusal never reaches.
    const generic = handler.indexOf("toast.error(message ?? 'Failed to create order")
    assert(hAt > 0 && totalBranch > 0 && dishBranch > 0 && generic > totalBranch && generic > dishBranch,
      'checkout: a server 400 ORDER_ITEM_LIMIT / QUANTITY_LIMIT shows the page\'s constant (fixed toast ids), before the generic server-text toast')
    const tryAt = handler.indexOf('try {')
    const finAt = handler.indexOf('} finally {')
    assert(tryAt > 0 && tryAt < totalBranch && dishBranch < finAt
        && /\} finally \{\s*inFlight\.current = false\s*setSubmitting\(false\)/.test(handler.slice(finAt)),
      'checkout: the limit branches return inside the try, so the finally resets inFlight and submitting (the button is never stuck)')
    assert(!handler.includes('dishKey'), 'checkout: the order request never sends dishKey')

    assert(/variantGroup\?: string \| null/.test(strip('components/order/types.ts')), 'order type: menuItem.variantGroup is optional')
    assert(strip('app/api/orders/[id]/route.ts').includes('menuItem: { select: { name: true, imageUrl: true, category: true, prepTime: true, variantGroup: true } }'),
      'order API: the menuItem select adds variantGroup, and only that')
    const orderPage = strip('app/fair/[fairSlug]/order/[orderId]/page.tsx')
    const againAt = orderPage.indexOf('const handleOrderAgain = useCallback(')
    const againBody = orderPage.slice(againAt, orderPage.indexOf('if (loading)', againAt))
    assert(againAt > 0 && againBody.includes('replaceCart(order.orderItems.map(')
        && againBody.includes('dishKey: dishKeyFor(item.vendorId, item.menuItem.variantGroup, item.menuItemId)')
        && !/clearCart\(|addItem\(/.test(orderPage),
      'order page: "order again" uses replaceCart with dishKeyFor(vendorId, variantGroup, id); no clearCart/addItem loop')
    assert(/inPersonPrice: item\.inPersonUnitPrice \?\? item\.unitPrice/.test(orderPage), 'order page: the [16] in-person line is still there')

    const screens = ['app/_contexts/FairCartContext.tsx', 'components/menu/GroupedFoodCard.tsx', 'app/fair/[fairSlug]/cart/page.tsx',
      'app/fair/[fairSlug]/checkout/page.tsx', 'app/fair/[fairSlug]/order/[orderId]/page.tsx']
    const typed = screens.filter(f => /Orders are limited to|at most 5 of each|order at most \d/.test(strip(f)))
    assert(typed.length === 0 && screens.slice(0, 4).every(f => /from '@\/lib\/order-limits'/.test(raw(f))),
      `no limit sentence typed out by hand; the screens import lib/order-limits (${typed.join(', ') || 'none typed'})`)
  }
}

main()
  .catch(e => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
