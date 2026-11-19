/**
 * ITEM 10 / B1.13 STAGE 3 — PRICE WIRING (BATCH-1 §19, plan approved 2026-11-18). Test DB, Stripe stubbed.
 *
 *   [1] checkoutTotals() (lib/checkout-total.ts, the one calculator since 2026-11-23): cents,
 *       round-half-up once per order, platform curbside fee, no event charge, fee on the booth price
 *   [2] end to end on 4.35 / 15.25 / 50 / two vendors / curbside: estimate = summary total =
 *       PaymentIntent amount = itemizeOrder total = stored total; snapshot; metadata keeps every old key.
 *       0.29: refused by the checkout floor, nothing charged
 *   [3] a money setting changed between the estimate and the order: 409 PRICE_CHANGED with the
 *       server's total; confirming it charges that (and the 15% row is restored)
 *   [4] paused: each missing / invalid money row → 503 ORDERING_PAUSED with only the plain message,
 *       no PaymentIntent, no order; the Slack alert is once per 10 minutes via a Redis key, and is
 *       sent anyway when Redis is unreachable
 *   [5] admin / organizer controls: no curbside fee field, no Service Charge card; the APIs ignore
 *       both; an event with the old charge switched on still charges nothing for it
 *   [6] legacy orders: itemizeOrder output identical to the golden recorded before stage 3; the
 *       payout's customer-side identity holds for new and legacy stored orders
 *   [7] copy: the seven approved strings; no "10%" left in them; no page promises a service-fee refund
 *   [8] settings cards: no amber notes on the money cards (card fees' went in stage 4); the Vendor Agreement line on the three cards
 *   END the four money rows are back at 1500 / 0 / 399 / VENDOR
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/fees-stage3-test.ts
 */
// fee-baseline sets the test environment (test Upstash proxy, stubbed Stripe key) and registers the
// route loader on import, before anything below loads a route.
import './fee-baseline'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createServer } from 'node:http'
import { NextRequest } from 'next/server'
import { testPrisma } from '../lib/test-db'

const prisma = testPrisma()
const PFX = 'fs3-'
const MAIL = '@fs3.local'
const rand = () => Math.random().toString(36).slice(2, 8)
let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const SEED_SQL = readFileSync('prisma/migrations/20261118120000_add_money_settings/migration.sql', 'utf8')
const MONEY = ['fees.serviceFee.percentBps', 'fees.serviceFee.flatCents', 'fees.curbsideRunnerFeeCents', 'fees.cardFeesPaidBy']
async function resetToSeed() {
  await prisma.platformSettingChange.deleteMany({ where: { key: { in: MONEY } } })
  await prisma.platformSetting.deleteMany({ where: { key: { in: MONEY } } })
  await prisma.$executeRawUnsafe(SEED_SQL)
}
const login = (clerkId: string, roles: string[] = []) => { (globalThis as any).__MOCK_CLERK = { userId: clerkId, publicMetadata: { roles } } }
const jsonReq = (url: string, method: string, body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})
const read = (f: string) => readFileSync(f, 'utf8')
const noComments = (s: string) => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join('\n')

