/**
 * ONE PHONE RULE FOR EVERYONE (sign-up-fixes, commit 1b) — checkout, the driver application, driver
 * settings, and the organizer order search. Real routes, test DB, Stripe stubbed in-process.
 *
 *   [1] POST /api/orders refuses a bad phone (400 INVALID_PHONE, the exact message) with no order
 *       written and no PaymentIntent created; the phone check runs before every database read,
 *       Stripe call and order write
 *   [2] A good phone in any format places the order and is stored as +12175550134
 *   [3] The checkout page: the shared check, the exact message under the box, and the typing fix
 *       ("+1 (217) 555-0134" no longer becomes "(121) 755-5013")
 *   [4] POST /api/drivers refuses a bad phone with no application written; a good one is saved
 *       as +12175550134
 *   [5] PATCH /api/runners/me (driver settings): bad → 400, nothing changes; unchanged older-format
 *       number not rewritten and not logged; good → +12175550134 with one profile-change row;
 *       blank clears; an unchanged phone alone still saves
 *   [6] Organizer order search matches phones by digits: "(618) 555", "618555" and "+1618555"
 *       each find an old "(618) 555-0100" order and a new "+16185550100" order
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/phone-everyone-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST
process.env.ENFORCE_VENDOR_READINESS = 'false'
process.env.GOOGLE_MAPS_SERVER_KEY = ''
// The rate limiter goes to the TEST Upstash proxy, never the dev stack's or a real one.
process.env.UPSTASH_REDIS_REST_URL = process.env.TEST_UPSTASH_URL ?? 'http://127.0.0.1:58080'
process.env.UPSTASH_REDIS_REST_TOKEN = 'fairsynq-test-token'
// The route refuses to run without a non-placeholder key; the stub below means it is never used.
process.env.STRIPE_SECRET_KEY = 'sk_test_phone_everyone_stub_never_sent'

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import type { RateLimitState } from '../lib/ratelimit'

type Limiters = Extract<RateLimitState, { type: 'ready' }>['limiters']

const prisma = testPrisma()
const PFX = 'phe-'
const MAIL = '@phe.local'
const GOOD = '+12175550134'
const GOOD_FORMATS = ['+1 (217) 555-0134', '217.555.0134', '2175550134']
const rand = () => Math.random().toString(36).slice(2, 8)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
const login = (clerkId: string | null) => { (globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata: { roles: [] } } : undefined }
const json = (url: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** Replace paymentIntents.create / .update on the real (lazy) client with recorders (as fee-baseline does). */
async function stubStripe() {
  const { stripe } = await import('../lib/stripe')
  const created: any[] = []
  const pis = stripe.paymentIntents as any
  pis.create = async (params: any) => { created.push(params); return { id: `pi_stub_${rand()}`, client_secret: `pi_stub_secret_${rand()}`, amount: params.amount } }
  pis.update = async () => ({})
  return created
}

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    const oids = (await prisma.order.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(o => o.id)
    await prisma.vendorOrderStatus.deleteMany({ where: { orderId: { in: oids } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: oids } } })
    await prisma.order.deleteMany({ where: { id: { in: oids } } })
    await prisma.runner.deleteMany({ where: { eventId: { in: ids } } }) // RunnerProfileChange cascades
    const vids = (await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(v => v.id)
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { id: { in: vids } } })
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.runnerApplication.deleteMany({ where: { email: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  const P = await import('../lib/phone')
  const created = await stubStripe()
  const stubs = await import('./_network-stubs'); stubs.stubClerkUsers()

  // ── [1] + [2] checkout server ──────────────────────────────────────────────────────────
  console.log('\n[1] POST /api/orders: a bad phone')
  const ordersPOST = (await import('../app/api/orders/route')).POST
  const { checkoutTotals, toCents } = await import('../lib/checkout-total')
  const feeTerms = await (await import('../lib/settings')).getMoneySettings()
  const now = Date.now()
  const ev = await prisma.event.create({
    data: {
      name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE',
      startDate: new Date(now - 864e5), endDate: new Date(now + 3 * 864e5),
      fulfillmentConfig: { create: { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: false } },
    },
  })
  const vendor = await prisma.vendor.create({ data: { eventId: ev.id, name: `${PFX}v`, slug: `${PFX}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
  const item = await prisma.menuItem.create({ data: { vendorId: vendor.id, name: 'Item', price: 15.25, category: 'T' } })
  const page = checkoutTotals({ lines: [{ inPersonCents: toCents(15.25), quantity: 1 }], markupBps: 0, feeTerms, deliveryFeeCents: 0, tipCents: 0 })
  const customerClerk = `${PFX}cust-${rand()}`
  const customer = await prisma.user.create({ data: { clerkId: customerClerk, email: `c-${rand()}${MAIL}`, name: 'C' } })
  const placeOrder = async (customerPhone: string) => {
    login(customerClerk)
    const res = await ordersPOST(json('/api/orders', 'POST', {
      eventId: ev.id, fulfillmentType: 'BOOTH_PICKUP', customerName: 'C', customerPhone,
      items: [{ menuItemId: item.id, vendorId: vendor.id, quantity: 1 }], expectedTotalCents: page.totalCents,
    }) as any)
    const body: any = await res.json().catch(() => ({}))
    return { status: res.status, code: body?.error?.code as string | undefined, message: body?.error?.message as string | undefined, orderId: (body?.data?.orderId ?? null) as string | null }
  }
  const countOrders = () => prisma.order.count({ where: { eventId: ev.id } })
  const o0 = await countOrders()
  const pi0 = created.length
  for (const bad of ['217555013', '555-000-0000']) {
    const r = await placeOrder(bad)
    assert(r.status === 400 && r.code === 'INVALID_PHONE' && r.message === P.PHONE_ERROR, `"${bad}" → 400 INVALID_PHONE with the message (got ${r.status} ${r.code})`)
  }
  assert((await countOrders()) === o0, 'no order was written for the refused phones')
  assert(created.length === pi0, 'no PaymentIntent was created for the refused phones')
  const route = readFileSync('app/api/orders/route.ts', 'utf8')
  const at = (s: string) => route.indexOf(s)
  const phoneAt = at('checkPhone(customerPhone')
  assert(phoneAt > 0 && ['ensureDbUser(', 'paymentIntents.create(', 'db.$transaction('].every(s => at(s) > phoneAt),
    'the phone check comes before ensureDbUser, paymentIntents.create and db.$transaction')
  assert(/customerPhone: savedCustomerPhone,/.test(route), 'the order stores the checked phone, not the raw text')

  console.log('\n[2] POST /api/orders: good phones')
  for (const good of GOOD_FORMATS) {
    const r = await placeOrder(good)
    const row = r.orderId ? await prisma.order.findUnique({ where: { id: r.orderId }, select: { customerPhone: true } }) : null
    assert(r.status === 201 || r.status === 200 ? row?.customerPhone === GOOD : false, `"${good}" → order placed, stored as ${GOOD} (got ${r.status} ${r.code ?? ''}, ${row?.customerPhone})`)
  }
  assert(created.length === pi0 + GOOD_FORMATS.length, `one PaymentIntent per good order (the stub saw ${created.length - pi0})`)

  // ── [3] checkout page ──────────────────────────────────────────────────────────────────
  console.log('\n[3] The checkout page')
  const checkout = readFileSync('app/fair/[fairSlug]/checkout/page.tsx', 'utf8').replace(/\r\n/g, '\n')
  assert(/import \{ checkPhone, PHONE_ERROR, INVALID_PHONE \} from '@\/lib\/phone'/.test(checkout) && !/const validatePhone =/.test(checkout),
    'the page uses lib/phone (its own phone check is gone)')
  assert((checkout.match(/phone: PHONE_ERROR/g) ?? []).length === 3 && !/Enter a valid 10-digit US phone number/.test(checkout),
    'the box shows exactly PHONE_ERROR: on submit, on leaving the box, and when the server refuses')
  assert(/if \(json\.error\?\.code === INVALID_PHONE\) \{\s*\/\/[^\n]*\n\s*setFieldErrors\(prev => \(\{ \.\.\.prev, phone: PHONE_ERROR \}\)\)\s*toast\.error\(PHONE_ERROR\)/.test(checkout),
    'a server INVALID_PHONE puts the page\'s own sentence under the box (never the server text)')
  const fmtSrc = checkout.match(/const formatPhone = \(raw: string\): string => \{[\s\S]*?\n\}/)?.[0] ?? ''
  const formatPhone = fmtSrc
    ? (new Function(fmtSrc.replace('const formatPhone = (raw: string): string =>', 'return (raw) =>'))() as (s: string) => string)
    : (() => '')
  const oldFormat = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 11)
    if (digits.length <= 3) return digits
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`
  }
  assert(oldFormat('+1 (217) 555-0134') === '(121) 755-5013', '[0] positive control: the old formatter turned "+1 (217) 555-0134" into "(121) 755-5013"')
  for (const typed of ['+1 (217) 555-0134', '12175550134', '217.555.0134', '2175550134']) {
    assert(formatPhone(typed) === '(217) 555-0134', `the box shows "(217) 555-0134" for "${typed}" (got "${formatPhone(typed)}")`)
  }
  assert(formatPhone('217') === '217' && formatPhone('21755') === '(217) 55', '[0] control: partial typing still formats as before')

  // ── [4] driver application ─────────────────────────────────────────────────────────────
  console.log('\n[4] POST /api/drivers')
  login(null)
  // /api/drivers is rate-limited per connection since sign-up-fixes commit 4; these signed-out
  // calls run with the always-allow test limiter (the limit itself: organizer-apply-test).
  const rl = await import('../lib/ratelimit')
  const allowAll = { limit: async () => ({ success: true, limit: 5, remaining: 5, reset: Date.now() + 3600e3 }) }
  rl.__setStateForTest({ type: 'ready', limiters: new Proxy({}, { get: () => allowAll }) as unknown as Limiters })
  const driversPOST = (await import('../app/api/drivers/route')).POST
  const apply = async (phone: string) => {
    const email = `d-${rand()}${MAIL}`
    const r = await driversPOST(json('/api/drivers', 'POST', {
      personal: { firstName: 'Dee', lastName: 'Driver', email, phone, dob: '1990-01-01', city: 'Alton' },
      agreed: true, bgConsent: true, termsVersion: 'test',
    }))
    return { status: r.status, body: (await r.json()) as any, email }
  }
  for (const bad of ['217555013', '555-000-0000', '+44 20 7946 0958']) {
    const r = await apply(bad)
    const rows = await prisma.runnerApplication.count({ where: { email: r.email } })
    assert(r.status === 400 && r.body?.error?.details?.fieldErrors?.phone === P.PHONE_ERROR && rows === 0, `"${bad}" → 400 with the phone error, no application written (got ${r.status})`)
  }
  const goodApp = await apply('(217) 555-0134')
  const appRow = await prisma.runnerApplication.findFirst({ where: { email: goodApp.email }, select: { phone: true } })
  assert(goodApp.status < 300 && appRow?.phone === GOOD, `a good phone → accepted, saved as ${GOOD} (got ${goodApp.status}, ${appRow?.phone})`)
  rl.__resetForTest()

  // ── [5] driver settings ────────────────────────────────────────────────────────────────
  console.log('\n[5] PATCH /api/runners/me')
  const me = await import('../app/api/runners/me/route')
  const ru = await prisma.user.create({ data: { clerkId: `${PFX}ru-${rand()}`, email: `ru-${rand()}${MAIL}`, name: 'R' } })
  const runner = await prisma.runner.create({ data: { userId: ru.id, eventId: ev.id, phone: '+1 312-555-0199', vehicleColor: 'Blue' } })
  login(ru.clerkId)
  const patch = async (body: unknown) => {
    const r = await me.PATCH(json('/api/runners/me', 'PATCH', body) as any)
    const j: any = await r.json()
    return { status: r.status, code: j?.error?.code as string | undefined, message: j?.error?.message as string | undefined }
  }
  const runnerRow = () => prisma.runner.findUnique({ where: { id: runner.id }, select: { phone: true, vehicleColor: true } })
  const phoneLogs = () => prisma.runnerProfileChange.count({ where: { runnerId: runner.id, field: 'phone' } })
  const bad = await patch({ phone: '555-000-0000', vehicleColor: 'Red' })
  const afterBad = await runnerRow()
  assert(bad.status === 400 && bad.code === 'INVALID_PHONE' && bad.message === P.PHONE_ERROR && afterBad?.phone === '+1 312-555-0199' && afterBad?.vehicleColor === 'Blue',
    `a bad phone → 400 INVALID_PHONE with the message, nothing changed (got ${bad.status} ${bad.code})`)
  const same = await patch({ phone: '+1 312-555-0199', vehicleColor: 'Green' })
  const afterSame = await runnerRow()
  assert(same.status === 200 && afterSame?.phone === '+1 312-555-0199' && afterSame?.vehicleColor === 'Green' && (await phoneLogs()) === 0,
    'the older-format number sent back unchanged is not rewritten or logged; the rest of the save goes through')
  const onlySame = await patch({ phone: '+1 312-555-0199' })
  assert(onlySame.status === 200, `an unchanged phone sent alone still saves (got ${onlySame.status} ${onlySame.code ?? ''})`)
  const good = await patch({ phone: '217.555.0134' })
  assert(good.status === 200 && (await runnerRow())?.phone === GOOD && (await phoneLogs()) === 1, `a good phone → saved as ${GOOD}, one phone change logged`)
  const cleared = await patch({ phone: '' })
  assert(cleared.status === 200 && (await runnerRow())?.phone === null, 'a blank phone clears it (the phone is optional here)')
  const settingsPage = readFileSync('app/runner/[fairSlug]/settings/page.tsx', 'utf8')
  assert(/if \(!checkPhone\(form\.phone, \{ required: false, previous: savedPhone \}\)\.ok\) \{\s*toast\.error\(PHONE_ERROR\)\s*return/.test(settingsPage),
    'driver settings checks the phone before saving and shows the exact message')

  // ── [6] organizer order search ─────────────────────────────────────────────────────────
  console.log('\n[6] Order search matches phones by digits')
  const { getFairOrders, phoneSearchDigits } = await import('../lib/fair-orders')
  const base = { eventId: ev.id, customerId: customer.id, vendorId: vendor.id, status: 'PLACED' as const, fulfillmentType: 'BOOTH_PICKUP' as const, subtotal: 10, total: 11, fairSynqFee: 1, vendorPayout: 0 }
  const oldOrder = await prisma.order.create({ data: { ...base, customerName: `${PFX}Old Shape`, customerPhone: '(618) 555-0100' } })
  const newOrder = await prisma.order.create({ data: { ...base, customerName: `${PFX}New Shape`, customerPhone: '+16185550100' } })
  const found = async (search: string) => new Set(((await getFairOrders(ev.id, { search, take: 100 })) as any).orders.map((o: any) => o.id))
  for (const q of ['(618) 555', '618555', '+1618555']) {
    const ids = await found(q)
    assert(ids.has(oldOrder.id) && ids.has(newOrder.id), `"${q}" finds both the old "(618) 555-0100" and the new "+16185550100" order`)
  }
  const none = await found('999')
  assert(!none.has(oldOrder.id) && !none.has(newOrder.id), '[0] control: "999" finds neither')
  const byName = await found(`${PFX}Old`)
  assert(byName.has(oldOrder.id) && !byName.has(newOrder.id), '[0] control: a name search still works')
  assert(phoneSearchDigits('12').length === 0 && JSON.stringify(phoneSearchDigits('+1618555')) === JSON.stringify(['1618555', '618555']),
    'under 3 digits is not a phone search; a +1 query is also tried without the 1')

  assert(stubs.stubCalls.clerkUpdate === 0, '[stub] nothing reached the Clerk network')
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
