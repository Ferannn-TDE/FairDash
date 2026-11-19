/**
 * TODAY'S 10% CHECKOUT, FROZEN (item 10 / B1.13 stage 2, plan [9]) — test database, Stripe stubbed.
 *
 * Places real orders through POST /api/orders (booth at 0.29 / 4.35 / 15.25 / 50.00, two vendors, and
 * curbside with a fee and a tip) with stripe.paymentIntents.create replaced IN-PROCESS by a stub that
 * records the params. No network, no Stripe account touched.
 *
 *   record  → writes scripts/fixtures/fee-baseline-10pct.json from the code as it is NOW. It was
 *             recorded on 2026-11-18 from f2ea694, BEFORE any stage 2 code, and must not be re-recorded
 *             to make a later run pass.
 *   check   → (default) places the same orders again and compares every stored and charged field.
 *
 * Exported for scripts/money-settings-test.ts [9]: runScenarios(), compareToBaseline(), SCENARIOS.
 *
 * AFTER THE BATCH 1 MERGE (2026-11-21, Step 9): checkout now requires `expectedTotalCents`, the total
 * the customer was shown (audit H5 2h), and refuses an order below the card minimum (the checkout
 * floor, lib/checkout-floor.ts). So every order sends the total the checkout page would show,
 * computed with the same lib/checkout-total.ts, and the $0.29 booth order is kept but marked
 * `refusedBy: 'checkout-floor'`: it must be refused with the floor's own code. The baseline file
 * is unchanged and not re-recorded; refused scenarios are left out of the comparison only.
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/fee-baseline.ts [record|check]
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
process.env.STRIPE_SECRET_KEY = 'sk_test_fee_baseline_stub_never_sent'

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { NextRequest } from 'next/server'

const prisma = testPrisma()
const PFX = 'feebase-'
const MAIL = '@feebase.local'
const BASELINE_FILE = 'scripts/fixtures/fee-baseline-10pct.json'
const rand = () => Math.random().toString(36).slice(2, 8)

export interface Scenario {
  name: string; fulfillment: 'BOOTH_PICKUP' | 'CURBSIDE'; prices: number[]; tip?: number; curbsideFee?: number
  /** Set when checkout must refuse this order: 'checkout-floor' = below the card minimum (H5 2h). */
  refusedBy?: 'checkout-floor'
}
export const SCENARIOS: Scenario[] = [
  { name: 'booth 0.29', fulfillment: 'BOOTH_PICKUP', prices: [0.29], refusedBy: 'checkout-floor' },
  { name: 'booth 4.35', fulfillment: 'BOOTH_PICKUP', prices: [4.35] },
  { name: 'booth 15.25', fulfillment: 'BOOTH_PICKUP', prices: [15.25] },
  { name: 'booth 50.00', fulfillment: 'BOOTH_PICKUP', prices: [50] },
  { name: 'booth two vendors 30.00 + 20.00', fulfillment: 'BOOTH_PICKUP', prices: [30, 20] },
  { name: 'curbside 10.00, fee 3.00, tip 2.00', fulfillment: 'CURBSIDE', prices: [10], tip: 2, curbsideFee: 3 },
]

export interface Observed {
  status: number
  stored: Record<string, unknown> | null
  piAmount: number | null
  piMetadata: Record<string, string> | null
  /** The four stage 2 snapshot columns as stored (all null until stage 3). Not part of the
   *  baseline comparison: the baseline was recorded before the columns existed. */
  snapshot?: Record<string, unknown> | null
  /** The route's error code, when it refused the order. Not part of the baseline comparison. */
  code?: string | null
  /** The code lib/checkout-floor.ts gives for this cart's page totals (null = the floor allows it). */
  floorCode?: string | null
}

/** The scenarios checkout accepts: the ones the frozen baseline is compared on. */
export const acceptedScenarios = () => SCENARIOS.filter(s => !s.refusedBy)

