/**
 * B1.19 SALES TAX (BATCH-1 B1.19; test plan approved 2026-11-21). Test DB, Stripe stubbed in-process.
 *
 *   T1 rates: parse (8.35 → 8350, 7.125 → 7125, 0, 15; 15.001 / 4 decimals / negative refused; '' = none); reason
 *      required; a log row per changed part; unchanged parts write nothing; the organizer-safe settings allowlist
 *      never writes rates; non-admin 403 (super_admin positive control)
 *   T2 rounding: half-cent edges per part; $4.35 + $15.25 at 8.35% + 1% = $1.82 (combined-rate order-level $1.83);
 *      order tax = Σ parts; no rates = no tax; partial-refund share exact (even / odd d), never above charged
 *   T3 end to end (real POST /api/orders): estimate = summary = PaymentIntent = itemized = stored total; per-vendor
 *      rows + snapshot; fees untaxed; metadata keeps every old key + taxCents; a rate change after the estimate →
 *      the server's rate wins
 *   T4 payout: $50 + 8% → share 186, pay 5214, FairSynq 728; Payout gross + tax − withheld = net; split + earning
 *      store the tax; PLATFORM pays 5400; a legacy order carrying tax halts
 *   T5 refunds: full returns exactly the stored tax; partial returns the exact share; refund rows hold the parts;
 *      Stripe refund = food + tax; after payout the clawback reverses the vendor's whole net (tax included);
 *      itemization shows a Tax refund line; the partial confirmation text shows food + tax = total
 *   T6 estimate: VENDOR with tax never above the real payout when the real fee ≤ the prediction (planted
 *      tax-blind estimator caught); PLATFORM exact food + tax
 *   T7 report: collected − refunded = net per vendor and = stored records; vendor route returns only its own row;
 *      organizer gets 403 on the admin report (super_admin 200); Central date edges pinned from the data
 *   T8 copy: exactly one "Tax" line at checkout and in the itemization
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/tax-test.ts
 */
import './fee-baseline' // test env (test Upstash, stub Stripe key, no queue) + route loader (Clerk / next/cache mocks)
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { testPrisma } from '../lib/test-db'

const prisma = testPrisma()
const PFX = 'tax-', MAIL = '@tax.local', rand = () => Math.random().toString(36).slice(2, 8)
let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }
const login = (clerkId: string | null, roles: string[] = []) => { (globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata: { roles } } : undefined }
const jsonReq = (url: string, method: string, body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})

// ── Stripe stub ────────────────────────────────────────────────────────────────────────
const pis: any[] = [], refunds: any[] = [], reversals: any[] = [], transfers: any[] = []
let fee = 208
async function stubStripe() {
  const { stripe } = await import('../lib/stripe')
  const s = stripe as any
  s.paymentIntents.create = async (p: any) => { pis.push(p); return { id: `pi_tax_${rand()}`, client_secret: `sec_${rand()}`, amount: p.amount, metadata: p.metadata } }
  s.paymentIntents.update = async () => ({})
  s.paymentIntents.retrieve = async () => ({ latest_charge: null })
  s.charges.retrieve = async (id: string) => ({ id, transfer_group: null, balance_transaction: { id: `txn_${id}`, fee } })
  s.transfers.create = async (p: any, o: any) => { transfers.push({ p, o }); return { id: `tr_tax_${transfers.length}_${rand()}` } }
  s.refunds.create = async (p: any, o: any) => { refunds.push({ p, o }); return { id: `re_tax_${refunds.length}` } }
  s.transfers.createReversal = async (id: string, p: any) => { reversals.push({ id, p }); return { id: `trr_tax_${reversals.length}` } }
  s.balance.retrieve = async () => ({ available: [{ currency: 'usd', amount: 1_000_000 }] })
}