// Stripe stub: every PaymentIntent the route creates is recorded here; nothing leaves the process.
const created: any[] = []
async function stubStripe() {
  const { stripe } = await import('../lib/stripe')
  const pis = stripe.paymentIntents as any
  pis.create = async (params: any) => { created.push(params); return { id: `pi_fs3_${rand()}`, client_secret: `sec_${rand()}`, amount: params.amount } }
  pis.update = async () => ({})
}
// The route schedules the paused alert through runAfterResponse; collect those tasks here.
const afterTasks: Array<() => Promise<void>> = []

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    const oids = (await prisma.order.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(o => o.id)
    await prisma.vendorOrderStatus.deleteMany({ where: { orderId: { in: oids } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: oids } } })
    await prisma.order.deleteMany({ where: { id: { in: oids } } })
    const vids = (await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(v => v.id)
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { id: { in: vids } } })
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  const orgs = await prisma.fairOrganizer.findMany({ where: { name: { startsWith: PFX } }, select: { id: true } })
  await prisma.orgMember.deleteMany({ where: { organizerId: { in: orgs.map(o => o.id) } } })
  await prisma.fairOrganizer.deleteMany({ where: { id: { in: orgs.map(o => o.id) } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

interface Fx { eventId: string; items: { menuItemId: string; vendorId: string; quantity: number }[]; prices: number[] }
async function mkFair(prices: number[], opts: { curbside?: boolean; eventCurbsideFee?: number; serviceCharge?: number; organizerId?: string } = {}): Promise<Fx> {
  const now = Date.now()
  const ev = await prisma.event.create({
    data: {
      name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', startDate: new Date(now - 864e5), endDate: new Date(now + 3 * 864e5),
      ...(opts.organizerId ? { organizerId: opts.organizerId } : {}),
      ...(opts.serviceCharge ? { serviceChargeEnabled: true, serviceChargeAmount: opts.serviceCharge } : {}),
      fulfillmentConfig: { create: {
        boothPickupEnabled: true, curbsideEnabled: !!opts.curbside, homeDeliveryEnabled: false, curbsideFee: opts.eventCurbsideFee ?? 0,
        curbsideZoneLat: 39.8, curbsideZoneLng: -89.6, curbsideZoneDescription: 'Lot B', runnerFeePercent: 50,
      } },
    },
  })
  const items = []
  for (const price of prices) {
    const v = await prisma.vendor.create({ data: { eventId: ev.id, name: `${PFX}v`, slug: `${PFX}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
    const mi = await prisma.menuItem.create({ data: { vendorId: v.id, name: 'Item', price, category: 'T' } })
    items.push({ menuItemId: mi.id, vendorId: v.id, quantity: 1 })
  }
  return { eventId: ev.id, items, prices }
}
async function placeOrder(fx: Fx, fulfillment: 'BOOTH_PICKUP' | 'CURBSIDE', tip?: number, expectedTotalCents?: number) {
  const ordersPOST = (await import('../app/api/orders/route')).POST
  const clerkId = `${PFX}c-${rand()}`
  await prisma.user.create({ data: { clerkId, email: `c-${rand()}${MAIL}`, name: 'C' } })
  login(clerkId)
  const before = created.length
  const res = await ordersPOST(jsonReq('/api/orders', 'POST', {
    eventId: fx.eventId, fulfillmentType: fulfillment, customerName: 'C', customerPhone: '6185550100', vehicleMake: 'Honda', vehicleColor: 'Blue', items: fx.items, ...(tip ? { tip } : {}),
    ...(expectedTotalCents !== undefined ? { expectedTotalCents } : {}),
  }) as any)
  const body: any = await res.json().catch(() => ({}))
  const pi = created.length > before ? created[created.length - 1] : null
  const orderId = body?.data?.orderId ?? null
  const row = orderId ? await prisma.order.findUnique({ where: { id: orderId }, include: { orderItems: { include: { vendor: true } } } }) : null
  return { status: res.status, body, pi, row, piCalls: created.length - before, clerkId }
}

async function main() {
  await cleanup()
  await resetToSeed()
  await stubStripe()
  ;(globalThis as any).__AFTER_RESPONSE_FOR_TEST = (t: () => Promise<void>) => { afterTasks.push(t) }
  // Ported 2026-11-23: lib/fees/price.ts is gone; the ONE calculator is lib/checkout-total.ts's
  // checkoutTotals (the client's, now fed the money settings' terms). Checkout also needs the page's
  // expectedTotalCents (409 PRICE_CHANGED otherwise) and keeps the checkout floor, so the 0.29 order
  // is now refused by the floor before any payment.
  const { checkoutTotals, toCents, fromCents } = await import('../lib/checkout-total')
  const { getCustomerFeeTerms } = await import('../lib/fees/fee-terms')
  const { itemizeOrder } = await import('../lib/order-itemization')
  const settings = await import('../lib/settings')
  const paused = await import('../lib/ordering-paused')
  type Terms = { serviceFeeBps: number; serviceFeeFlatCents: number; curbsideRunnerFeeCents: number }
  const T: Terms = { serviceFeeBps: 1500, serviceFeeFlatCents: 0, curbsideRunnerFeeCents: 399 }
  /** What the checkout page computes: the same calculator, the platform curbside fee, tip only when runner-fulfilled. */
  const calc = (prices: number[], f: 'BOOTH_PICKUP' | 'CURBSIDE' = 'BOOTH_PICKUP', tip = 0, terms: Terms = T, qty = 1) => checkoutTotals({
    lines: prices.map(p => ({ inPersonCents: toCents(p), quantity: qty })), markupBps: 0, feeTerms: terms,
    deliveryFeeCents: f === 'CURBSIDE' ? terms.curbsideRunnerFeeCents : 0, tipCents: f === 'CURBSIDE' ? toCents(tip) : 0,
  })

  // ── [1] ───────────────────────────────────────────────────────────────────────────────────
  console.log('[1] checkoutTotals() with the money settings')
  const cases: Array<[number[], number, number]> = [[[0.29], 4, 33], [[4.35], 65, 500], [[15.25], 229, 1754], [[50], 750, 5750], [[30, 20], 750, 5750]]
  for (const [p, fee, total] of cases) {
    const r = calc(p)
    assert(r.serviceFeeCents === fee && r.totalCents === total, `booth ${p.join(' + ')} → fee ${fee}¢, total ${total}¢ (got ${r.serviceFeeCents} / ${r.totalCents})`)
  }
  const cs = calc([10], 'CURBSIDE', 2)
  assert(cs.serviceFeeCents === 150 && cs.deliveryFeeCents === 399 && cs.tipCents === 200 && cs.totalCents === 1749, 'curbside $10 + tip $2 → 150 + 399 + 200 = 1749¢ (the platform curbside fee)')
  const flat = calc([30, 20], 'BOOTH_PICKUP', 0, { ...T, serviceFeeFlatCents: 50 })
  assert(flat.serviceFeeCents === 800, 'a flat amount is added once per order, not per vendor (750 + 50, two vendors)')
  assert(calc([2.5, 2.5]).onlineSubtotalCents === 500 && calc([4.35], 'BOOTH_PICKUP', 0, T, 3).onlineSubtotalCents === 1305,
    'subtotal in whole cents per line × quantity (4.35 × 3 = 1305)')
  assert(calc([]).serviceFeeCents === 0 && calc([], 'BOOTH_PICKUP', 0, { ...T, serviceFeeFlatCents: 50 }).serviceFeeCents === 0, 'no food → no fee, not even the flat amount')
  const mk = checkoutTotals({ lines: [{ inPersonCents: 1000, quantity: 1 }], markupBps: 1000, feeTerms: T, deliveryFeeCents: 0, tipCents: 0 })
  assert(mk.onlineSubtotalCents === 1100 && mk.feeBaseCents === 1000 && mk.serviceFeeCents === 150 && mk.totalCents === 1250,
    'under a 10% markup the fee is on the booth price: $10 → online $11, fee 15% of $10 = 150¢, total 1250¢')
  assert(toCents(4.35) === 435 && fromCents(1754) === 17.54, 'dollars → cents and cents → dollars once')

  // ── [2] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[2] end to end: estimate = summary = PaymentIntent = itemizeOrder = stored')
  const terms = await getCustomerFeeTerms()
  assert(JSON.stringify(terms) === JSON.stringify(T), '[0] control: the fair payload terms come from the seed (1500 / 0 / 399)')
  {
    const fx0 = await mkFair([0.29])
    const est0 = calc([0.29], 'BOOTH_PICKUP', 0, terms!)
    const o0 = await placeOrder(fx0, 'BOOTH_PICKUP', undefined, est0.totalCents)
    assert(est0.totalCents === 33 && o0.status === 400 && o0.body?.error?.code === 'ORDER_BELOW_PROCESSING_FEE' && o0.piCalls === 0 && o0.row === null,
      `0.29: the calculator says 33¢; the checkout floor refuses it (400 ORDER_BELOW_PROCESSING_FEE), no PaymentIntent, no order (got ${o0.status} ${o0.body?.error?.code})`)
  }
  const scenarios: Array<{ name: string; prices: number[]; f: 'BOOTH_PICKUP' | 'CURBSIDE'; tip?: number; opts?: any }> = [
    { name: '4.35', prices: [4.35], f: 'BOOTH_PICKUP' }, { name: '15.25', prices: [15.25], f: 'BOOTH_PICKUP' },
    { name: '50.00', prices: [50], f: 'BOOTH_PICKUP' }, { name: 'two vendors 30 + 20', prices: [30, 20], f: 'BOOTH_PICKUP' },
    { name: 'booth with a tip sent (ignored)', prices: [10], f: 'BOOTH_PICKUP', tip: 5 },
    { name: 'curbside 10, tip 2, event fee 3.00 + charge 5.00 switched on', prices: [10], f: 'CURBSIDE', tip: 2, opts: { curbside: true, eventCurbsideFee: 3, serviceCharge: 5 } },
  ]
  const OLD_META = ['primaryVendorId', 'eventId', 'customerId', 'fulfillmentType', 'fairSynqFee', 'serviceFee', 'deliveryFee', 'serviceCharge', 'tip', 'vendorIds', 'vendorSubtotalCents']
  const newRows: any[] = []
  for (const s of scenarios) {
    const fx = await mkFair(s.prices, s.opts)
    const est = calc(s.prices, s.f, s.tip ?? 0, terms!)
    const o = await placeOrder(fx, s.f, s.tip, est.totalCents)
    const sum = o.body?.data?.summary
    const it = o.row ? itemizeOrder({ ...o.row, refunds: [] } as any) : null
    const storedCents = o.row ? Math.round(o.row.total * 100) : -1
    assert(o.status === 201 && o.piCalls === 1 && Math.round(sum.total * 100) === est.totalCents && o.pi.amount === est.totalCents
      && it!.totalCents === est.totalCents && it!.reconciles && storedCents === est.totalCents,
      `${s.name}: ${est.totalCents}¢ everywhere (estimate, summary, PaymentIntent, itemizeOrder, stored) (got ${o.status} ${o.body?.error?.code ?? ''})`)
    if (!o.row) continue
    assert(Math.round(o.row.subtotal * 100) === est.onlineSubtotalCents && Math.round(o.row.fairSynqFee * 100) === est.serviceFeeCents
      && Math.round((o.row.deliveryFee ?? 0) * 100) === est.deliveryFeeCents && Math.round((o.row.tip ?? 0) * 100) === est.tipCents && o.row.serviceCharge === null,
      `${s.name}: stored subtotal, fee, curbside fee and tip match to the cent; no event service charge`)
    assert(o.row.feeModel === 2 && o.row.serviceFeeBps === 1500 && o.row.serviceFeeFlatCents === 0 && o.row.cardFeesPaidBy === 'VENDOR',
      `${s.name}: snapshot feeModel 2, 1500 / 0 / VENDOR`)
    assert(OLD_META.every(k => typeof o.pi.metadata[k] === 'string') && o.pi.metadata.fairSynqFee === o.row.fairSynqFee.toFixed(2)
      && o.pi.metadata.serviceFee === o.row.fairSynqFee.toFixed(2) && o.pi.metadata.deliveryFee === (o.row.deliveryFee ?? 0).toFixed(2)
      && o.pi.metadata.serviceCharge === '0.00' && o.pi.metadata.tip === (o.row.tip ?? 0).toFixed(2)
      && o.pi.metadata.feeModel === '2' && o.pi.metadata.serviceFeeBps === '1500' && o.pi.metadata.serviceFeeFlatCents === '0' && o.pi.metadata.cardFeesPaidBy === 'VENDOR',
      `${s.name}: PaymentIntent metadata keeps every old key (same meaning) and adds the four new ones`)
    newRows.push(o.row)
  }

  // ── [3] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[3] a setting changes between the estimate and the order')
  const fx3 = await mkFair([20])
  const est15 = calc([20], 'BOOTH_PICKUP', 0, (await getCustomerFeeTerms())!)
  await prisma.platformSetting.update({ where: { key: 'fees.serviceFee.percentBps' }, data: { value: 1200 } })
  const o3a = await placeOrder(fx3, 'BOOTH_PICKUP', undefined, est15.totalCents)
  assert(est15.totalCents === 2300 && o3a.status === 409 && o3a.body?.error?.code === 'PRICE_CHANGED' && o3a.body?.error?.details?.newTotalCents === 2240 && o3a.piCalls === 0 && o3a.row === null,
    `the page showed 15% (2300¢), the server now reads 12%: 409 PRICE_CHANGED with the server's 2240¢, nothing charged (got ${o3a.status} ${o3a.body?.error?.details?.newTotalCents})`)
  const o3 = await placeOrder(fx3, 'BOOTH_PICKUP', undefined, o3a.body?.error?.details?.newTotalCents)
  assert(o3.status === 201 && Math.round(o3.body.data.summary.total * 100) === 2240 && o3.pi.amount === 2240 && o3.row!.serviceFeeBps === 1200,
    'confirming the server total: the summary and PaymentIntent are 2240¢; snapshot 1200')
  await resetToSeed()
  assert(JSON.stringify(await settings.getMoneySettings()) === JSON.stringify({ serviceFeeBps: 1500, serviceFeeFlatCents: 0, curbsideRunnerFeeCents: 399, cardFeesPaidBy: 'VENDOR' }), '15% restored')

  // ── [4] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[4] ordering paused')
  const slack: string[] = []
  const hook = createServer((rq, rs) => { let b = ''; rq.on('data', d => b += d); rq.on('end', () => { slack.push(b); rs.end('ok') }) })
  await new Promise<void>(r => hook.listen(0, '127.0.0.1', r))
  process.env.SLACK_WEBHOOK_URL = `http://127.0.0.1:${(hook.address() as any).port}/hook`
  const { Redis } = await import('@upstash/redis')
  const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! })
  await redis.del(paused.ORDERING_PAUSED_ALERT_KEY)
  const fx4 = await mkFair([10])
  const ok4 = await placeOrder(fx4, 'BOOTH_PICKUP', undefined, calc([10]).totalCents)
  assert(ok4.status === 201, '[0] control: with the seed in place the same order is accepted (201)')
  const runAfter = async () => { const t = afterTasks.splice(0); for (const f of t) await f() }
  await runAfter()
  for (const k of MONEY) {
    await prisma.platformSetting.delete({ where: { key: k } })
    const before = await prisma.order.count({ where: { eventId: fx4.eventId } })
    const o = await placeOrder(fx4, 'BOOTH_PICKUP')
    const txt = JSON.stringify(o.body)
    assert(o.status === 503 && o.body?.error?.code === 'ORDERING_PAUSED' && o.body?.error?.message === 'Ordering is paused, please try again shortly'
      && !/fees\.|percentBps|flatCents|curbsideRunner|cardFees/.test(txt) && o.piCalls === 0 && (await prisma.order.count({ where: { eventId: fx4.eventId } })) === before,
      `${k} missing → 503 ORDERING_PAUSED, plain message only, no PaymentIntent, no order`)
    await resetToSeed()
  }
  await prisma.$executeRawUnsafe(`UPDATE "PlatformSetting" SET "value" = '"BOTH"'::jsonb WHERE "key" = 'fees.cardFeesPaidBy'`)
  const inv = await placeOrder(fx4, 'BOOTH_PICKUP')
  assert(inv.status === 503 && inv.body?.error?.code === 'ORDERING_PAUSED' && inv.piCalls === 0, 'an invalid stored value → 503 too')
  assert((await getCustomerFeeTerms()) === null, 'and the fair payload carries feeTerms: null (the checkout shows the paused message)')
  await resetToSeed()
  // Alerts: 5 paused orders above each scheduled one alert task; run them in order.
  await redis.del(paused.ORDERING_PAUSED_ALERT_KEY)
  const n0 = slack.length
  const tasks = afterTasks.splice(0)
  assert(tasks.length === 5, `each paused order scheduled its alert after the response (${tasks.length} of 5)`)
  for (const t of tasks) await t()
  assert(slack.length - n0 === 1 && /Ordering is paused/.test(slack[slack.length - 1]) && /fees\.cardFeesPaidBy|fees\.serviceFee/.test(slack.join('')),
    `five pauses within 10 minutes → exactly one Slack alert (got ${slack.length - n0}), naming the keys`)
  const ttl = await redis.ttl(paused.ORDERING_PAUSED_ALERT_KEY)
  assert(ttl > 590 && ttl <= 600, `the limit is a Redis key with a 10-minute expiry (ttl ${ttl}s)`)
  let notified = 0
  const out1 = await paused.alertOrderingPaused({ missing: ['x'], invalid: [] }, { setNx: async () => { throw new Error('redis down') }, notify: async () => { notified++ } })
  const savedUrl = process.env.UPSTASH_REDIS_REST_URL
  process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:1'
  const n1 = slack.length
  const out2 = await paused.alertOrderingPaused({ missing: ['x'], invalid: [] })
  process.env.UPSTASH_REDIS_REST_URL = savedUrl
  assert(out1 === 'sent-redis-unavailable' && notified === 1 && out2 === 'sent-redis-unavailable' && slack.length === n1 + 1,
    'Redis down (throwing, or unreachable) → the alert is sent anyway')
  const out3 = await paused.alertOrderingPaused({ missing: ['x'], invalid: [] }, { setNx: async () => false, notify: async () => { notified++ } })
  assert(out3 === 'suppressed' && notified === 1, '[0] control: when the key already exists the alert is suppressed')
  process.env.SLACK_WEBHOOK_URL = ''
  hook.close()
  await redis.del(paused.ORDERING_PAUSED_ALERT_KEY)

  // ── [5] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[5] admin and organizer controls')
  const fulfillPage = read('app/admin/[eventSlug]/fulfillment/page.tsx'), settingsPage = read('app/admin/[eventSlug]/settings/page.tsx')
  assert(!/curbsideFee/.test(fulfillPage) && /curbsideEnabled/.test(fulfillPage), 'the admin fulfillment page has no curbside fee field (the curbside on/off stays)')
  assert(!/serviceCharge|Service Charge/.test(noComments(settingsPage)), 'the admin event settings page has no Service Charge card')
  const fxA = await mkFair([10], { curbside: true, eventCurbsideFee: 3, serviceCharge: 5 })
  login(`${PFX}admin`, ['admin'])
  const fulPATCH = (await import('../app/api/admin/events/[id]/fulfillment/route')).PATCH
  const r1 = await fulPATCH(jsonReq(`/api/admin/events/${fxA.eventId}/fulfillment`, 'PATCH', { curbsideEnabled: false, curbsideFee: 9.99 }) as any, { params: Promise.resolve({ id: fxA.eventId }) })
  const fc1 = await prisma.fulfillmentConfig.findUnique({ where: { eventId: fxA.eventId } })
  assert(r1.status === 200 && fc1?.curbsideEnabled === false && fc1?.curbsideFee === 3, 'fulfillment API: curbside on/off saves, a sent curbsideFee (9.99) is ignored (stays 3.00)')
  const setPATCH = (await import('../app/api/admin/events/[id]/settings/route')).PATCH
  const r2 = await setPATCH(jsonReq(`/api/admin/events/${fxA.eventId}/settings`, 'PATCH', { name: `${PFX}renamed`, serviceChargeEnabled: false, serviceChargeAmount: 9 }) as any, { params: Promise.resolve({ id: fxA.eventId }) })
  const ev2 = await prisma.event.findUnique({ where: { id: fxA.eventId } })
  assert(r2.status === 200 && ev2?.name === `${PFX}renamed` && ev2?.serviceChargeEnabled === true && ev2?.serviceChargeAmount === 5,
    'admin settings API: the name saves, the service charge fields are ignored (stay on, $5)')
  const orgUser = await prisma.user.create({ data: { clerkId: `${PFX}org-${rand()}`, email: `org-${rand()}${MAIL}`, name: 'O' } })
  const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}org`, contactEmail: orgUser.email, approvalStatus: 'APPROVED' } })
  await prisma.orgMember.create({ data: { organizerId: org.id, userId: orgUser.id, role: 'owner' } })
  const fxO = await mkFair([10], { organizerId: org.id, serviceCharge: 5 })
  const slug = (await prisma.event.findUnique({ where: { id: fxO.eventId } }))!.urlSlug
  login(orgUser.clerkId)
  const orgPATCH = (await import('../app/api/organizer/fairs/[fairSlug]/settings/route')).PATCH
  const r3 = await orgPATCH(jsonReq(`/api/organizer/fairs/${slug}/settings`, 'PATCH', { showVendorWaitTimes: false, serviceChargeEnabled: false, serviceChargeAmount: 9 }) as any, { params: Promise.resolve({ fairSlug: slug }) })
  const ev3 = await prisma.event.findUnique({ where: { id: fxO.eventId } })
  assert(r3.status === 200 && ev3?.showVendorWaitTimes === false && ev3?.serviceChargeEnabled === true && ev3?.serviceChargeAmount === 5,
    'organizer settings API: an allowed field saves, the service charge fields are ignored')
  const curbRow = newRows[newRows.length - 1]
  assert(curbRow.serviceCharge === null && Math.round(curbRow.deliveryFee * 100) === 399,
    'the event with the old charge ON ($5) and its own curbside fee ($3) charged neither: no service charge, the platform $3.99')

  // ── [6] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[6] legacy orders')
  const golden = JSON.parse(read('scripts/fixtures/itemize-legacy-10pct.json')).results as Record<string, { input: any; itemization: any }>
  const diffs = Object.entries(golden).filter(([, g]) => JSON.stringify(itemizeOrder(g.input)) !== JSON.stringify(g.itemization)).map(([n]) => n)
  assert(Object.keys(golden).length === 6 && diffs.length === 0, `itemizeOrder output for the six 10% orders is identical to the golden recorded before stage 3 (${diffs.join(', ') || 'no differences'})`)
  const identity = (o: any) => Math.round(o.subtotal * 100) + Math.round(o.fairSynqFee * 100) + Math.round((o.deliveryFee ?? 0) * 100) + Math.round((o.serviceCharge ?? 0) * 100) + Math.round((o.tip ?? 0) * 100) === Math.round(o.total * 100)
  const legacy = Object.values(golden).map(g => g.input)
  assert(newRows.every(identity) && legacy.every(identity), 'the payout\'s customer-side identity (subtotal + fee + curbside + charge + tip = total) holds for every new and legacy order')
  assert(!identity({ subtotal: 10, fairSynqFee: 1.5, deliveryFee: 0, serviceCharge: 0, tip: 0, total: 11 }), '[0] control: the identity check catches a mismatched total')

  // ── [7] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[7] copy')
  const faq = read('app/_components/faq-content.ts')
  // The client's wording (2026-11-24, 84b108b), also pinned word for word by scripts/faq-fees-copy-test.ts.
  assert(faq.includes("a: 'A service fee, shown at checkout before you pay, plus a curbside fee if you choose curbside.'"), 'FAQ "What fees will I pay?" approved text')
  assert(faq.includes("we'll refund your food — the service fee isn't refunded. Once a vendor has accepted"), 'FAQ "Can I cancel an order?" approved text')
  assert(faq.includes("No commission. Our only revenue is the customer's service fee. You do cover your share of Stripe's processing fee, the same as any card payment."), 'FAQ "What does FairSynq take?" approved text')
  assert(read('app/admin/[eventSlug]/reports/page.tsx').includes('sub="FairSynq revenue (service fees)"'), 'admin reports: "FairSynq revenue (service fees)"')
  assert((read('app/organizer/fairs/[fairSlug]/orders/page.tsx').match(/`The service fee is NOT refunded\.`/g) ?? []).length === 2, 'organizer refund prompt (×2): "The service fee is NOT refunded."')
  assert(/refunded for the food automatically\. The service\s+fee isn&apos;t refunded\./.test(read('app/vendor/[fairSlug]/dashboard/page.tsx')), 'vendor decline message approved text')
  assert(read('lib/process-refund.ts').includes("'kept (service fee not refunded)'"), 'internal refund-log note approved text')
  const visible = ['app/_components/faq-content.ts', 'app/admin/[eventSlug]/reports/page.tsx', 'app/organizer/fairs/[fairSlug]/orders/page.tsx', 'app/vendor/[fairSlug]/dashboard/page.tsx', 'app/fair/[fairSlug]/checkout/page.tsx']
  assert(visible.every(f => !/\b10 ?%/.test(noComments(read(f)))), 'no "10%" left in customer, organizer, vendor or admin text in those files')
  const walk = (d: string, out: string[] = []): string[] => { for (const n of readdirSync(d)) { const q = join(d, n); statSync(q).isDirectory() ? walk(q, out) : /\.(tsx?)$/.test(n) && out.push(q) } return out }
  const PROMISE = /\b(refund(s|ed)?|get back)\b[^.'"`]{0,40}\bservice fee\b(?![^.'"`]{0,20}\b(isn|is not|NOT|not)\b)|\bservice fee\b[^.'"`]{0,15}\b(is|will be|gets?) refunded/i
  assert(PROMISE.test('We refund the service fee if your order is cancelled.') && !PROMISE.test("the service fee isn't refunded"), '[0] control: the promise scanner catches a planted promise and passes a refusal')
  const promising = walk(join(process.cwd(), 'app')).map(f => relative(process.cwd(), f).split(sep).join('/')).filter(f => PROMISE.test(noComments(read(f))))
  assert(promising.length === 0, `no page promises a service-fee refund (found: ${promising.join(', ') || 'none'})`)

  // ── [8] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[8] settings cards')
  const S = settings.SETTINGS as any
  const VA = 'Changing this also requires a new Vendor Agreement version. Talk to your developer first.'
  // Updated 2026-11-19 (item 10 stage 4): the payout now splits by card fees, so that note is gone too
  // (scripts/fees-stage4-test.ts [8] and platform-settings-test [7] hold it).
  assert(!S['fees.serviceFee.percentBps'].notInEffect && !S['fees.serviceFee.flatCents'].notInEffect && !S['fees.curbsideRunnerFeeCents'].notInEffect
    && !S['fees.cardFeesPaidBy'].notInEffect,
    'amber notes gone from percent, flat and curbside (checkout reads them) and from card fees (the payout reads it, stage 4)')
  assert(['fees.serviceFee.percentBps', 'fees.serviceFee.flatCents', 'fees.cardFeesPaidBy'].every(k => S[k].help.endsWith(` ${VA}`)) && !S['fees.curbsideRunnerFeeCents'].help.includes(VA),
    'the Vendor Agreement line is on the percent, flat and card-fee cards (not curbside)')
}

main()
  .catch((e) => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup(); await resetToSeed() } catch (e) { console.error('cleanup failed', e) }
    try {
      const rows = await prisma.platformSetting.findMany({ where: { key: { in: MONEY } } })
      const want: Record<string, unknown> = { 'fees.serviceFee.percentBps': 1500, 'fees.serviceFee.flatCents': 0, 'fees.curbsideRunnerFeeCents': 399, 'fees.cardFeesPaidBy': 'VENDOR' }
      assert(rows.length === 4 && rows.every(r => JSON.stringify(r.value) === JSON.stringify(want[r.key])), 'END: the four money rows are back at 1500 / 0 / 399 / VENDOR')
    } catch (e) { fail++; console.error(e) }
    delete (globalThis as any).__AFTER_RESPONSE_FOR_TEST
    await prisma.$disconnect()
    console.log(`\n${fail === 0 ? '✅' : '❌'} fees stage 3: ${pass} passed, ${fail} failed`)
    process.exit(fail === 0 ? 0 : 1)
  })