const login = (clerkId: string) => { (globalThis as any).__MOCK_CLERK = { userId: clerkId, publicMetadata: { roles: [] } } }
const req = (body: unknown) => new NextRequest('http://localhost/api/orders', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

/** Replace paymentIntents.create / .update on the real (lazy) client with recorders. */
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
    const orders = await prisma.order.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const oids = orders.map(o => o.id)
    await prisma.vendorOrderStatus.deleteMany({ where: { orderId: { in: oids } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: oids } } })
    await prisma.order.deleteMany({ where: { id: { in: oids } } })
    const vids = (await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(v => v.id)
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { id: { in: vids } } })
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

/** Place every scenario through the real route; returns what was stored and what Stripe was asked for. */
export async function runScenarios(): Promise<{ results: Record<string, Observed>; stubCalls: number }> {
  await cleanup()
  const created = await stubStripe()
  const ordersPOST = (await import('../app/api/orders/route')).POST
  const { checkoutTotals, toCents } = await import('../lib/checkout-total')
  const { checkoutRefusal } = await import('../lib/checkout-floor')
  const feeTerms = await (await import('../lib/settings')).getMoneySettings()
  const results: Record<string, Observed> = {}
  try {
    for (const s of SCENARIOS) {
      const now = Date.now()
      const ev = await prisma.event.create({
        data: {
          name: `${PFX}${s.name}`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE',
          startDate: new Date(now - 864e5), endDate: new Date(now + 3 * 864e5),
          fulfillmentConfig: { create: { boothPickupEnabled: true, curbsideEnabled: s.fulfillment === 'CURBSIDE', homeDeliveryEnabled: false, curbsideFee: s.curbsideFee ?? 0 } },
        },
      })
      const items = []
      for (const price of s.prices) {
        const v = await prisma.vendor.create({ data: { eventId: ev.id, name: `${PFX}v`, slug: `${PFX}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
        const mi = await prisma.menuItem.create({ data: { vendorId: v.id, name: 'Item', price, category: 'T' } })
        items.push({ menuItemId: mi.id, vendorId: v.id, quantity: 1 })
      }
      const clerkId = `${PFX}cust-${rand()}`
      await prisma.user.create({ data: { clerkId, email: `c-${rand()}${MAIL}`, name: 'C' } })
      login(clerkId)
      const before = created.length
      // The total the checkout page shows for this cart (same calculator, no markup on these fairs,
      // the money settings' fee terms, the PLATFORM curbside fee, the tip): what a real customer's
      // checkout sends. The event's own curbsideFee is ignored since stage 3 (S3-Q2).
      const page = checkoutTotals({
        lines: s.prices.map(p => ({ inPersonCents: toCents(p), quantity: 1 })),
        markupBps: 0,
        feeTerms,
        deliveryFeeCents: s.fulfillment === 'CURBSIDE' ? feeTerms.curbsideRunnerFeeCents : 0,
        tipCents: toCents(s.tip ?? 0),
      })
      const floorCode = checkoutRefusal({ subtotalCents: page.onlineSubtotalCents, totalCents: page.totalCents })?.code ?? null
      const res = await ordersPOST(req({
        eventId: ev.id, fulfillmentType: s.fulfillment, customerName: 'C', customerPhone: '6185550100',
        vehicleMake: 'Honda', vehicleColor: 'Blue', items, ...(s.tip ? { tip: s.tip } : {}),
        expectedTotalCents: page.totalCents,
      }) as any)
      const body: any = await res.json().catch(() => ({}))
      const pi = created.length > before ? created[created.length - 1] : null
      const orderId = body?.data?.orderId ?? body?.data?.order?.id ?? null
      const row = orderId ? await prisma.order.findUnique({ where: { id: orderId } }) : null
      results[s.name] = {
        status: res.status,
        code: body?.error?.code ?? null,
        floorCode,
        stored: row ? {
          subtotal: row.subtotal, fairSynqFee: row.fairSynqFee, deliveryFee: row.deliveryFee, tip: row.tip,
          serviceCharge: row.serviceCharge, total: row.total, vendorPayout: row.vendorPayout,
        } : null,
        snapshot: row ? Object.fromEntries(['feeModel', 'serviceFeeBps', 'serviceFeeFlatCents', 'cardFeesPaidBy'].map(k => [k, (row as any)[k] ?? null])) : null,
        piAmount: pi?.amount ?? null,
        piMetadata: pi ? {
          fairSynqFee: pi.metadata.fairSynqFee, serviceFee: pi.metadata.serviceFee, deliveryFee: pi.metadata.deliveryFee,
          serviceCharge: pi.metadata.serviceCharge, tip: pi.metadata.tip, vendorSubtotalCents: pi.metadata.vendorSubtotalCents,
        } : null,
      }
    }
  } finally {
    await cleanup()
  }
  return { results, stubCalls: created.length }
}

export function loadBaseline(): Record<string, Observed> {
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).results
}

/**
 * Field-by-field differences between a run and the frozen baseline (empty = identical), over the
 * scenarios checkout accepts unless `names` says otherwise.
 */
export function compareToBaseline(
  results: Record<string, Observed>,
  baseline: Record<string, Observed>,
  names: string[] = acceptedScenarios().map(s => s.name),
): string[] {
  const diffs: string[] = []
  for (const name of names) {
    if (!baseline[name]) { diffs.push(`${name}: missing from the baseline`); continue }
    const a = baseline[name], b = results[name]
    if (!b) { diffs.push(`${name}: missing from this run`); continue }
    // vendorSubtotalCents is keyed by vendor ids, which are fresh every run: compare its amounts in
    // order (the cart's vendor order), not the ids.
    const meta = (m: Record<string, string> | null) => Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) =>
      [`pi.${k}`, k === 'vendorSubtotalCents' ? JSON.stringify(Object.values(JSON.parse(v))) : v]))
    const flat = (o: Observed) => ({ status: o.status, piAmount: o.piAmount, ...(o.stored ?? {}), ...meta(o.piMetadata) })
    const fa = flat(a) as Record<string, unknown>, fb = flat(b) as Record<string, unknown>
    for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
      if (JSON.stringify(fa[k]) !== JSON.stringify(fb[k])) diffs.push(`${name}: ${k} was ${JSON.stringify(fa[k])}, now ${JSON.stringify(fb[k])}`)
    }
  }
  return diffs
}

async function main() {
  const mode = process.argv[2] ?? 'check'
  const { results, stubCalls } = await runScenarios()
  const allOk = Object.values(results).every(r => r.status === 201 && r.stored && r.piAmount !== null)
  if (mode === 'record') {
    if (!allOk || stubCalls !== SCENARIOS.length) {
      console.error('refusing to record: not every scenario created an order and a PaymentIntent', JSON.stringify(results, null, 2))
      process.exit(1)
    }
    mkdirSync('scripts/fixtures', { recursive: true })
    writeFileSync(BASELINE_FILE, JSON.stringify({
      note: 'Today\'s 10% checkout, recorded through POST /api/orders with Stripe stubbed, BEFORE item 10 stage 2. Do not re-record to make a run pass.',
      recordedAt: new Date().toISOString(), results,
    }, null, 2) + '\n')
    console.log(`recorded ${SCENARIOS.length} scenarios to ${BASELINE_FILE}`)
    for (const [n, r] of Object.entries(results)) console.log(`  ${n}: stored total ${(r.stored as any).total}, fee ${(r.stored as any).fairSynqFee}, PI ${r.piAmount}`)
  } else {
    const accepted = acceptedScenarios()
    const acceptedOk = accepted.every(s => results[s.name]?.status === 201 && results[s.name]?.stored && results[s.name]?.piAmount !== null)
    const refused = SCENARIOS.filter(s => s.refusedBy)
    const refusedOk = refused.every(s => {
      const r = results[s.name]
      return r?.status === 400 && r.floorCode !== null && r.code === r.floorCode && r.stored === null && r.piAmount === null
    })
    const diffs = compareToBaseline(results, loadBaseline())
    console.log(diffs.length === 0 ? `✅ fee baseline: ${accepted.length} accepted orders identical to the 10% baseline` : `❌ fee baseline:\n  ${diffs.join('\n  ')}`)
    for (const s of refused) console.log(`${refusedOk ? '✅' : '❌'} ${s.name}: refused by the checkout floor (got ${results[s.name]?.status} ${results[s.name]?.code}, floor says ${results[s.name]?.floorCode})`)
    process.exitCode = diffs.length === 0 && acceptedOk && refusedOk ? 0 : 1
  }
}

if (process.argv[1]?.endsWith('fee-baseline.ts')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0) })
}