async function cleanup() {
  const evs = (await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })).map(e => e.id)
  const oids = (await prisma.order.findMany({ where: { eventId: { in: evs } }, select: { id: true } })).map(o => o.id)
  for (const m of ['refund', 'payout', 'payoutHold', 'vendorEarning', 'orderFeeSplitVendor', 'orderFeeSplit', 'partnerEarning', 'orderVendorTax', 'vendorOrderStatus', 'orderItem', 'orderEvent'] as const) {
    await (prisma as any)[m].deleteMany({ where: { orderId: { in: oids } } })
  }
  await prisma.order.deleteMany({ where: { id: { in: oids } } })
  await prisma.eventTaxRateChange.deleteMany({ where: { eventId: { in: evs } } })
  const vids = (await prisma.vendor.findMany({ where: { eventId: { in: evs } }, select: { id: true } })).map(v => v.id)
  await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
  await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
  await prisma.vendor.deleteMany({ where: { id: { in: vids } } })
  await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: evs } } })
  await prisma.event.deleteMany({ where: { id: { in: evs } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

/** An ACTIVE fair with one vendor per price, optional rates. */
async function mkFair(prices: number[], rates: { s?: number | null; l?: number | null } = {}) {
  const now = Date.now()
  const ev = await prisma.event.create({ data: {
    name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', startDate: new Date(now - 864e5), endDate: new Date(now + 3 * 864e5),
    salesTaxRateMilli: rates.s ?? null, localTaxRateMilli: rates.l ?? null,
    fulfillmentConfig: { create: { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: false } },
  } })
  const items = [] as { menuItemId: string; vendorId: string; quantity: number }[]
  for (const price of prices) {
    const v = await prisma.vendor.create({ data: { eventId: ev.id, name: `${PFX}v${items.length}`, slug: `${PFX}${rand()}`, cuisineType: 'T', status: 'ACTIVE',
      stripeAccountId: `acct_${PFX}${rand()}`, stripeVerified: true } })
    const mi = await prisma.menuItem.create({ data: { vendorId: v.id, name: 'Item', price, category: 'T' } })
    items.push({ menuItemId: mi.id, vendorId: v.id, quantity: 1 })
  }
  return { eventId: ev.id, slug: ev.urlSlug, items }
}
/** The total the checkout page would show for this cart, from the database (prices, markup, rates, money settings). */
async function pageTotalCents(fx: { eventId: string; items: { menuItemId: string; vendorId: string; quantity: number }[] }) {
  const { checkoutTotals, toCents } = await import('../lib/checkout-total')
  const { getMoneySettings } = await import('../lib/settings')
  const ev = await prisma.event.findUniqueOrThrow({ where: { id: fx.eventId } })
  const prices = new Map((await prisma.menuItem.findMany({ where: { id: { in: fx.items.map(i => i.menuItemId) } } })).map(m => [m.id, m.price]))
  return checkoutTotals({
    lines: fx.items.map(i => ({ inPersonCents: toCents(prices.get(i.menuItemId)!), quantity: i.quantity, vendorId: i.vendorId })),
    markupBps: ev.onlineMarkupBps, feeTerms: await getMoneySettings(), deliveryFeeCents: 0, tipCents: 0,
    taxRates: { salesTaxRateMilli: ev.salesTaxRateMilli, localTaxRateMilli: ev.localTaxRateMilli },
  }).totalCents
}
/** Places a booth order sending the page's total (checkout requires expectedTotalCents); `expected` overrides it. */
async function placeOrder(fx: { eventId: string; items: any[] }, expected?: number) {
  const expectedTotalCents = expected ?? await pageTotalCents(fx)
  const POST = (await import('../app/api/orders/route')).POST
  const clerkId = `${PFX}c-${rand()}`
  await prisma.user.create({ data: { clerkId, email: `c-${rand()}${MAIL}`, name: 'C' } })
  login(clerkId)
  const at = pis.length
  const res = await POST(jsonReq('/api/orders', 'POST', { eventId: fx.eventId, fulfillmentType: 'BOOTH_PICKUP', customerName: 'C', customerPhone: '6185550100', items: fx.items, expectedTotalCents }) as any)
  const body: any = await res.json().catch(() => ({}))
  return { status: res.status, body, pi: pis.length > at ? pis[pis.length - 1] : null, orderId: body?.data?.orderId as string | undefined }
}
/** Mark an order paid + completed so the payout / refund engines take it (what placePaidOrder + the vendor would do). */
async function markPaid(orderId: string) {
  const o = await prisma.order.findUnique({ where: { id: orderId }, include: { orderItems: true } })
  await prisma.order.update({ where: { id: orderId }, data: { status: 'COMPLETED', stripeChargeId: `ch_${PFX}${rand()}`, completedAt: new Date() } })
  for (const v of new Set(o!.orderItems.map(i => i.vendorId))) await prisma.vendorOrderStatus.create({ data: { orderId, vendorId: v, status: 'COMPLETED' } })
}

async function main() {
  await cleanup()
  await stubStripe()
  const tax = await import('../lib/fees/tax')
  // Ported 2026-11-23: lib/fees/price.ts is gone; tax is computed by the one calculator, checkoutTotals.
  const { checkoutTotals } = await import('../lib/checkout-total')
  const T = { serviceFeeBps: 1500, serviceFeeFlatCents: 0 }
  const priceAt = (lines: { cents: number; vendorId: string }[], taxRates: { salesTaxRateMilli: number | null; localTaxRateMilli: number | null }, markupBps = 0) =>
    checkoutTotals({ lines: lines.map(l => ({ inPersonCents: l.cents, quantity: 1, vendorId: l.vendorId })), markupBps, feeTerms: T, deliveryFeeCents: 0, tipCents: 0, taxRates })

  // ── T1 rates ─────────────────────────────────────────────────────────────────────────
  console.log('[T1] Rates')
  const P = tax.parseTaxRatePercent
  const ok = (x: ReturnType<typeof P>, v: number | null) => x.ok && x.value === v
  assert(ok(P('8.35'), 8350) && ok(P('7.125'), 7125) && ok(P('0'), 0) && ok(P('15'), 15000) && ok(P('8.35%'), 8350), '8.35 → 8350, 7.125 → 7125, 0, 15, "8.35%" accepted')
  assert(ok(P(''), null) && ok(P(null), null), 'blank = not charged (null)')
  assert(!P('15.001').ok && !P('8.3555').ok && !P('-1').ok && !P('abc').ok && !P('8,35').ok, '15.001, 4 decimals, negative, text and a comma are refused')
  const fair1 = await mkFair([5])
  const { updateEventTaxRates } = await import('../lib/event-tax-rates')
  const refusedField = async (body: any) => { try { await updateEventTaxRates(prisma as any, { eventId: fair1.eventId, body, actorId: 'x', actorRole: 'admin' }); return null } catch (e: any) { return e.field } }
  assert(await refusedField({ salesTaxRate: '8.35' }) === 'reason', 'a change without a reason is refused (field: reason)')
  assert(await refusedField({ salesTaxRate: '15.5', reason: 'r' }) === 'salesTaxRate', 'an out-of-range rate is refused (field: salesTaxRate)')
  const r1 = await updateEventTaxRates(prisma as any, { eventId: fair1.eventId, body: { salesTaxRate: '8.35', localTaxRate: '1', reason: 'Collinsville rates' }, actorId: 'admin_1', actorRole: 'admin' })
  const ev1 = await prisma.event.findUnique({ where: { id: fair1.eventId } })
  assert(ev1?.salesTaxRateMilli === 8350 && ev1?.localTaxRateMilli === 1000 && r1.changes.length === 2, 'both rates saved; one log row per changed part (2)')
  await updateEventTaxRates(prisma as any, { eventId: fair1.eventId, body: { salesTaxRate: '8.35', localTaxRate: '', reason: 'drop local' }, actorId: 'admin_1', actorRole: 'admin' })
  const logs = await prisma.eventTaxRateChange.findMany({ where: { eventId: fair1.eventId }, orderBy: { createdAt: 'asc' } })
  assert(logs.length === 3 && logs[2].part === 'local' && logs[2].oldValue === 1000 && logs[2].newValue === null && logs[2].reason === 'drop local',
    'an unchanged part writes nothing; the cleared part logs old → null with its reason')
  assert(await refusedField({ salesTaxRate: '8.35', reason: 'same' }) === 'none', 'a save with nothing changed is refused')
  const { buildSafeSettingsUpdate } = await import('../lib/admin-event-settings')
  const safe = buildSafeSettingsUpdate({ name: 'x', salesTaxRateMilli: 9999, localTaxRateMilli: 9999, salesTaxRate: '9' }, { startDate: new Date(), endDate: new Date(Date.now() + 864e5) })
  assert(Object.keys(safe).join() === 'name', 'the organizer-safe settings allowlist never picks a tax field')
  const route = await import('../app/api/admin/events/[id]/tax/route')
  login(`${PFX}org-${rand()}`, ['organizer'])
  const denied = await route.PATCH(jsonReq(`/api/admin/events/${fair1.slug}/tax`, 'PATCH', { salesTaxRate: '9', reason: 'x' }) as any, { params: Promise.resolve({ id: fair1.slug }) })
  login(`${PFX}sa-${rand()}`, ['super_admin'])
  const allowed = await route.GET(jsonReq(`/api/admin/events/${fair1.slug}/tax`, 'GET') as any, { params: Promise.resolve({ id: fair1.slug }) })
  assert(denied.status === 403 && allowed.status === 200, 'organizer → 403 on the tax route; [0] control: super_admin → 200')

  // ── T2 rounding ──────────────────────────────────────────────────────────────────────
  console.log('\n[T2] Rounding')
  assert(tax.taxPartCents(10, 5000) === 1 && tax.taxPartCents(9, 5000) === 0 && tax.taxPartCents(30, 5000) === 2 && tax.taxPartCents(100, 5000) === 5,
    'half-cent edges: 0.5¢ → 1 (up), 0.45¢ → 0, 1.5¢ → 2, exact 5¢ stays 5')
  assert(tax.taxPartCents(1000, null) === 0 && tax.taxPartCents(1000, 0) === 0, 'no rate / 0% → 0')
  const two = tax.vendorTaxes({ a: 435, b: 1525 }, { salesTaxRateMilli: 8350, localTaxRateMilli: 1000 })
  const combined = Math.floor((1960 * 9350 + 50000) / 100000)
  assert(tax.totalTaxCents(two) === 182 && combined === 183, '$4.35 + $15.25 at 8.35% + 1% → $1.82 per vendor and part (one combined rate on the order would give $1.83)')
  assert(JSON.stringify(two.map(t => [t.salesTaxCents, t.localTaxCents])) === '[[36,4],[127,15]]', 'parts: 36 + 4 and 127 + 15; order tax = Σ parts')
  const noTax = priceAt([{ cents: 500, vendorId: 'a' }], { salesTaxRateMilli: null, localTaxRateMilli: null })
  assert(noTax.taxCents === 0 && noTax.vendorTaxes.length === 0 && noTax.totalCents === 575, 'no rates → no tax rows, tax 0, total unchanged')
  // Under an online markup the tax is on the marked-up (online) food, the price the customer pays (Feran, 2026-11-23).
  const mk = priceAt([{ cents: 1000, vendorId: 'a' }], { salesTaxRateMilli: 10000, localTaxRateMilli: null }, 1000)
  assert(mk.onlineSubtotalCents === 1100 && mk.serviceFeeCents === 150 && mk.taxCents === 110 && mk.totalCents === 1360,
    'at a 10% markup: $10 → online $11; fee 15% of the booth $10 = 150¢; tax 10% of the online $11 = 110¢; total 1360¢')
  let threwNoVendor = false
  try { checkoutTotals({ lines: [{ inPersonCents: 500, quantity: 1 }], markupBps: 0, feeTerms: T, deliveryFeeCents: 0, tipCents: 0, taxRates: { salesTaxRateMilli: 8000, localTaxRateMilli: null } }) } catch { threwNoVendor = true }
  assert(threwNoVendor, 'a taxed cart line with no vendorId throws (tax is per vendor), never silently untaxed')
  const R = tax.refundTaxParts
  assert(JSON.stringify(R({ salesTaxCents: 36, localTaxCents: 4 }, 435, 435)) === '{"salesTaxCents":36,"localTaxCents":4}', 'a full refund returns exactly the stored parts')
  assert(R({ salesTaxCents: 5, localTaxCents: 0 }, 1, 10).salesTaxCents === 1, 'even d landing exactly on a half cent (5 × 1 / 10 = 0.5) → 1')
  assert(R({ salesTaxCents: 7, localTaxCents: 0 }, 1, 3).salesTaxCents === 2 && R({ salesTaxCents: 5, localTaxCents: 0 }, 1, 3).salesTaxCents === 2, 'odd d: 7/3 = 2.33 → 2, 5/3 = 1.67 → 2')
  let over = 0
  for (let i = 1; i <= 2000; i++) { const d = 1 + (i * 37) % 9000, a = 1 + (i * 53) % d, part = (i * 11) % 1500; const g = R({ salesTaxCents: part, localTaxCents: part }, a, d); if (g.salesTaxCents > part || g.localTaxCents > part) over++ }
  assert(over === 0, 'across 2,000 partials, tax refunded is never above tax charged')

  // ── T3 end to end ────────────────────────────────────────────────────────────────────
  console.log('\n[T3] End to end through POST /api/orders')
  const fair3 = await mkFair([4.35, 15.25], { s: 8350, l: 1000 })
  const est = priceAt([{ cents: 435, vendorId: fair3.items[0].vendorId }, { cents: 1525, vendorId: fair3.items[1].vendorId }], { salesTaxRateMilli: 8350, localTaxRateMilli: 1000 })
  const o3 = await placeOrder(fair3, est.totalCents)
  const row3 = await prisma.order.findUnique({ where: { id: o3.orderId! }, include: { vendorTaxes: true } })
  assert(o3.status === 201, 'order created (201)')
  assert(est.totalCents === 2436 && o3.pi?.amount === 2436 && Math.round(o3.body.data.summary.total * 100) === 2436 && Math.round(row3!.total * 100) === 2436,
    'estimate = PaymentIntent = summary = stored total = 2436¢ (1960 food + 294 fee + 182 tax)')
  assert(o3.body.data.summary.tax === 1.82 && row3?.taxCents === 182 && row3?.salesTaxRateMilli === 8350 && row3?.localTaxRateMilli === 1000, 'summary tax $1.82; order stores tax 182 and the rate snapshot')
  const vt = row3!.vendorTaxes.sort((a, b) => a.foodCents - b.foodCents)
  assert(vt.length === 2 && vt[0].salesTaxCents === 36 && vt[0].localTaxCents === 4 && vt[1].salesTaxCents === 127 && vt[1].localTaxCents === 15, 'one OrderVendorTax row per vendor with its parts')
  assert(Math.round(row3!.fairSynqFee * 100) === 294, 'the service fee is untaxed (294 = 15% of food only)')
  const OLD = ['primaryVendorId', 'eventId', 'customerId', 'fulfillmentType', 'fairSynqFee', 'serviceFee', 'deliveryFee', 'serviceCharge', 'tip', 'vendorIds', 'vendorSubtotalCents', 'feeModel', 'serviceFeeBps', 'serviceFeeFlatCents', 'cardFeesPaidBy']
  assert(OLD.every(k => k in o3.pi.metadata) && o3.pi.metadata.taxCents === '182', 'PaymentIntent metadata keeps every earlier key and adds taxCents "182"')
  const { itemizeOrder } = await import('../lib/order-itemization')
  const it3 = itemizeOrder({ ...row3!, orderItems: row3!.vendorTaxes.map(t => ({ vendorId: t.vendorId, subtotal: t.foodCents / 100 })), refunds: [] } as any)
  assert(it3.reconciles && it3.charges.filter(c => c.key === 'tax').length === 1 && it3.charges.find(c => c.key === 'tax')!.cents === 182, 'itemization: one Tax line of 182¢ and the lines reconcile to the total')
  // A rate change after the estimate: the server prices with the rate it reads. Since the client's 409
  // check (audit H5 2h) the stale page total is refused first, with the server's total, and nothing is charged.
  await prisma.event.update({ where: { id: fair3.eventId }, data: { salesTaxRateMilli: 9000 } })
  const expect3b = tax.totalTaxCents(tax.vendorTaxes({ a: 435, b: 1525 }, { salesTaxRateMilli: 9000, localTaxRateMilli: 1000 }))
  const stale = await placeOrder(fair3, est.totalCents)
  assert(stale.status === 409 && stale.body?.error?.code === 'PRICE_CHANGED' && stale.body?.error?.details?.newTotalCents === 1960 + 294 + expect3b && stale.pi === null
    && stale.body?.error?.details?.breakdown?.tax === expect3b / 100,
    `the stale estimate (2436¢) → 409 PRICE_CHANGED with the server's ${1960 + 294 + expect3b}¢ and its tax in the breakdown; nothing charged`)
  const o3b = await placeOrder(fair3, stale.body?.error?.details?.newTotalCents)
  const row3b = await prisma.order.findUnique({ where: { id: o3b.orderId! } })
  assert(row3b?.taxCents === expect3b && expect3b !== 182 && row3b?.salesTaxRateMilli === 9000 && o3b.pi?.amount === 1960 + 294 + expect3b, `confirming it: the order uses the server's new rate (${expect3b}¢), not the stale estimate`)

  // ── T4 payout ────────────────────────────────────────────────────────────────────────
  console.log('\n[T4] Payout with tax')
  const { processOrderPayout } = await import('../lib/process-payout')
  const payWith = async (mode: 'VENDOR' | 'PLATFORM') => {
    const f = await mkFair([50], { s: 8000 })
    const o = await placeOrder(f)
    await prisma.order.update({ where: { id: o.orderId! }, data: { cardFeesPaidBy: mode } })
    await markPaid(o.orderId!)
    fee = 208
    const at = transfers.length
    await processOrderPayout(o.orderId!)
    const p = await prisma.payout.findFirst({ where: { orderId: o.orderId! } })
    const e = await prisma.vendorEarning.findFirst({ where: { orderId: o.orderId! } })
    const sp = await prisma.orderFeeSplit.findUnique({ where: { orderId: o.orderId! }, include: { vendors: true } })
    return { o, sent: transfers.slice(at).map(t => t.p.amount), p, e, sp, f }
  }
  const v4 = await payWith('VENDOR')
  assert(v4.sent.join() === '5214' && v4.sp?.vendors[0].feeShareCents === 186 && v4.sp?.fairsynqNetCents === 728 && v4.sp?.vendors[0].taxCents === 400,
    '$50 + 8%: vendor share 186¢, paid 5214¢ (food + tax − share), FairSynq 728¢; the split stores tax 400')
  const c = (n: number | undefined | null) => Math.round((n ?? 0) * 100)
  assert(c(v4.p?.grossAmount) === 5000 && c(v4.p?.taxAmount) === 400 && c(v4.p?.fairSynqFee) === 186 && c(v4.p?.netAmount) === 5214 && c(v4.p?.grossAmount) + c(v4.p?.taxAmount) - c(v4.p?.fairSynqFee) === c(v4.p?.netAmount),
    'Payout row: gross 5000 + tax 400 − withheld 186 = net 5214')
  assert(v4.e?.taxCents === 400 && v4.e?.netCents === 5214, 'VendorEarning stores tax 400 inside net 5214')
  const p4 = await payWith('PLATFORM')
  assert(p4.sent.join() === '5400' && c(p4.p?.fairSynqFee) === 0 && c(p4.p?.netAmount) === 5400, 'PLATFORM with tax: the vendor gets food + tax in full (5400), 0 withheld')
  const legacy = await mkFair([10])
  const ol = await placeOrder(legacy)
  await prisma.order.update({ where: { id: ol.orderId! }, data: { feeModel: null, taxCents: 80, total: { increment: 0.8 } } })
  await markPaid(ol.orderId!)
  let halted = ''
  try { await processOrderPayout(ol.orderId!) } catch (e: any) { halted = e?.name ?? String(e) }
  assert(halted === 'PayoutReconciliationError', 'a legacy (feeModel null) order carrying tax halts instead of guessing a payout')

  // ── T5 refunds ───────────────────────────────────────────────────────────────────────
  console.log('\n[T5] Refunds with tax')
  const { refundVendorPortion } = await import('../lib/process-refund')
  const f5 = await mkFair([50], { s: 8000, l: 1000 })
  const full = await placeOrder(f5); await markPaid(full.orderId!)
  const vid = f5.items[0].vendorId
  let at = refunds.length
  const rf = await refundVendorPortion({ orderId: full.orderId!, vendorId: vid, reason: 'test full', actor: 'system' })
  const rrow = await prisma.refund.findUnique({ where: { orderId_vendorId: { orderId: full.orderId!, vendorId: vid } } })
  assert(rf.salesTaxCents === 400 && rf.localTaxCents === 50 && refunds[at].p.amount === 5450 && rrow?.amountCents === 5000 && rrow?.salesTaxCents === 400 && rrow?.localTaxCents === 50,
    'full vendor refund: Stripe refund 5450 = food 5000 + exactly the stored tax (400 + 50); the row keeps food and both parts apart')
  const part = await placeOrder(f5); await markPaid(part.orderId!)
  at = refunds.length
  const rp = await refundVendorPortion({ orderId: part.orderId!, vendorId: vid, reason: 'test partial', actor: 'system', amountCentsOverride: 2500 })
  assert(rp.salesTaxCents === 200 && rp.localTaxCents === 25 && refunds[at].p.amount === 2725, 'partial 2500 of 5000 food: tax 200 + 25 by the exact share; Stripe refund 2725')
  const partRow = await prisma.order.findUnique({ where: { id: part.orderId! }, include: { orderItems: true, refunds: true } })
  const itP = itemizeOrder({ ...partRow!, refunds: partRow!.refunds } as any)
  const taxLine = itP.refunds.find(r => r.key === 'tax')
  assert(!!taxLine && taxLine.cents === 225 && itP.refundedCents === 2725 && /Tax refunded \$2\.25/.test(itP.refundSummary), 'itemization shows a Tax refund line of $2.25 and "Tax refunded $2.25"')
  const paid = await placeOrder(f5); await markPaid(paid.orderId!)
  fee = 208
  await processOrderPayout(paid.orderId!)
  const paidNet = c((await prisma.payout.findFirst({ where: { orderId: paid.orderId! } }))?.netAmount)
  const atRev = reversals.length; at = refunds.length
  await refundVendorPortion({ orderId: paid.orderId!, vendorId: vid, reason: 'after payout', actor: 'system' })
  assert(reversals.length === atRev + 1 && reversals[atRev].p.amount === paidNet && paidNet > 5000 && refunds[at].p.amount === 5450,
    `after payout: the customer gets 5450 back and the clawback reverses the vendor's whole net ${paidNet}¢ (tax included)`)
  const disputeSrc = readFileSync('app/api/organizer/fairs/[fairSlug]/disputes/[disputeId]/route.ts', 'utf8')
  assert(/food \$\$\{food\.toFixed\(2\)\} \+ tax \$\$\{tax\.toFixed\(2\)\} = \$\$\{total\.toFixed\(2\)\}/.test(disputeSrc) && /tax: taxCents \/ 100/.test(disputeSrc),
    'the organizer partial-refund confirmation reads "food $X + tax $Y = $Z" from the engine result')

  // ── T6 estimate ──────────────────────────────────────────────────────────────────────
  console.log('\n[T6] Vendor estimate with tax')
  const { computeVendorOrderEarnings, estimateExhibitAVendorShareCents, estimateStripeFeeCents } = await import('../lib/vendor-earnings')
  const { planExhibitAPayout } = await import('../lib/fees/exhibit-a')
  let checked = 0, aboveReal = 0, planted = 0, seed = 7
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  for (let t = 0; t < 400; t++) {
    const food: Record<string, number> = {}, vtax: Record<string, number> = {}
    const n = 1 + rnd(4)
    for (let i = 0; i < n; i++) { food[`v${i}`] = 200 + rnd(6000); vtax[`v${i}`] = tax.taxPartCents(food[`v${i}`], 6000 + rnd(4000)) }
    const F = Object.values(food).reduce((a, b) => a + b, 0), TX = Object.values(vtax).reduce((a, b) => a + b, 0)
    const svc = Math.floor(F * 0.15 + 0.5), total = F + TX + svc
    const Pred = estimateStripeFeeCents(total)
    for (const real of [Pred, Pred - 1, Math.floor(Pred * 0.85)]) {
      const plan = planExhibitAPayout({ vendorFoodCents: food, vendorTaxCents: vtax, serviceFeeCents: svc, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: real, cardFeesPaidBy: 'VENDOR' })
      for (const id of Object.keys(food)) {
        checked++
        const est = food[id] + vtax[id] - estimateExhibitAVendorShareCents(food, total, id, vtax)
        if (est > plan.vendorPayoutCents[id]) aboveReal++
        const blind = food[id] + vtax[id] - estimateExhibitAVendorShareCents(food, total, id) // planted: ignores tax in the weights
        if (blind > plan.vendorPayoutCents[id]) planted++
      }
    }
  }
  assert(planted > 0, `[0] planted break: an estimator blind to tax in the weights is caught (${planted} slices)`)
  assert(aboveReal === 0, `VENDOR: the estimate is never above the real payout when the real fee ≤ the prediction (${checked} slices)`)
  const ord6 = (mode: string) => ({ total: 57.5 + 4, status: 'COMPLETED', feeModel: 2, cardFeesPaidBy: mode, orderItems: [{ vendorId: 'v1', subtotal: 50 }], payouts: [], refunds: [], vendorOrderStatuses: [{ vendorId: 'v1', status: 'COMPLETED' }], vendorTaxes: [{ vendorId: 'v1', salesTaxCents: 400, localTaxCents: 0 }] })
  assert(computeVendorOrderEarnings(ord6('PLATFORM') as any, 'v1').cents === 5400, 'PLATFORM: the estimate is exactly food + tax (5400)')
  assert(computeVendorOrderEarnings(ord6('VENDOR') as any, 'v1').cents <= 5214, 'VENDOR: the $50 + 8% estimate ≤ the real 5214')

  // ── T7 report ────────────────────────────────────────────────────────────────────────
  console.log('\n[T7] Per-vendor tax report')
  const { computeTaxReport, centralDayStart } = await import('../lib/tax-report')
  const rep = await computeTaxReport(prisma as any, { eventId: f5.eventId })
  const row7 = rep.rows.find(r => r.vendorId === vid)!
  const storedTax = await prisma.orderVendorTax.findMany({ where: { vendorId: vid, order: { status: { not: 'PENDING_PAYMENT' } } } })
  const storedRef = await prisma.refund.findMany({ where: { vendorId: vid, status: 'COMPLETED' } })
  assert(row7.salesTaxCollectedCents === storedTax.reduce((s, t) => s + t.salesTaxCents, 0) && row7.salesTaxRefundedCents === storedRef.reduce((s, r) => s + r.salesTaxCents, 0),
    `collected and refunded come straight from the stored rows (sales: collected ${row7.salesTaxCollectedCents}, refunded ${row7.salesTaxRefundedCents})`)
  assert(row7.netSalesTaxCents === row7.salesTaxCollectedCents - row7.salesTaxRefundedCents && row7.netLocalTaxCents === row7.localTaxCollectedCents - row7.localTaxRefundedCents,
    'net = collected − refunded, per part')
  assert(rep.totals.netSalesTaxCents === rep.rows.reduce((s, r) => s + r.netSalesTaxCents, 0), 'totals add up the rows')
  // Vendor route: own row only. Add a second vendor at the same fair so "only its own" is meaningful.
  const vUser = `${PFX}vu-${rand()}`
  const vu = await prisma.user.create({ data: { clerkId: vUser, email: `vu-${rand()}${MAIL}`, name: 'V' } })
  await prisma.vendorMember.create({ data: { vendorId: vid, userId: vu.id, role: 'owner' } })
  const vroute = await import('../app/api/vendors/[id]/tax-report/route')
  login(vUser)
  const vres: any = await (await vroute.GET(jsonReq(`/api/vendors/${vid}/tax-report`, 'GET') as any, { params: Promise.resolve({ id: vid }) })).json()
  await markPaid(o3.orderId!) // the report counts paid orders only; pay the two-vendor order for the control
  const multi = await computeTaxReport(prisma as any, { eventId: fair3.eventId })
  assert(vres.success && vres.data.report.rows.length === 1 && vres.data.report.rows[0].vendorId === vid, 'the vendor route returns only its own row')
  assert(multi.rows.length === 2, '[0] control: the same report for a two-vendor fair has two rows')
  const otherVendor = fair3.items[0].vendorId
  const deniedV = await vroute.GET(jsonReq(`/api/vendors/${otherVendor}/tax-report`, 'GET') as any, { params: Promise.resolve({ id: otherVendor }) })
  assert(deniedV.status === 403, "a vendor can't read another vendor's row (403)")
  const aroute = await import('../app/api/admin/events/[id]/reports/tax/route')
  login(`${PFX}org-${rand()}`, ['organizer'])
  const orgRes = await aroute.GET(jsonReq(`/api/admin/events/${f5.slug}/reports/tax`, 'GET') as any, { params: Promise.resolve({ id: f5.slug }) })
  login(`${PFX}sa-${rand()}`, ['super_admin'])
  const saRes = await aroute.GET(jsonReq(`/api/admin/events/${f5.slug}/reports/tax?format=csv`, 'GET') as any, { params: Promise.resolve({ id: f5.slug }) })
  const csv = await saRes.text()
  assert(orgRes.status === 403 && saRes.status === 200 && /^Vendor,Orders,Taxable food sold/.test(csv) && /\nTOTAL,/.test(csv), 'organizer → 403; [0] control: super_admin gets the CSV (header + TOTAL row)')
  // Central date edges, pinned from the data: an order placed 23:59 Central Jan 1 counts in "to=Jan 1", 00:00 Jan 2 doesn't.
  const edgeIn = new Date(centralDayStart('2027-01-02').getTime() - 60_000), edgeOut = centralDayStart('2027-01-02')
  assert(edgeOut.toISOString() === '2027-01-02T06:00:00.000Z' && centralDayStart('2027-07-04').toISOString() === '2027-07-04T05:00:00.000Z', 'Central midnight: 06:00Z in winter, 05:00Z in summer (DST-safe)')
  const fe = await mkFair([10], { s: 10000 })
  const oIn = await placeOrder(fe), oOut = await placeOrder(fe)
  await prisma.order.update({ where: { id: oIn.orderId! }, data: { placedAt: edgeIn, status: 'COMPLETED' } })
  await prisma.order.update({ where: { id: oOut.orderId! }, data: { placedAt: edgeOut, status: 'COMPLETED' } })
  const jan1 = await computeTaxReport(prisma as any, { eventId: fe.eventId, from: '2027-01-01', to: '2027-01-01' })
  const jan2 = await computeTaxReport(prisma as any, { eventId: fe.eventId, from: '2027-01-02', to: '2027-01-02' })
  assert(jan1.totals.orderCount === 1 && jan2.totals.orderCount === 1 && jan1.totals.salesTaxCollectedCents === 100, 'the 23:59 order is Jan 1, the 00:00 order is Jan 2 (each day counts exactly one)')

  // ── T8 copy ──────────────────────────────────────────────────────────────────────────
  console.log('\n[T8] Copy')
  const checkout = readFileSync('app/fair/[fairSlug]/checkout/page.tsx', 'utf8')
  assert((checkout.match(/>Tax</g) ?? []).length === 3, 'checkout has exactly one "Tax" line in each of its three summaries (estimate, payment step, and the 409 "Prices updated" panel)')
  assert(it3.charges.filter(cl => cl.label === 'Tax').length === 1, 'the itemization has exactly one combined "Tax" charge line')
}

main()
  .catch(e => { console.error(e); fail++ })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    console.log(`\n${'─'.repeat(64)}`)
    console.log(fail === 0 ? `  ${pass} passed, 0 failed` : `  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(64)}\n`)
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
