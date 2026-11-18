/**
 * DEMO BOOTHS (Jordan, Nov 16; sub-step D; closes organizer gap check S3). Real routes and lib,
 * test DB, Clerk mocked, Stripe stubbed (paymentIntents.create recorded, never sent; the payouts
 * status read through its seam). The "live" keys below are FAKE strings built from pieces; no real
 * key is used and Stripe is never called.
 *
 *   [1] live or test (lib/stripe-mode.ts): only sk_test_/rk_test_ is test; live, restricted live,
 *       unknown and missing keys all count as LIVE (fails closed)
 *   [2] the switch: strict admins only; logged (DEMO_ON / DEMO_OFF, name, role) in the same
 *       transaction; same value again → no change, no log; bad body 400; unknown vendor 404
 *  [2c] leaving demo (F3, Nov 17): a booth that is not PENDING is asked fresh about Stripe payouts;
 *       not ready / unreachable → refused and NOTHING changes; a change during the Stripe call is
 *       refused; ready → switched, recorded "Stripe checked"; PENDING and demo ON unchanged;
 *       F13: every demo switch expires its caches at once ({ expire: 0 })
 *   [3] nobody else can set it: organizer PATCH, the vendor's own PATCH; source: one writer
 *   [4] approval: a demo booth needs no Stripe (not asked); documents, menu and booth still
 *       required; an organizer can lift a demo booth's pause without payouts; non-demo controls
 *   [5] checkout: live → 409 VENDOR_DEMO before any write or Stripe call (sk_live_, rk_live_,
 *       empty, missing key; a mixed cart too); test mode → a demo test order goes through; a
 *       normal booth is unaffected in live mode
 *   [6] every customer reader: demo hidden with live keys, shown in test mode
 *  [6b] the last 2 customer reads (review F10, Nov 17): GET /api/menu/[id] → 404 for a demo item;
 *       GET /api/favorites leaves it out but keeps the saved favorite; POST /api/favorites → 404;
 *       all shown/accepted in test mode; source checks
 *   [7] badges: the admin roster and the organizer views carry isDemo; source checks per reader
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/demo-vendor-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST
delete process.env.ENFORCE_VENDOR_READINESS
delete process.env.SLACK_WEBHOOK_URL

import { createRequire, register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)
// TEST-ONLY SHIM, as in scripts/online-markup-test.ts: lib/menu/getGroupedMenuItems.ts uses a bare
// `require('next/cache')` that does not exist in an ES-module script. Here `next/cache` is answered
// with the same test stand-in the route loader uses (scripts/_next-cache-mock.mjs: unstable_cache(fn)
// just runs fn), so the real menu reader runs against the test DB ([6]). Every other require loads normally.
import * as nextCacheMock from './_next-cache-mock.mjs'
const realRequire = createRequire(import.meta.url)
;(globalThis as unknown as { require?: unknown }).require =
  Object.assign((id: string) => (id === 'next/cache' ? nextCacheMock : realRequire(id)), realRequire)

import { readFileSync, readdirSync } from 'node:fs'
import { NextRequest } from 'next/server'

/** Every .ts/.tsx file under `dir` (forward-slash paths). */
function walkTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walkTs(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [])
}
import { EventListing, EventStatus, VendorStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'demo-'
const MAIL = '@demo.local'
const rand = () => Math.random().toString(36).slice(2, 8)

// Fake keys, built from pieces so no scanner mistakes them for real ones. Never sent anywhere.
const FAKE_LIVE = ['sk', 'live', 'demofake', 'never', 'sent'].join('_')
const FAKE_RESTRICTED_LIVE = ['rk', 'live', 'demofake', 'never', 'sent'].join('_')
const FAKE_TEST = ['sk', 'test', 'demofake', 'never', 'sent'].join('_')
const FAKE_RESTRICTED_TEST = ['rk', 'test', 'demofake'].join('_')
const setKey = (k: string | undefined) => { if (k === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = k }

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
type Who = { id: string; roles: string[]; fullName?: string }
const login = (who: Who | null) => {
  (globalThis as unknown as { __MOCK_CLERK?: unknown }).__MOCK_CLERK = who
    ? { userId: who.id, publicMetadata: { roles: who.roles }, fullName: who.fullName }
    : undefined
}
const req = (url: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
})
interface Json {
  success?: boolean
  error?: { code?: string; message?: string; details?: { missing?: string[] } }
  data?: Record<string, unknown> & { vendors?: { id: string; isDemo?: boolean }[]; fairs?: { slug: string; vendorCount: number }[]; _count?: { vendors?: number } }
}
async function call(p: Promise<Response>) {
  const r = await p
  const text = await r.text()
  let j: Json = {}
  try { j = JSON.parse(text) as Json } catch { /* not JSON */ }
  return { status: r.status, code: j.error?.code, message: j.error?.message, details: j.error?.details, data: j.data, json: j, raw: text }
}

const SUPER: Who = { id: `${PFX}super`, roles: ['super_admin'], fullName: 'Sam Super' }
const ADMIN: Who = { id: `${PFX}admin`, roles: ['admin'], fullName: 'Avery Admin' }
const PM: Who = { id: `${PFX}pm`, roles: ['platform_manager'] }
const EVOP: Who = { id: `${PFX}evop`, roles: ['event_operator'] }

let stripeStatusCalls = 0
const askedAccounts: string[] = []
const payoutsStub = new Map<string, { readyToReceivePayments: boolean; payoutsEnabled: boolean } | Error>()
let duringCheck: ((acct: string) => Promise<void>) | null = null
// The route's cache calls (scripts/_route-loader.mjs answers `next/cache` with this same module).
const cacheCalls = () => (nextCacheMock as unknown as { revalidatedWith: { tag: string; profile: unknown }[] }).revalidatedWith

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const oids = (await prisma.order.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(o => o.id)
    if (oids.length) {
      await prisma.vendorOrderStatus.deleteMany({ where: { orderId: { in: oids } } })
      await prisma.orderItem.deleteMany({ where: { orderId: { in: oids } } })
      await prisma.order.deleteMany({ where: { id: { in: oids } } })
    }
    const vids = (await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(v => v.id)
    await prisma.approvalAction.deleteMany({ where: { applicationId: { in: vids } } })
    if (vids.length) await prisma.notification.deleteMany({ where: { OR: vids.map(v => ({ dedupeKey: { contains: v } })) } })
    await prisma.payeeNotice.deleteMany({ where: { payeeId: { in: vids } } })
    await prisma.vendorAuditLog.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { id: { in: vids } } })
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.eventMarkupChange.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { OR: [{ email: { endsWith: MAIL } }, { clerkId: { startsWith: PFX } }] } })
}

