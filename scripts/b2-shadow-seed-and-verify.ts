/**
 * B2 STEP 1+2 — seed a realistic runner-payout cohort through the REAL accrual
 * path, then SHADOW-READ it with planRunnerPayout. MOVES NO MONEY (no executor
 * exists yet; planRunnerPayout is pure read).
 *
 * Non-circular by construction:
 *   - Earnings are accrued by driving genuine runner-fulfilled DELIVERED orders
 *     through reconcileMasterStatus → splitRunnerFee (Part A's real code), NOT by
 *     hand-inserting RunnerEarning rows.
 *   - Each scenario asserts planRunnerPayout's would-pay against an INDEPENDENTLY
 *     HAND-COMPUTED expected (my arithmetic), AND that ledger === the planner's
 *     own independent recompute. Three-way agreement: hand-math = accrual = read.
 *
 * Isolated + self-cleaning: all rows tagged (urlSlug 'b2seed-…', emails
 * '…@b2seed.local'), deleted in finally. REDIS_URL blanked so the DELIVERED
 * side-effect (delayed vendor-payout enqueue) is an inert no-op.
 *
 * Run:  npx tsx scripts/b2-shadow-seed-and-verify.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
// Disable the queue so the genuine DELIVERED side-effect (delayed vendor payout
// enqueue) no-ops instead of writing jobs — keeps the seed money-inert.
process.env.REDIS_URL = ''

import { REFUND_WINDOW_MS } from '../lib/constants'

const prisma = testPrisma()

const SLUG = 'b2seed-'
const MAIL = '@b2seed.local'
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`
const rand = () => Math.random().toString(36).slice(2, 10)

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    // Order delete cascades runnerEarning/organizerEarning/vendorOrderStatus/orderItem.
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
    // Event delete cascades vendor/runner/fulfillmentConfig.
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function mkUser(role: string) {
  return prisma.user.create({
    data: { clerkId: `${SLUG}clerk-${rand()}`, email: `${SLUG}${role}-${rand()}${MAIL}`, name: `B2 ${role}`, role },
  })
}

async function mkEvent(runnerFeePercent: number, homeDeliveryFee: number, curbsideFee: number) {
  const ev = await prisma.event.create({
    data: {
      name: `B2 Seed Event ${rand()}`, urlSlug: `${SLUG}${rand()}`,
      startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE',
    },
  })
  await prisma.fulfillmentConfig.create({
    data: { eventId: ev.id, homeDeliveryEnabled: true, curbsideEnabled: true, homeDeliveryFee, curbsideFee, runnerFeePercent },
  })
  return ev
}

async function mkVendor(eventId: string) {
  return prisma.vendor.create({
    data: { eventId, name: `B2 Vendor ${rand()}`, slug: `${SLUG}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' },
  })
}

async function mkRunner(eventId: string, connected: boolean) {
  const u = await mkUser('runner')
  return prisma.runner.create({
    data: {
      userId: u.id, eventId, status: 'ACTIVE',
      ...(connected ? { stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true, stripeConnectedAt: new Date() } : {}),
    },
  })
}

interface Scenario {
  label: string
  eventId: string
  vendorId: string
  runnerId: string
  fulfillmentType: 'HOME_DELIVERY' | 'CURBSIDE'
  feeCents: number
  tipCents: number
  accruedHoursAgo: number    // >4 → window closed; 0 → in window
  markPaid?: boolean
  // Independent HAND-COMPUTED expectation (not derived from any code path):
  expectOutcome: 'pay' | 'hold' | 'already_paid'
  expectAmountCents: number
  expectWindowClosed: boolean
}

async function seedDelivered(s: Scenario): Promise<string> {
  const customer = await mkUser('customer')
  const subtotalCents = 1500
  const feeSvcCents = 150
  const totalCents = subtotalCents + feeSvcCents + s.feeCents + s.tipCents
  const order = await prisma.order.create({
    data: {
      eventId: s.eventId, customerId: customer.id, vendorId: s.vendorId,
      status: 'READY', // canAdvance → DELIVERED (WRITE_GUARD: from READY)
      fulfillmentType: s.fulfillmentType,
      subtotal: subtotalCents / 100, fairSynqFee: feeSvcCents / 100,
      deliveryFee: s.feeCents / 100, tip: s.tipCents / 100,
      total: totalCents / 100, vendorPayout: subtotalCents / 100,
      customerName: 'B2 Seed', customerPhone: '+10000000000',
      runnerId: s.runnerId,                       // runner overlay
      deliveryProofPath: 'https://b2seed.local/proof.jpg', // → derives DELIVERED
      stripeChargeId: `ch_${SLUG}${rand()}`,      // source_transaction (synthetic for shadow)
    },
  })
  await prisma.vendorOrderStatus.create({
    data: { orderId: order.id, vendorId: s.vendorId, status: 'READY' },
  })
  // No OrderItem needed — neither the accrual path nor planRunnerPayout reads it.

  // ── THE REAL ACCRUAL PATH ─────────────────────────────────────────────────
  const { reconcileMasterStatus } = await import('../lib/reconcile-order-status')
  const res = await reconcileMasterStatus(order.id)
  if (!res.wrote || res.to !== 'DELIVERED') {
    throw new Error(`seed ${s.label}: expected DELIVERED, got ${res.to ?? res.reason}`)
  }

  // Backdate the accrued earning to simulate elapsed time (timestamp only — the
  // AMOUNT stays exactly what Part A's accrual produced).
  if (s.accruedHoursAgo > 0) {
    await prisma.runnerEarning.update({
      where: { orderId: order.id },
      data: { createdAt: new Date(Date.now() - s.accruedHoursAgo * 3_600_000) },
    })
  }
  // Simulate a prior payout for the idempotency-skip scenario.
  if (s.markPaid) {
    await prisma.runnerEarning.update({ where: { orderId: order.id }, data: { status: 'paid' } })
  }
  return order.id
}

async function main() {
  await cleanup() // clear any leftover from a failed prior run

  let failures = 0
  const rows: string[] = []

  try {
    // Two events: 50% split (most cases) and 0% split (tip-only case).
    const evA = await mkEvent(50, 10.0, 4.0)
    const evB = await mkEvent(0, 8.0, 0.0)
    const venA = await mkVendor(evA.id)
    const venB = await mkVendor(evB.id)
    const runnerConnA = await mkRunner(evA.id, true)
    const runnerUnconnA = await mkRunner(evA.id, false)
    const runnerConnB = await mkRunner(evB.id, true)

    const scenarios: Scenario[] = [
      { label: 'connected · home · fee+tip · closed',  eventId: evA.id, vendorId: venA.id, runnerId: runnerConnA.id,   fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, tipCents: 300, accruedHoursAgo: 5, expectOutcome: 'pay',          expectAmountCents: 800,  expectWindowClosed: true  },
      { label: 'connected · home · fee only · closed', eventId: evA.id, vendorId: venA.id, runnerId: runnerConnA.id,   fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, tipCents: 0,   accruedHoursAgo: 5, expectOutcome: 'pay',          expectAmountCents: 500,  expectWindowClosed: true  },
      { label: 'connected · curbside · fee+tip · closed', eventId: evA.id, vendorId: venA.id, runnerId: runnerConnA.id, fulfillmentType: 'CURBSIDE',     feeCents: 400,  tipCents: 200, accruedHoursAgo: 5, expectOutcome: 'pay',          expectAmountCents: 400,  expectWindowClosed: true  },
      { label: 'connected · home · fee+tip · IN-WINDOW', eventId: evA.id, vendorId: venA.id, runnerId: runnerConnA.id,  fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, tipCents: 500, accruedHoursAgo: 0, expectOutcome: 'pay',          expectAmountCents: 1000, expectWindowClosed: false },
      { label: 'UNCONNECTED · home · fee+tip · closed', eventId: evA.id, vendorId: venA.id, runnerId: runnerUnconnA.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, tipCents: 300, accruedHoursAgo: 5, expectOutcome: 'hold',         expectAmountCents: 800,  expectWindowClosed: true  },
      { label: 'connected · home · ALREADY PAID',      eventId: evA.id, vendorId: venA.id, runnerId: runnerConnA.id,   fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, tipCents: 300, accruedHoursAgo: 5, markPaid: true, expectOutcome: 'already_paid', expectAmountCents: 800,  expectWindowClosed: true  },
      { label: 'connected · home · pct=0 · TIP ONLY · closed', eventId: evB.id, vendorId: venB.id, runnerId: runnerConnB.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 800, tipCents: 400, accruedHoursAgo: 5, expectOutcome: 'pay', expectAmountCents: 400, expectWindowClosed: true },
    ]

    const { planRunnerPayout } = await import('../lib/runner-payout')
    const now = Date.now()

    rows.push('  ── SCENARIO ─────────────────────────────────┬ outcome ┬ would-pay ┬ ledger=recompute ┬ window ┬ result')
    for (const s of scenarios) {
      const orderId = await seedDelivered(s)
      const d = await planRunnerPayout(orderId)

      const windowClosed = !!(d.accruedAt && (now - d.accruedAt.getTime()) >= REFUND_WINDOW_MS)
      const payAmt = d.ledgerAmountCents ?? 0

      const okOutcome = d.outcome === s.expectOutcome
      const okAmount  = payAmt === s.expectAmountCents
      const okRecomp  = d.ledgerMatchesRecompute === true
      const okWindow  = windowClosed === s.expectWindowClosed
      const pass = okOutcome && okAmount && okRecomp && okWindow
      if (!pass) failures++

      const flags = [
        okOutcome ? '' : ` outcome=${d.outcome}≠${s.expectOutcome}`,
        okAmount  ? '' : ` amt=${payAmt}≠${s.expectAmountCents}`,
        okRecomp  ? '' : ` recompute≠ledger(${d.ledgerAmountCents}vs${d.recomputeCents})`,
        okWindow  ? '' : ` window=${windowClosed}≠${s.expectWindowClosed}`,
      ].join('')

      rows.push(
        `  ${s.label.padEnd(44)}│ ${d.outcome.padEnd(7)} │ ${fmt(payAmt).padStart(8)} │ ` +
        `${(okRecomp ? 'yes' : 'NO').padEnd(16)} │ ${(windowClosed ? 'closed' : 'open  ')} │ ${pass ? '✅' : '❌' + flags}`,
      )
    }
  } finally {
    await cleanup()
  }

  console.log('\n══════════════════════════════════════════════════════════════════════════════════════════════════')
  console.log('  B2 SHADOW — seeded cohort, accrued through real Part A path, read by planRunnerPayout (NO MONEY)')
  console.log('══════════════════════════════════════════════════════════════════════════════════════════════════')
  for (const r of rows) console.log(r)
  console.log('──────────────────────────────────────────────────────────────────────────────────────────────────')
  if (failures === 0) {
    console.log('  VERDICT: ✅ NON-VACUOUS SHADOW CLEAN — every would-pay === hand-computed expected AND')
    console.log('           === the planner\'s independent recompute; buckets + window split all correct.')
    console.log('           Three-way agreement (hand-math = Part A accrual = ledger read) holds to the cent.')
  } else {
    console.log(`  VERDICT: ⛔ ${failures} DIVERGENCE(S) — STOP. Do NOT build the executor until resolved.`)
  }
  console.log('  (cohort deleted — DB back to baseline)')
  console.log('══════════════════════════════════════════════════════════════════════════════════════════════════\n')

  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('[b2-shadow-seed-and-verify] FAILED:', err)
  try { await cleanup() } catch { /* best effort */ }
  await prisma.$disconnect()
  process.exit(2)
})
