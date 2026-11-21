/**
 * CHECKOUT FLOOR — audit H5, Step 2b.
 *
 * POST /api/orders now refuses, before any database write or Stripe call:
 *   1. ORDER_SUBTOTAL_ZERO        — no food (a $0 or negative food subtotal)
 *   2. ORDER_BELOW_PROCESSING_FEE — food smaller than the estimated card fee (2.9% + 30¢) on the
 *                                   FULL charge: food + service fee + delivery/curbside fee +
 *                                   service charge + tip
 *   3. ORDER_BELOW_MINIMUM        — a charge under Stripe's $0.50 minimum
 *
 *   [1] the estimate and the refusal order, pure
 *   [2] each refusal through the real POST /api/orders handler, with nothing written: the
 *       customer has NO user row, and a refused order must not create one (ensureDbUser runs
 *       after the floor), nor any Order row
 *   [3] accepted orders get past the floor and stop at 503 STRIPE_NOT_CONFIGURED (the key is
 *       unset here, so Stripe cannot be called at all). The first one creates the customer's user
 *       row: the positive control that [2]'s "no user row" is the floor, not a dead route
 *   [4] the exact boundary (food = estimate accepted, 1¢ over refused), via the service charge
 *       and, separately, via a curbside tip; and a two-vendor order judged on its whole subtotal
 *   [5] source: the floor runs before the user upsert, the Stripe key check, the geocode,
 *       paymentIntents.create and the order transaction
 *
 * Items priced under $1.00 can no longer be created through the API (Step 2a), so the $0, 40¢
 * and -$1 items are inserted straight into the test database: they stand in for rows priced
 * before 2a, which is exactly what this floor guards against until the CHECK constraint (2e).
 *
 * Real route handler on the test DB; Clerk identity and next/cache are mocked
 * (scripts/_route-loader.mjs), and the rate limiter is set to allow-all because the order route
 * fails closed without Redis (the cause of event-listing-test's 429s).
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/checkout-floor-test.ts
 * Self-cleaning, prefix cfl-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST
// Accepted orders must stop at the Stripe key check: no key, no Stripe call possible.
delete process.env.STRIPE_SECRET_KEY
// The floor is under test, not the vendor readiness bar (it has its own suites).
process.env.ENFORCE_VENDOR_READINESS = 'false'

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import {
  MIN_CHARGE_CENTS, STRIPE_FIXED_CENTS, checkoutRefusal, estimatedStripeFeeCents,
} from '../lib/checkout-floor'

const prisma = testPrisma()
const PFX = 'cfl-'
const MAIL = '@cfl.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/** Reads a source file as text with LF endings, so the scans behave the same on a CRLF checkout. */
function readSource(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
}

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    // Nothing here should ever have placed an order; delete defensively so a regression that
    // DID write one cannot leave rows behind.
    const orders = await prisma.order.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const oids = orders.map(o => o.id)
    if (oids.length) {
      await prisma.vendorOrderStatus.deleteMany({ where: { orderId: { in: oids } } })
      await prisma.orderItem.deleteMany({ where: { orderId: { in: oids } } })
      await prisma.order.deleteMany({ where: { id: { in: oids } } })
    }
    await prisma.menuItem.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { OR: [{ clerkId: { startsWith: PFX } }, { email: { endsWith: MAIL } }] } })
}

type Fair = { eventId: string; vendorIds: string[]; itemIds: string[] }