async function main() {
  await cleanup()
  const originalKey = process.env.STRIPE_SECRET_KEY

  // ── [1] live or test ────────────────────────────────────────────────────────────────────
  console.log('\n[1] Live or test: only a TEST key means test mode (fails closed)')
  const { stripeLiveMode } = await import('../lib/stripe-mode')
  assert(stripeLiveMode(FAKE_TEST) === false && stripeLiveMode(FAKE_RESTRICTED_TEST) === false, 'sk_test_… and rk_test_… → test mode')
  assert(stripeLiveMode(FAKE_LIVE) === true && stripeLiveMode(FAKE_RESTRICTED_LIVE) === true, 'sk_live_… and rk_live_… → LIVE')
  // "Missing" is tested the way it happens: no STRIPE_SECRET_KEY in the environment at all.
  // (Passing `undefined` would select the default parameter, i.e. whatever key is set.)
  setKey(undefined)
  const missingIsLive = stripeLiveMode()
  setKey(originalKey)
  assert(stripeLiveMode('') === true && missingIsLive === true && stripeLiveMode('pk_test_x') === true && stripeLiveMode('whatever') === true,
    'an empty, missing (no variable at all) or unknown key → LIVE (never treated as test)')

  // ── fixtures ────────────────────────────────────────────────────────────────────────────
  const payouts = await import('../lib/vendor-payouts-check')
  // Per account: a status, or an Error to throw. Unset → ready. `duringCheck` runs while Stripe is
  // "being asked", so [2c] can change the booth in that gap (the race the route guards against).
  payouts.__setStripePayoutsStatusForTest(async (acct: string) => {
    stripeStatusCalls++
    askedAccounts.push(acct)
    if (duringCheck) await duringCheck(acct)
    const a = payoutsStub.get(acct) ?? { readyToReceivePayments: true, payoutsEnabled: true }
    if (a instanceof Error) throw a
    return a
  })
  const rl = await import('../lib/ratelimit')
  const allowAll = { limit: async () => ({ success: true, limit: 999, remaining: 999, reset: Date.now() + 3600e3 }) }
  rl.__setStateForTest({ type: 'ready', limiters: new Proxy({}, { get: () => allowAll }) as never })
  const { stripe } = await import('../lib/stripe')
  const piCalls: unknown[] = []
  const pis = stripe.paymentIntents as unknown as { create: (p: unknown) => Promise<unknown>; update: (...a: unknown[]) => Promise<unknown> }
  pis.create = async (p: unknown) => { piCalls.push(p); return { id: `pi_${PFX}${rand()}`, client_secret: `pi_${PFX}secret_${rand()}`, metadata: {} } }
  pis.update = async () => ({})

  await prisma.user.create({ data: { clerkId: SUPER.id, email: `super${MAIL}`, name: 'Super' } })
  const orgUser = await prisma.user.create({ data: { clerkId: `${PFX}orgu`, email: `orgu${MAIL}`, name: 'Olive Organizer' } })
  const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}Board`, contactEmail: `board${MAIL}`, approvalStatus: 'APPROVED' } })
  await prisma.orgMember.create({ data: { organizerId: org.id, userId: orgUser.id, role: 'owner' } })
  const ORG: Who = { id: orgUser.clerkId, roles: ['organizer'] }

  const now = Date.now()
  const liveFair = await prisma.event.create({ data: {
    name: `${PFX}Live Fair`, urlSlug: `${PFX}live-${rand()}`, status: EventStatus.ACTIVE, listing: EventListing.PUBLIC,
    startDate: new Date(now - 864e5), endDate: new Date(now + 864e5),
    fulfillmentConfig: { create: { boothPickupEnabled: true } },
  } })
  const fsFair = await prisma.event.create({ data: { name: `${PFX}FS Fair`, urlSlug: `${PFX}fs-${rand()}`, status: EventStatus.UPCOMING, startDate: new Date(now), endDate: new Date(now + 864e5) } })
  const orgFair = await prisma.event.create({ data: { name: `${PFX}Org Fair`, urlSlug: `${PFX}org-${rand()}`, status: EventStatus.UPCOMING, organizerId: org.id, startDate: new Date(now), endDate: new Date(now + 864e5) } })

  const DOCS = { foodHandlerPermitPath: 'x/fh.pdf', insurancePath: 'x/ins.pdf', businessLicensePath: 'x/bl.pdf' }
  const mkVendor = async (opts: { eventId: string; status?: VendorStatus; isDemo?: boolean; menu?: boolean; booth?: boolean; account?: string | null; stored?: boolean; name?: string }) => {
    const u = await prisma.user.create({ data: { clerkId: `${PFX}vu-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'Owner' } })
    const v = await prisma.vendor.create({
      data: {
        eventId: opts.eventId, name: opts.name ?? `${PFX}Booth ${rand()}`, slug: `${PFX}v-${rand()}`, cuisineType: 'Tacos',
        status: opts.status ?? VendorStatus.ACTIVE, isDemo: opts.isDemo ?? false, ...DOCS,
        ...(opts.booth !== false && { boothNumber: 'A1' }),
        stripeVerified: opts.stored ?? false, stripeAccountId: opts.account ?? null,
        vendorMembers: { create: { userId: u.id, role: 'owner', approvalStatus: 'APPROVED' } },
      },
    })
    const item = opts.menu === false ? null : await prisma.menuItem.create({ data: { vendorId: v.id, name: `${PFX}Taco`, price: 10, category: 'Mains', isAvailable: true } })
    return { vendor: v, user: u, item }
  }
  const isDemoOf = async (id: string) => (await prisma.vendor.findUniqueOrThrow({ where: { id }, select: { isDemo: true } })).isDemo

  // ── [2] the switch ──────────────────────────────────────────────────────────────────────
  console.log('\n[2] The demo switch: strict admins only, logged')
  const demoRoute = (await import('../app/api/admin/vendors/[id]/demo/route')).PATCH
  const setDemo = (who: Who | null, id: string, body: unknown) => { login(who); return call(demoRoute(req(`/api/admin/vendors/${id}/demo`, 'PATCH', body), { params: Promise.resolve({ id }) })) }
  // A linked account (the stub answers "ready"): since F3, switching an ACTIVE booth out of demo
  // asks Stripe, and a booth with no account is refused ([2c] covers that).
  const sw = await mkVendor({ eventId: liveFair.id, account: `acct_${PFX}${rand()}` })
  const on = await setDemo(SUPER, sw.vendor.id, { demo: true })
  const logs1 = await prisma.approvalAction.findMany({ where: { applicationId: sw.vendor.id } })
  assert(on.status === 200 && on.data?.changed === true && await isDemoOf(sw.vendor.id) === true, `super_admin → demo on (got ${on.status})`)
  // Field by field: Postgres jsonb stores keys in its own order, so the text form can't be compared.
  const d1 = logs1[0]?.detail as { from?: unknown; to?: unknown } | null
  assert(logs1.length === 1 && logs1[0].action === 'DEMO_ON' && logs1[0].actorName === 'Sam Super' && logs1[0].actorType === 'super_admin'
    && d1?.from === false && d1?.to === true,
  `logged: DEMO_ON, the admin's name and role, from → to (got ${logs1[0]?.action}/${logs1[0]?.actorName}/${logs1[0]?.actorType}/${JSON.stringify(d1)})`)
  const again = await setDemo(SUPER, sw.vendor.id, { demo: true })
  assert(again.status === 200 && again.data?.changed === false && (await prisma.approvalAction.count({ where: { applicationId: sw.vendor.id } })) === 1,
    'the same value again → 200, changed false, no second log row')
  const off = await setDemo(ADMIN, sw.vendor.id, { demo: false })
  const offLog = await prisma.approvalAction.findFirst({ where: { applicationId: sw.vendor.id, action: 'DEMO_OFF' } })
  assert(off.status === 200 && await isDemoOf(sw.vendor.id) === false && offLog?.actorName === 'Avery Admin' && offLog.actorType === 'admin',
    `admin → demo off, logged DEMO_OFF (got ${off.status})`)
  for (const [body, label] of [[{ demo: 'yes' }, 'a string'], [{}, 'nothing'], [{ demo: 1 }, 'a number']] as const) {
    const r = await setDemo(SUPER, sw.vendor.id, body)
    assert(r.status === 400 && r.code === 'VALIDATION_ERROR', `demo = ${label} → 400 (got ${r.status})`)
  }
  for (const who of [PM, EVOP, ORG, { id: sw.user.clerkId, roles: ['vendor'] }]) {
    const r = await setDemo(who, sw.vendor.id, { demo: true })
    assert(r.status === 403 && await isDemoOf(sw.vendor.id) === false, `${who.roles[0]} → 403, unchanged (got ${r.status})`)
  }
  const anon = await setDemo(null, sw.vendor.id, { demo: true })
  assert(anon.status === 401 && await isDemoOf(sw.vendor.id) === false, `signed out → 401 (got ${anon.status})`)
  const unknown = await setDemo(SUPER, 'no-such-vendor', { demo: true })
  assert(unknown.status === 404, `unknown vendor → 404 (got ${unknown.status})`)

  // ── [2c] leaving demo re-checks payouts (review F3, F13) ────────────────────────────────
  console.log('\n[2c] Demo off on a booth that is not PENDING asks Stripe fresh; refused → nothing changes')
  // Its own fair, so these booths never count in the reader checks on liveFair ([6]).
  const offFair = await prisma.event.create({ data: { name: `${PFX}Off Fair`, urlSlug: `${PFX}off-${rand()}`, status: EventStatus.ACTIVE, startDate: new Date(now - 864e5), endDate: new Date(now + 864e5) } })
  const FIVE_TAGS = (slug: string, id: string) => ['vendors', 'fair', 'vendor-menu', `vendor-${id}`, `event-menu-${slug}`].sort()
  const offLogs = (id: string) => prisma.approvalAction.count({ where: { applicationId: id, action: 'DEMO_OFF' } })
  const statusOf = async (id: string) => (await prisma.vendor.findUniqueOrThrow({ where: { id }, select: { status: true } })).status
  /** A refused DEMO_OFF: still demo, same status, no DEMO_OFF row, no cache busted. */
  const refusedOff = async (label: string, x: { vendor: { id: string; name: string; status: VendorStatus } }, want: { status: number; code: string }) => {
    const cacheBefore = cacheCalls().length
    const r = await setDemo(ADMIN, x.vendor.id, { demo: false })
    assert(r.status === want.status && r.code === want.code && !!r.message?.includes('Nothing was changed')
      && (want.status !== 409 || want.code === 'ALREADY_CHANGED' || !!r.message?.includes(x.vendor.name)),
    `${label} → ${want.status} ${want.code}, message names the booth and says nothing changed (got ${r.status} ${r.code}: ${r.message})`)
    assert(await isDemoOf(x.vendor.id) === true && await statusOf(x.vendor.id) === x.vendor.status && await offLogs(x.vendor.id) === 0
      && cacheCalls().length === cacheBefore,
    '…and nothing changed: still a demo booth, same status, no DEMO_OFF record, no cache busted')
  }
  const mkDemoBooth = (status: VendorStatus, account: string | null) => mkVendor({ eventId: offFair.id, status, isDemo: true, account })

  await refusedOff('ACTIVE demo booth, no Stripe account', await mkDemoBooth(VendorStatus.ACTIVE, null), { status: 409, code: 'VENDOR_STRIPE_NOT_LINKED' })
  const npAcct = `acct_${PFX}np-${rand()}`
  payoutsStub.set(npAcct, { readyToReceivePayments: true, payoutsEnabled: false })
  await refusedOff('ACTIVE demo booth, payouts not enabled', await mkDemoBooth(VendorStatus.ACTIVE, npAcct), { status: 409, code: 'VENDOR_PAYOUTS_NOT_ENABLED' })
  const downAcct = `acct_${PFX}down-${rand()}`
  payoutsStub.set(downAcct, new Error('stripe down (stub)'))
  await refusedOff('ACTIVE demo booth, Stripe unreachable', await mkDemoBooth(VendorStatus.ACTIVE, downAcct), { status: 503, code: 'STRIPE_CHECK_FAILED' })
  for (const st of [VendorStatus.PAUSED, VendorStatus.SUSPENDED, VendorStatus.REJECTED]) {
    await refusedOff(`${st} demo booth, no Stripe account`, await mkDemoBooth(st, null), { status: 409, code: 'VENDOR_STRIPE_NOT_LINKED' })
  }

  // The race: the booth changes WHILE Stripe is being asked → the flip is refused, not let through.
  for (const [label, change] of [
    ['its Stripe account is swapped', { stripeAccountId: `acct_${PFX}other-${rand()}` }],
    ['it is paused', { status: VendorStatus.PAUSED }],
  ] as const) {
    const rc = await mkDemoBooth(VendorStatus.ACTIVE, `acct_${PFX}race-${rand()}`)
    duringCheck = async () => { await prisma.vendor.update({ where: { id: rc.vendor.id }, data: change }) }
    const r = await setDemo(ADMIN, rc.vendor.id, { demo: false })
    duringCheck = null
    assert(r.status === 409 && r.code === 'ALREADY_CHANGED' && await isDemoOf(rc.vendor.id) === true && await offLogs(rc.vendor.id) === 0,
      `race: ${label} while Stripe is asked → 409 ALREADY_CHANGED, still a demo booth, no DEMO_OFF record (got ${r.status} ${r.code})`)
  }

  // Ready → switched; Stripe asked once, for THIS booth; recorded with "Stripe checked"; cache expired at once.
  const ready = await mkDemoBooth(VendorStatus.ACTIVE, `acct_${PFX}ok-${rand()}`)
  const askedBefore = askedAccounts.length
  const cacheBeforeOk = cacheCalls().length
  const okOff = await setDemo(ADMIN, ready.vendor.id, { demo: false })
  const okRow = await prisma.approvalAction.findFirst({ where: { applicationId: ready.vendor.id, action: 'DEMO_OFF' } })
  const okDetail = okRow?.detail as { stripeChecked?: unknown; status?: unknown } | null
  assert(okOff.status === 200 && await isDemoOf(ready.vendor.id) === false && await statusOf(ready.vendor.id) === 'ACTIVE',
    `ACTIVE demo booth, payouts ready → 200, no longer demo, still ACTIVE (never sent back to PENDING) (got ${okOff.status} ${okOff.code ?? ''})`)
  assert(JSON.stringify(askedAccounts.slice(askedBefore)) === JSON.stringify([ready.vendor.stripeAccountId]),
    `Stripe was asked exactly once, for THIS booth's account (got ${JSON.stringify(askedAccounts.slice(askedBefore))})`)
  assert(okRow?.actorName === 'Avery Admin' && okRow.actorType === 'admin' && okDetail?.stripeChecked === true && okDetail?.status === 'ACTIVE',
    `the DEMO_OFF record says who (name, role) and "Stripe checked" (got ${okRow?.actorName}/${okRow?.actorType}/${JSON.stringify(okRow?.detail)})`)
  const okCache = cacheCalls().slice(cacheBeforeOk)
  assert(JSON.stringify(okCache.map(c => c.tag).sort()) === JSON.stringify(FIVE_TAGS(offFair.urlSlug, ready.vendor.id))
    && okCache.every(c => JSON.stringify(c.profile) === JSON.stringify({ expire: 0 })),
  `F13: demo off expires the 5 caches at once ({ expire: 0 }), none merely marked stale (got ${JSON.stringify(okCache)})`)

  // PENDING: unchanged behaviour (approval will ask), plus the record says Stripe was NOT checked here.
  const pend = await mkVendor({ eventId: offFair.id, status: VendorStatus.PENDING, isDemo: true, account: null })
  const askedBeforeP = askedAccounts.length
  const pOff = await setDemo(ADMIN, pend.vendor.id, { demo: false })
  const pRow = await prisma.approvalAction.findFirst({ where: { applicationId: pend.vendor.id, action: 'DEMO_OFF' } })
  assert(pOff.status === 200 && await isDemoOf(pend.vendor.id) === false && askedAccounts.length === askedBeforeP
    && (pRow?.detail as { stripeChecked?: unknown } | null)?.stripeChecked === false,
  `PENDING demo booth, no account → 200, Stripe NOT asked (approval will), recorded as not checked (got ${pOff.status}, ${JSON.stringify(pRow?.detail)})`)

  // DEMO_ON: unchanged — no Stripe question, even with no account; caches expired at once too.
  const onB = await mkVendor({ eventId: offFair.id, status: VendorStatus.ACTIVE, account: null })
  const askedBeforeOn = askedAccounts.length
  const cacheBeforeOn = cacheCalls().length
  const onR = await setDemo(ADMIN, onB.vendor.id, { demo: true })
  const onCache = cacheCalls().slice(cacheBeforeOn)
  assert(onR.status === 200 && await isDemoOf(onB.vendor.id) === true && askedAccounts.length === askedBeforeOn,
    `[0] control: demo ON for an ACTIVE booth with no account → 200, Stripe not asked (got ${onR.status})`)
  assert(JSON.stringify(onCache.map(c => c.tag).sort()) === JSON.stringify(FIVE_TAGS(offFair.urlSlug, onB.vendor.id))
    && onCache.every(c => JSON.stringify(c.profile) === JSON.stringify({ expire: 0 })),
  `F13: demo on expires the 5 caches at once ({ expire: 0 }) (got ${JSON.stringify(onCache)})`)

  // ── [3] nobody else can set it ──────────────────────────────────────────────────────────
  console.log('\n[3] Nobody else can set it')
  const ow = await mkVendor({ eventId: orgFair.id, status: VendorStatus.ACTIVE, stored: true })
  await prisma.approvalAction.create({ data: { action: 'APPROVE', applicationType: 'vendor', applicationId: ow.vendor.id, actorId: 'seed', actorType: 'admin' } })
  const orgPATCH = (await import('../app/api/organizer/vendors/[id]/route')).PATCH
  const orgSet = (id: string, body: object) => { login(ORG); return call(orgPATCH(req(`/api/organizer/vendors/${id}`, 'PATCH', body), { params: Promise.resolve({ id }) })) }
  const o1 = await orgSet(ow.vendor.id, { isDemo: true })
  const o2 = await orgSet(ow.vendor.id, { status: 'PAUSED', isDemo: true })
  assert(o1.status === 400 && o2.status === 200 && await isDemoOf(ow.vendor.id) === false,
    `organizer PATCH ignores isDemo (alone → 400 "no valid fields"; with a status → the status only) (got ${o1.status}/${o2.status})`)
  const vendorPATCH = (await import('../app/api/vendors/[id]/route')).PATCH
  login({ id: ow.user.clerkId, roles: ['vendor'] })
  const vp = await call(vendorPATCH(req(`/api/vendors/${ow.vendor.id}`, 'PATCH', { isDemo: true }), { params: Promise.resolve({ id: ow.vendor.id }) }))
  assert(await isDemoOf(ow.vendor.id) === false, `the vendor's own PATCH can't set it (status ${vp.status}, isDemo still false)`)
  const files = ['app', 'lib'].flatMap(dir => walkTs(dir))
  const writers = files.filter(f => /data:\s*\{[^}]*\bisDemo\b/.test(readFileSync(f, 'utf8')))
  assert(files.length > 200 && JSON.stringify(writers) === JSON.stringify(['app/api/admin/vendors/[id]/demo/route.ts']),
    `source: in app/ and lib/ (${files.length} files), the ONLY write of isDemo is the admin demo route (got ${JSON.stringify(writers)})`)

  // ── [4] approval ────────────────────────────────────────────────────────────────────────
  console.log('\n[4] Approval: a demo booth needs no Stripe; documents, menu, booth still required')
  const decideRoute = (await import('../app/api/admin/approvals/[kind]/[id]/route')).POST
  const approveAs = (who: Who, id: string) => { login(who); return call(decideRoute(req(`/api/admin/approvals/vendor/${id}`, 'POST', { decision: 'approve' }), { params: Promise.resolve({ kind: 'vendor', id }) })) }
  const ownerOf = async (vendorId: string) => (await prisma.vendorMember.findFirstOrThrow({ where: { vendorId } })).id
  const mkPending = async (o: { isDemo: boolean; menu?: boolean; booth?: boolean }) => {
    const x = await mkVendor({ eventId: fsFair.id, status: VendorStatus.PENDING, ...o })
    await prisma.vendorMember.update({ where: { id: await ownerOf(x.vendor.id) }, data: { approvalStatus: 'PENDING' } })
    return x
  }
  const dGood = await mkPending({ isDemo: true })
  const callsBefore = stripeStatusCalls
  const a1 = await approveAs(SUPER, dGood.vendor.id)
  assert(a1.status === 200 && (await prisma.vendor.findUniqueOrThrow({ where: { id: dGood.vendor.id } })).status === 'ACTIVE' && stripeStatusCalls === callsBefore,
    `demo booth with NO Stripe account → approved, and Stripe is not asked (got ${a1.status} ${a1.code ?? ''})`)
  const dNoMenu = await mkPending({ isDemo: true, menu: false })
  const a2 = await approveAs(SUPER, dNoMenu.vendor.id)
  assert(a2.status === 409 && a2.code === 'VENDOR_NOT_READY_TO_GO_LIVE' && JSON.stringify(a2.details?.missing) === '["Add your menu"]',
    `demo booth with no menu → 409, missing only "Add your menu" (not payouts) (got ${a2.code} ${JSON.stringify(a2.details?.missing)})`)
  const dNoBooth = await mkPending({ isDemo: true, booth: false })
  const a3 = await approveAs(SUPER, dNoBooth.vendor.id)
  assert(a3.status === 409 && JSON.stringify(a3.details?.missing) === '["Set booth number"]', `demo booth with no booth number → 409 "Set booth number" (got ${JSON.stringify(a3.details?.missing)})`)
  const nGood = await mkPending({ isDemo: false })
  const a4 = await approveAs(SUPER, nGood.vendor.id)
  assert(a4.status === 409 && a4.code === 'VENDOR_STRIPE_NOT_LINKED', `[0] control: the same booth NOT demo → 409 VENDOR_STRIPE_NOT_LINKED (got ${a4.code})`)
  // An organizer lifting a pause: the stored payouts item is skipped for a demo booth.
  const lift = async (isDemo: boolean) => {
    const x = await mkVendor({ eventId: orgFair.id, status: VendorStatus.PAUSED, isDemo, stored: false })
    await prisma.approvalAction.create({ data: { action: 'APPROVE', applicationType: 'vendor', applicationId: x.vendor.id, actorId: 'seed', actorType: 'admin' } })
    return { x, r: await orgSet(x.vendor.id, { status: 'ACTIVE' }) }
  }
  const liftDemo = await lift(true), liftNormal = await lift(false)
  assert(liftDemo.r.status === 200 && liftNormal.r.status === 409 && JSON.stringify(liftNormal.r.details?.missing) === '["Connect payouts"]',
    `organizer lifts a pause: demo booth with no payouts → 200; [0] control: the same non-demo → 409 "Connect payouts" (got ${liftDemo.r.status}/${liftNormal.r.status})`)

  // ── [5] checkout ────────────────────────────────────────────────────────────────────────
  console.log('\n[5] Checkout: live → refused before anything; test → a test order goes through')
  const demoBooth = await mkVendor({ eventId: liveFair.id, isDemo: true, name: `${PFX}Demo Grill` })
  const realBooth = await mkVendor({ eventId: liveFair.id, isDemo: false, name: `${PFX}Real Grill` })
  const orderPOST = (await import('../app/api/orders/route')).POST
  const { checkoutTotals, toCents } = await import('../lib/checkout-total')
  const place = (items: { id: string; vendorId: string; price: number }[]) => {
    login({ id: `${PFX}cust`, roles: [] })
    const expectedTotalCents = checkoutTotals({ lines: items.map(i => ({ inPersonCents: toCents(i.price), quantity: 1 })), markupBps: 0, deliveryFeeCents: 0, serviceChargeCents: 0, tipCents: 0 }).totalCents
    return call(orderPOST(new NextRequest('http://localhost/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: liveFair.id, fulfillmentType: 'BOOTH_PICKUP', customerName: 'C', customerPhone: '6185550100', expectedTotalCents,
        items: items.map(i => ({ menuItemId: i.id, vendorId: i.vendorId, quantity: 1 })) }),
    })))
  }
  const dItem = { id: demoBooth.item!.id, vendorId: demoBooth.vendor.id, price: 10 }
  const rItem = { id: realBooth.item!.id, vendorId: realBooth.vendor.id, price: 10 }
  const orders = () => prisma.order.count({ where: { eventId: liveFair.id } })
  for (const [key, label] of [[FAKE_LIVE, 'sk_live_'], [FAKE_RESTRICTED_LIVE, 'rk_live_'], ['', 'an empty key'], [undefined, 'no key']] as const) {
    setKey(key)
    const before = { orders: await orders(), pi: piCalls.length }
    const r = await place([dItem])
    assert(r.status === 409 && r.code === 'VENDOR_DEMO' && !!r.message?.includes(`${PFX}Demo Grill is a demo booth`) && await orders() === before.orders && piCalls.length === before.pi,
      `${label}: a demo booth → 409 VENDOR_DEMO, no order, no Stripe call (got ${r.status} ${r.code})`)
  }
  setKey(FAKE_LIVE)
  const mixed = await place([rItem, dItem])
  assert(mixed.status === 409 && mixed.code === 'VENDOR_DEMO', `live: a cart with a real AND a demo booth → 409 VENDOR_DEMO (got ${mixed.code})`)
  const realLive = await place([rItem])
  assert(realLive.status === 201, `[0] control: live, a normal booth only → 201 (got ${realLive.status} ${realLive.code ?? ''} ${realLive.message ?? ''})`)
  setKey(FAKE_TEST)
  const piBefore = piCalls.length
  const demoTest = await place([dItem])
  assert(demoTest.status === 201 && piCalls.length === piBefore + 1, `test mode: the demo booth takes a test order → 201 (got ${demoTest.status} ${demoTest.code ?? ''} ${demoTest.message ?? ''})`)

  // ── [6] every customer reader ───────────────────────────────────────────────────────────
  console.log('\n[6] Every customer reader: hidden with live keys, shown in test mode')
  const vendorsRoute = (await import('../app/api/vendors/route')).GET
  const vendorDetail = (await import('../app/api/vendors/[id]/route')).GET
  const vendorMenu = (await import('../app/api/vendors/[id]/menu/route')).GET
  const fairsRoute = (await import('../app/api/fairs/route')).GET
  const eventRoute = (await import('../app/api/events/[slug]/route')).GET
  const fairsLib = await import('../lib/fairs')
  const { getGroupedMenuItemsByEvent } = await import('../lib/menu/getGroupedMenuItems')
  const dId = demoBooth.vendor.id, rId = realBooth.vendor.id, slug = liveFair.urlSlug
  const readers = async () => {
    login(null)
    const list = await call(vendorsRoute(req(`/api/vendors?eventSlug=${slug}&limit=100`)))
    const listIds = ((list.json as unknown as { data?: { id: string }[] }).data ?? []).map(v => v.id)
    const detail = await call(vendorDetail(req(`/api/vendors/${dId}`), { params: Promise.resolve({ id: dId }) }))
    const menu = await call(vendorMenu(req(`/api/vendors/${dId}/menu`), { params: Promise.resolve({ id: dId }) }))
    const grouped = (await getGroupedMenuItemsByEvent(slug)).map(g => g.vendorId)
    const ssrList = (await fairsLib.getVendorsBySlugCached(slug)).map(v => v.id)
    const card = (await fairsLib.getAllFairsCached()).find(f => f.slug === slug)?.vendorCount
    const seo = (await fairsLib.getFairSeoBySlugCached(slug))?.vendorCount
    const site = (await fairsLib.getSitemapFairsCached()).find(f => f.slug === slug)?.vendorIds ?? []
    const fairs = await call(fairsRoute())
    const apiCard = (fairs.data?.fairs ?? (fairs.json.data as unknown as { slug: string; vendorCount: number }[] | undefined) ?? []) as { slug: string; vendorCount: number }[]
    const ev = await call(eventRoute(req(`/api/events/${slug}`), { params: Promise.resolve({ slug }) }))
    return {
      list: listIds.includes(dId), listReal: listIds.includes(rId), detail: detail.status, menu: menu.status,
      grouped: grouped.includes(dId), groupedReal: grouped.includes(rId), ssr: ssrList.includes(dId), card, seo,
      sitemap: site.includes(dId), apiCard: apiCard.find(f => f.slug === slug)?.vendorCount, eventCount: ev.data?._count?.vendors,
    }
  }
  setKey(FAKE_LIVE)
  const L = await readers()
  assert(!L.list && L.listReal, 'GET /api/vendors: demo left out, the real booth listed')
  assert(L.detail === 404 && L.menu === 404, `GET /api/vendors/[id] and /menu: demo → 404 (got ${L.detail}/${L.menu})`)
  assert(!L.grouped && L.groupedReal, 'public menu (getGroupedMenuItems, also GET /api/menu): no demo items')
  assert(!L.ssr && !L.sitemap, 'fair page vendor list and sitemap: no demo booth')
  // Expected counts come from the database: every ACTIVE, online booth on the fair, with and
  // without the demo ones ([2] also left a non-demo booth here). Exactly one booth is demo.
  const onFair = { eventId: liveFair.id, status: VendorStatus.ACTIVE, isOffline: false }
  const allActive = await prisma.vendor.count({ where: onFair })
  const nonDemo = await prisma.vendor.count({ where: { ...onFair, isDemo: false } })
  assert(allActive === nonDemo + 1 && nonDemo >= 1, `[0] setup: exactly one demo booth among the fair's ${allActive} active booths`)
  assert(L.card === nonDemo && L.seo === nonDemo && L.apiCard === nonDemo && L.eventCount === nonDemo,
    `counts (discovery card, SEO, GET /api/fairs, GET /api/events/[slug]) leave the demo booth out: ${nonDemo} (got ${L.card}/${L.seo}/${L.apiCard}/${L.eventCount})`)
  setKey(FAKE_TEST)
  const T = await readers()
  assert(T.list && T.detail === 200 && T.menu === 200 && T.grouped && T.ssr && T.sitemap, `test mode: the demo booth shows everywhere (detail ${T.detail}, menu ${T.menu})`)
  assert(T.card === allActive && T.seo === allActive && T.apiCard === allActive && T.eventCount === allActive,
    `test mode: counts include it: ${allActive} (got ${T.card}/${T.seo}/${T.apiCard}/${T.eventCount})`)
  const detailBody = await call(vendorDetail(req(`/api/vendors/${dId}`), { params: Promise.resolve({ id: dId }) }))
  assert(!detailBody.raw.includes('isDemo'), 'the public vendor detail never sends isDemo (gate-only, stripped)')

  // ── [6b] the last 2 customer reads (review F10) ─────────────────────────────────────────
  // Jordan, Nov 17: GET /api/menu/[id] answers a demo booth's item like a missing one (404);
  // the favorites list leaves it out but keeps the saved favorite; saving one is refused (404).
  // Same shared rule as [6] (lib/demo-vendor.ts). Test mode shows and accepts everything.
  console.log('\n[6b] The last 2 customer reads: one menu item, and a customer\'s favorites (review F10)')
  {
    const menuItemGET = (await import('../app/api/menu/[id]/route')).GET
    const favRoute = await import('../app/api/favorites/route')
    const favUser = await prisma.user.create({ data: { clerkId: `${PFX}fav-${rand()}`, email: `fav-${rand()}${MAIL}`, name: 'Fav Customer' } })
    const freshUser = await prisma.user.create({ data: { clerkId: `${PFX}fav2-${rand()}`, email: `fav2-${rand()}${MAIL}`, name: 'Fresh Customer' } })
    await prisma.favoriteItem.createMany({ data: [{ userId: favUser.id, menuItemId: dItem.id }, { userId: favUser.id, menuItemId: rItem.id }] })

    const itemRead = (id: string) => { login(null); return call(menuItemGET(req(`/api/menu/${id}`), { params: Promise.resolve({ id }) })) }
    const favList = async () => {
      login({ id: favUser.clerkId, roles: [] })
      const r = await call(favRoute.GET())
      return ((r.data as unknown as { favorites?: { menuItemId: string }[] } | undefined)?.favorites ?? []).map(f => f.menuItemId)
    }
    const favSave = (who: { clerkId: string }, menuItemId: string) => {
      login({ id: who.clerkId, roles: [] })
      return call(favRoute.POST(req('/api/favorites', 'POST', { menuItemId })))
    }
    const savedCount = (userId: string, menuItemId: string) => prisma.favoriteItem.count({ where: { userId, menuItemId } })

    setKey(FAKE_LIVE)
    const liveDemo = await itemRead(dItem.id)
    const liveReal = await itemRead(rItem.id)
    assert(liveDemo.status === 404 && liveDemo.code === 'NOT_FOUND' && liveDemo.message === 'Menu item not found' && liveReal.status === 200,
      `live: GET /api/menu/[id] → 404 "Menu item not found" for the demo item, 200 for the real one (got ${liveDemo.status} ${liveDemo.code ?? ''} / ${liveReal.status})`)
    assert(!liveDemo.raw.includes('isDemo') && !liveReal.raw.includes('isDemo'), 'live: neither menu item response contains isDemo')
    const liveList = await favList()
    assert(liveList.includes(rItem.id) && !liveList.includes(dItem.id),
      `live: GET /api/favorites lists the real item only (got ${liveList.length} item(s))`)
    assert(await savedCount(favUser.id, dItem.id) === 1, 'live: the saved favorite for the demo item still exists (hidden, not deleted)')
    const liveSaveDemo = await favSave(freshUser, dItem.id)
    const liveSaveReal = await favSave(freshUser, rItem.id)
    assert(liveSaveDemo.status === 404 && liveSaveDemo.message === 'Menu item not found' && await savedCount(freshUser.id, dItem.id) === 0 && liveSaveReal.status === 201,
      `live: POST /api/favorites → 404 for the demo item and nothing saved; 201 for the real one (got ${liveSaveDemo.status} / ${liveSaveReal.status})`)

    setKey(FAKE_TEST)
    const testDemo = await itemRead(dItem.id)
    assert(testDemo.status === 200, `test mode: GET /api/menu/[id] shows the demo item (got ${testDemo.status})`)
    const testList = await favList()
    assert(testList.includes(rItem.id) && testList.includes(dItem.id), `test mode: the favorites list shows both items (got ${testList.length})`)
    const testSaveDemo = await favSave(freshUser, dItem.id)
    assert(testSaveDemo.status === 201 && await savedCount(freshUser.id, dItem.id) === 1, `test mode: POST /api/favorites saves the demo item (got ${testSaveDemo.status})`)

    const srcOf = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    const menuSrc = srcOf('app/api/menu/[id]/route.ts')
    const getBody = menuSrc.slice(menuSrc.indexOf('export async function GET('), menuSrc.indexOf('export async function PATCH('))
    const gate = getBody.indexOf("if (demoVendorHidden({ isDemo })) return apiError('Menu item not found', 404, 'NOT_FOUND')")
    assert(gate > 0 && gate < getBody.indexOf('return success('), 'GET /api/menu/[id] uses demoVendorHidden() before it builds the response')
    const favSrc = srcOf('app/api/favorites/route.ts')
    assert(favSrc.includes('where: { userId: dbUser.id, menuItem: { vendor: { ...demoHiddenWhere() } } }'),
      'GET /api/favorites filters with demoHiddenWhere() inside the query (saved rows untouched)')
    const postBody = favSrc.slice(favSrc.indexOf('export async function POST('), favSrc.indexOf('export async function DELETE('))
    const refusal = postBody.indexOf("if (!item || demoVendorHidden(item.vendor)) return apiError('Menu item not found', 404, 'NOT_FOUND')")
    assert(refusal > 0 && refusal < postBody.indexOf('favoriteItem.upsert('), 'POST /api/favorites refuses a hidden demo item with demoVendorHidden() before saving')
  }

  // ── [7] badges and source ───────────────────────────────────────────────────────────────
  console.log('\n[7] Badges, and every reader uses the shared demo rule')
  const adminList = (await import('../app/api/admin/events/[id]/vendors/route')).GET
  login(SUPER)
  const al = await call(adminList(req(`/api/admin/events/${slug}/vendors?take=200`), { params: Promise.resolve({ id: slug }) }))
  const alRow = al.data?.vendors?.find(v => v.id === dId)
  assert(al.status === 200 && alRow?.isDemo === true && al.data?.vendors?.find(v => v.id === rId)?.isDemo === false, 'admin fair roster carries isDemo (the DEMO badge)')
  const orgDetail = (await import('../app/api/organizer/vendors/[id]/route')).GET
  const demoOnOrg = await mkVendor({ eventId: orgFair.id, isDemo: true })
  login(ORG)
  const od = await call(orgDetail(req(`/api/organizer/vendors/${demoOnOrg.vendor.id}`), { params: Promise.resolve({ id: demoOnOrg.vendor.id }) }))
  assert(od.status === 200 && od.data?.isDemo === true, 'organizer vendor detail carries isDemo (badge only; they cannot change it)')
  const src = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
  const fairsSrc = src('lib/fairs.ts')
  assert((fairsSrc.match(/\.\.\.demoHiddenWhere\(\)/g) ?? []).length === 4, 'lib/fairs.ts: all 4 readers (list, card count, SEO count, sitemap) use demoHiddenWhere()')
  for (const f of ['lib/menu/getGroupedMenuItems.ts', 'app/api/fairs/route.ts', 'app/api/events/[slug]/route.ts', 'app/api/vendors/route.ts']) {
    assert(/\.\.\.demoHiddenWhere\(\)/.test(src(f)), `${f}: uses demoHiddenWhere()`)
  }
  for (const f of ['app/api/vendors/[id]/route.ts', 'app/api/vendors/[id]/menu/route.ts', 'app/api/orders/route.ts']) {
    assert(/demoVendorHidden\((vendor|\{ isDemo \})\)/.test(src(f)), `${f}: uses demoVendorHidden()`)
  }
  const orderSrc = src('app/api/orders/route.ts')
  assert(orderSrc.indexOf('demoVendorHidden(vendor)') > 0 && orderSrc.indexOf('demoVendorHidden(vendor)') < orderSrc.indexOf("'PRICE_CHANGED'")
    && orderSrc.indexOf('demoVendorHidden(vendor)') < orderSrc.indexOf('stripe.paymentIntents.create('),
  'checkout: the demo refusal sits before the price check and the Stripe call')
  assert(!/isDemo/.test(src('lib/public-vendor-select.ts')) && !/isDemo/.test(src('lib/public-event-select.ts')), 'the public selects never include isDemo')

  setKey(originalKey)
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