/** A live fair (booth pickup, or curbside too), one vendor per price, one item per vendor. */
async function mkFair(prices: number[], opts: { serviceCharge?: number; curbside?: boolean } = {}): Promise<Fair> {
  const now = Date.now()
  const event = await prisma.event.create({
    data: {
      name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE',
      startDate: new Date(now - 86_400_000), endDate: new Date(now + 86_400_000),
      ...(opts.serviceCharge !== undefined && { serviceChargeEnabled: true, serviceChargeAmount: opts.serviceCharge }),
      ...(opts.curbside && {
        fulfillmentConfig: { create: { boothPickupEnabled: true, curbsideEnabled: true, curbsideFee: 0 } },
      }),
    },
  })
  const vendorIds: string[] = [], itemIds: string[] = []
  for (const price of prices) {
    const v = await prisma.vendor.create({
      data: { eventId: event.id, name: `${PFX}booth`, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' },
    })
    // Straight into the test DB, so prices under $1.00 (rows from before Step 2a) can exist.
    const it = await prisma.menuItem.create({
      data: { vendorId: v.id, name: `${PFX}item`, price, category: 'Mains', isAvailable: true },
    })
    vendorIds.push(v.id)
    itemIds.push(it.id)
  }
  return { eventId: event.id, vendorIds, itemIds }
}

async function main() {
  console.log('\n══ CHECKOUT FLOOR (H5, Step 2b) ══')

  // ── [1] pure ────────────────────────────────────────────────────────────────────────────────
  console.log('\n[1] the estimate (2.9% half-up + 30¢) and the refusal order')
  const est: Array<[number, number, string]> = [
    [0, 30, '$0.00 → 30¢ (the fixed part alone)'],
    [500, 45, '$5.00 → 14.5¢ rounds UP to 15, + 30 = 45¢ (half-up at exactly .5)'],
    [499, 44, '$4.99 → 14.471¢ rounds down to 14, + 30 = 44¢'],
    [1100, 62, '$11.00 → 31.9¢ → 32, + 30 = 62¢'],
    [2431, 100, '$24.31 → 70.499¢ → 70, + 30 = 100¢'],
    [2432, 101, '$24.32 → 70.528¢ → 71, + 30 = 101¢'],
  ]
  for (const [total, expected, label] of est) {
    const got = estimatedStripeFeeCents(total)
    assert(got === expected, `${label} (got ${got})`)
  }
  assert(STRIPE_FIXED_CENTS === 30 && MIN_CHARGE_CENTS === 50, 'constants: 30¢ fixed, 50¢ minimum')
  const order: Array<[{ subtotalCents: number; totalCents: number }, string | null, string]> = [
    [{ subtotalCents: 0, totalCents: 0 }, 'ORDER_SUBTOTAL_ZERO', '$0 food → SUBTOTAL_ZERO, not the fee or minimum code'],
    [{ subtotalCents: -100, totalCents: 0 }, 'ORDER_SUBTOTAL_ZERO', 'negative food (a legacy row) → SUBTOTAL_ZERO'],
    [{ subtotalCents: 0, totalCents: 500 }, 'ORDER_SUBTOTAL_ZERO', '$0 food with fees on top → still SUBTOTAL_ZERO'],
    [{ subtotalCents: 20, totalCents: 22 }, 'ORDER_BELOW_PROCESSING_FEE', '20¢ food < 31¢ estimate → fee code, checked before the minimum'],
    [{ subtotalCents: 40, totalCents: 44 }, 'ORDER_BELOW_MINIMUM', '40¢ food ≥ 31¢ estimate, but 44¢ < 50¢ → minimum code'],
    [{ subtotalCents: 100, totalCents: 2431 }, null, 'food = estimate exactly → accepted'],
    [{ subtotalCents: 100, totalCents: 2432 }, 'ORDER_BELOW_PROCESSING_FEE', 'food 1¢ under the estimate → refused'],
  ]
  for (const [input, code, label] of order) {
    const got = checkoutRefusal(input)
    assert((got?.code ?? null) === code, `${label} (got ${got?.code ?? 'null'})`)
  }

  // ── fixture ─────────────────────────────────────────────────────────────────────────────────
  await cleanup()
  const rl = await import('../lib/ratelimit')
  const allowAll = { limit: async () => ({ success: true, limit: 99, remaining: 99, reset: Date.now() + 3600e3 }) }
  rl.__setStateForTest({ type: 'ready', limiters: new Proxy({}, { get: () => allowAll }) as never })
  const { POST } = await import('../app/api/orders/route')

  // A customer with NO user row: the route's ensureDbUser (after the floor) would create one.
  const clerkId = `${PFX}cust-${rand()}`
  ;(globalThis as unknown as { __MOCK_CLERK?: { userId: string } }).__MOCK_CLERK = { userId: clerkId }
  const userRows = () => prisma.user.count({ where: { clerkId } })

  type Line = { menuItemId: string; vendorId: string; quantity: number }
  const place = async (fair: Fair, extra: Record<string, unknown> = {}, lines?: Line[]) => {
    const items = lines ?? fair.itemIds.map((id, i) => ({ menuItemId: id, vendorId: fair.vendorIds[i], quantity: 1 }))
    const res = await POST(new NextRequest('http://localhost/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: fair.eventId, fulfillmentType: 'BOOTH_PICKUP', customerName: 'C', customerPhone: '6185550100',
        items, ...extra,
      }),
    }))
    const j = (await res.json().catch(() => ({}))) as { error?: { code?: string } }
    return { status: res.status, code: j?.error?.code }
  }
  const ordersFor = (fair: Fair) => prisma.order.count({ where: { eventId: fair.eventId } })

  // ── [2] refusals through the real handler ───────────────────────────────────────────────────
  console.log('\n[2] each refusal through POST /api/orders, before any write')
  const zero = await mkFair([0])
  const negative = await mkFair([-1])
  const fortyCents = await mkFair([0.4])
  const overFee = await mkFair([1], { serviceCharge: 23.22 })

  const refusals: Array<[string, Fair, string]> = [
    ['$0 item (seeded legacy row)', zero, 'ORDER_SUBTOTAL_ZERO'],
    ['-$1 item (seeded legacy row)', negative, 'ORDER_SUBTOTAL_ZERO'],
    ['40¢ item: passes the fee rule (estimate 31¢), total 44¢', fortyCents, 'ORDER_BELOW_MINIMUM'],
    ['$1 item + $23.22 service charge: total 2432¢, estimate 101¢', overFee, 'ORDER_BELOW_PROCESSING_FEE'],
  ]
  for (const [label, fair, code] of refusals) {
    const r = await place(fair)
    assert(r.status === 400 && r.code === code, `${label} → 400 ${code} (got ${r.status} ${r.code})`)
    assert(await ordersFor(fair) === 0, `${label}: no Order row`)
  }
  assert(await userRows() === 0, 'no refused order created the customer\'s user row (ensureDbUser never ran)')

  // ── [3] accepted orders get past the floor ──────────────────────────────────────────────────
  console.log('\n[3] accepted orders pass the floor and stop at the Stripe key check')
  const tenDollar = await mkFair([10])
  // Accepted orders send the total the customer was shown (audit H5, 2h: checked right after the
  // floor, before any write). The refusals in [2] never reach that check, so they send none.
  const ten = await place(tenDollar, { expectedTotalCents: 1100 })
  assert(ten.status === 503 && ten.code === 'STRIPE_NOT_CONFIGURED',
    `$10 item at booth pickup (total 1100¢, estimate 62¢) → past the floor, 503 STRIPE_NOT_CONFIGURED (got ${ten.status} ${ten.code})`)
  assert(await userRows() === 1,
    '[0] positive control: the accepted order DID reach ensureDbUser and created the user row, so [2]\'s zero is the floor refusing early')
  assert(await ordersFor(tenDollar) === 0, 'no Order row (stopped before Stripe and the order transaction)')

  // ── [4] the boundary, the tip, and multi-vendor ─────────────────────────────────────────────
  console.log('\n[4] boundary: food = estimate is accepted, 1¢ under is refused')
  const atFee = await mkFair([1], { serviceCharge: 23.21 })
  const atR = await place(atFee, { expectedTotalCents: 2431 })
  assert(atR.status === 503 && atR.code === 'STRIPE_NOT_CONFIGURED',
    `$1 item + $23.21 service charge (total 2431¢, estimate 100¢ = food) → accepted (got ${atR.status} ${atR.code})`)
  // The $23.22 case is the refusal already asserted in [2].

  console.log('\n[4b] the tip is part of the full charge (curbside)')
  const curb = await mkFair([1], { curbside: true })
  const curbExtra = (tip: number, expectedTotalCents?: number) =>
    ({ fulfillmentType: 'CURBSIDE', vehicleMake: 'Honda', vehicleColor: 'Blue', tip, ...(expectedTotalCents !== undefined && { expectedTotalCents }) })
  const tipOk = await place(curb, curbExtra(23.21, 2431))
  assert(tipOk.status === 503 && tipOk.code === 'STRIPE_NOT_CONFIGURED',
    `$1 item + $23.21 tip (total 2431¢) → accepted (got ${tipOk.status} ${tipOk.code})`)
  const tipOver = await place(curb, curbExtra(23.22))
  assert(tipOver.status === 400 && tipOver.code === 'ORDER_BELOW_PROCESSING_FEE',
    `$1 item + $23.22 tip (total 2432¢) → 400 ORDER_BELOW_PROCESSING_FEE (got ${tipOver.status} ${tipOver.code})`)
  assert(await ordersFor(curb) === 0, 'no Order row from either curbside call')

  console.log('\n[4c] a two-vendor order is judged on its WHOLE food subtotal')
  const two = await mkFair([1, 1], { serviceCharge: 23.21 })
  // $2 food + $0.20 fee + $23.21 = 2541¢ → estimate floor((73689+500)/1000)+30 = 104¢ ≤ 200¢.
  // Each vendor's $1 alone would be under 104¢; the order passes because the rule is order-wide.
  assert(estimatedStripeFeeCents(2541) === 104, 'estimate for the two-vendor total is 104¢ (more than either vendor\'s 100¢)')
  const twoR = await place(two, { expectedTotalCents: 2541 })
  assert(twoR.status === 503 && twoR.code === 'STRIPE_NOT_CONFIGURED',
    `two vendors, $1 each, $23.21 service charge → accepted on the order-wide subtotal (got ${twoR.status} ${twoR.code})`)

  // ── [5] source order ────────────────────────────────────────────────────────────────────────
  console.log('\n[5] source: the floor runs before every write and Stripe call')
  const src = readSource('app/api/orders/route.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const at = (needle: string) => src.indexOf(needle)
  const floorAt = at('checkoutRefusal(')
  assert(floorAt > 0, 'the route calls checkoutRefusal(')
  assert(floorAt > at('const total = '), 'it runs after the total is computed')
  for (const later of ['ensureDbUser(', "process.env.STRIPE_SECRET_KEY === 'sk_test_placeholder'", 'decideDeliveryRadius(', 'stripe.paymentIntents.create(', 'db.$transaction(']) {
    const i = at(later)
    // indexOf returns -1 when absent, and -1 < anything; require BOTH to be present, or a route
    // with no floor at all would pass every one of these.
    assert(floorAt > 0 && i > 0 && floorAt < i, `checkoutRefusal( comes before ${later} (${floorAt} < ${i})`)
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
