/**
 * B2 STEP 3 — runner payout EXECUTOR integration test. Stripe test mode, with
 * stripe.transfers.create SPIED (intercept + simulate idempotency) — the same
 * spy discipline the vendor money tests use (scripts/test-c1.ts). Isolated,
 * self-cleaning; seeds through the REAL accrual path (reconcileMasterStatus).
 *
 * Proves all EIGHT assertions. The two gates: #2 (double-fire inert — no second
 * transfer) and #6 (amount transferred === ledger to the cent).
 *
 * Run:  npx tsx scripts/b2-runner-payout-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.REDIS_URL = '' // DELIVERED side-effect enqueues become inert no-ops

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
})

const SLUG = 'b2seed-'
const MAIL = '@b2seed.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

// ── Stripe spy (records real transfers; simulates idempotency by key) ─────────
interface FakeTransfer { id: string; amount: number; destination: string; source_transaction: string; key?: string }
const created: FakeTransfer[] = []          // every NEW transfer (a real create)
const byKey = new Map<string, FakeTransfer>()
async function installStripeSpy() {
  const { stripe } = await import('../lib/stripe')
  void stripe.transfers // force lazy instantiation so we patch the real client
  ;(stripe.transfers as unknown as Record<string, unknown>).create = async (params: any, opts: any) => {
    const key = opts?.idempotencyKey as string | undefined
    if (key && byKey.has(key)) return byKey.get(key)! // Stripe returns the original — NO new transfer
    const t: FakeTransfer = { id: `tr_${rand()}`, amount: params.amount, destination: params.destination, source_transaction: params.source_transaction, key }
    if (key) byKey.set(key, t)
    created.push(t)
    return t
  }
}

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function mkUser(role: string) {
  return prisma.user.create({ data: { clerkId: `${SLUG}clerk-${rand()}`, email: `${SLUG}${role}-${rand()}${MAIL}`, name: `B2 ${role}`, role } })
}
async function mkEvent(runnerFeePercent: number) {
  const ev = await prisma.event.create({ data: { name: `B2 ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE' } })
  await prisma.fulfillmentConfig.create({ data: { eventId: ev.id, homeDeliveryEnabled: true, curbsideEnabled: true, homeDeliveryFee: 10, curbsideFee: 4, runnerFeePercent } })
  return ev
}
async function mkVendor(eventId: string) {
  return prisma.vendor.create({ data: { eventId, name: `V ${rand()}`, slug: `${SLUG}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' } })
}
async function mkRunner(eventId: string, connected: boolean) {
  const u = await mkUser('runner')
  return prisma.runner.create({ data: { userId: u.id, eventId, status: 'ACTIVE', ...(connected ? { stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true, stripeConnectedAt: new Date() } : {}) } })
}

async function seedDelivered(opts: {
  eventId: string; vendorId: string; runnerId: string
  fulfillmentType: 'HOME_DELIVERY' | 'CURBSIDE'; feeCents: number; tipCents: number; accruedHoursAgo: number
}): Promise<string> {
  const customer = await mkUser('customer')
  const order = await prisma.order.create({
    data: {
      eventId: opts.eventId, customerId: customer.id, vendorId: opts.vendorId,
      status: 'READY', fulfillmentType: opts.fulfillmentType,
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: opts.feeCents / 100, tip: opts.tipCents / 100,
      total: 15 + 1.5 + opts.feeCents / 100 + opts.tipCents / 100, vendorPayout: 15,
      customerName: 'B2', customerPhone: '+10000000000',
      runnerId: opts.runnerId, deliveryProofPath: 'https://b2seed.local/p.jpg',
      stripeChargeId: `ch_${SLUG}${rand()}`,
    },
  })
  await prisma.vendorOrderStatus.create({ data: { orderId: order.id, vendorId: opts.vendorId, status: 'READY' } })

  const { reconcileMasterStatus } = await import('../lib/reconcile-order-status')
  const res = await reconcileMasterStatus(order.id)
  if (!res.wrote || res.to !== 'DELIVERED') throw new Error(`seed: expected DELIVERED, got ${res.to ?? res.reason}`)

  if (opts.accruedHoursAgo > 0) {
    await prisma.runnerEarning.update({ where: { orderId: order.id }, data: { createdAt: new Date(Date.now() - opts.accruedHoursAgo * 3_600_000) } })
  }
  return order.id
}

const ledgerOf = (orderId: string) => prisma.runnerEarning.findUnique({ where: { orderId }, select: { amountCents: true, status: true, stripeTransferId: true } })

async function main() {
  await cleanup()
  await installStripeSpy()

  try {
    const { processRunnerPayout, reconcileRunnerPayouts } = await import('../lib/runner-payout')

    const evA = await mkEvent(50)
    const evB = await mkEvent(0)
    const venA = await mkVendor(evA.id)
    const venB = await mkVendor(evB.id)
    const connA = await mkRunner(evA.id, true)
    const unconnA = await mkRunner(evA.id, false)
    const connB = await mkRunner(evB.id, true)

    // ── Assertion 1 — connected, delivered, window closed → pays exactly ledger ──
    console.log('\n[1] connected + window-closed → transfers exactly amountCents, status→paid, record written')
    const o1 = await seedDelivered({ eventId: evA.id, vendorId: venA.id, runnerId: connA.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, tipCents: 300, accruedHoursAgo: 5 })
    const before1 = created.length
    const r1 = await processRunnerPayout(o1)
    const l1 = await ledgerOf(o1)
    assert(r1.outcome === 'paid', 'outcome = paid')
    assert(created.length === before1 + 1, 'exactly one transfer created')
    assert(created[created.length - 1].amount === 800, `transfer amount = 800¢ (got ${created[created.length - 1].amount})`)
    assert(l1?.status === 'paid', 'RunnerEarning.status = paid')
    assert(!!l1?.stripeTransferId, 'RunnerEarning.stripeTransferId stamped (the payout record)')
    assert(byKey.has(`runner_payout_${o1}`), `idempotencyKey runner_payout_${o1} used`)

    // ── Assertion 6 — amount transferred === ledger to the cent ─────────────────
    console.log('\n[6] amount transferred === ledger amountCents to the cent')
    assert(created[created.length - 1].amount === l1?.amountCents, `transfer ${created[created.length - 1].amount}¢ === ledger ${l1?.amountCents}¢`)

    // ── Assertion 2 (GATE) — double-fire inert ──────────────────────────────────
    console.log('\n[2] GATE: double-fire transfers nothing')
    // (a) normal re-run: status=paid short-circuits BEFORE Stripe
    const beforeA = created.length
    const r2a = await processRunnerPayout(o1)
    assert(r2a.outcome === 'already_paid', '(a) re-run on paid row → already_paid (short-circuit)')
    assert(created.length === beforeA, '(a) NO new transfer on normal re-run')
    // (b) status-LOST re-run: force back to tracked, re-fire → idempotency key blocks a 2nd transfer
    await prisma.runnerEarning.update({ where: { orderId: o1 }, data: { status: 'tracked', stripeTransferId: null, paidAt: null } })
    const beforeB = created.length
    const r2b = await processRunnerPayout(o1)
    assert(created.length === beforeB, '(b) status-lost re-run → idempotency key returns original, NO 2nd transfer')
    assert(r2b.outcome === 'paid' && r2b.transferId === byKey.get(`runner_payout_${o1}`)!.id, '(b) returns the SAME transfer id')
    const l1b = await ledgerOf(o1)
    assert(l1b?.status === 'paid', '(b) row re-marked paid')

    // ── Assertion 3 — unconnected → held, no transfer, no error ─────────────────
    console.log('\n[3] unconnected runner → held, no transfer, status stays tracked, no error')
    const o3 = await seedDelivered({ eventId: evA.id, vendorId: venA.id, runnerId: unconnA.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, tipCents: 300, accruedHoursAgo: 5 })
    const before3 = created.length
    const r3 = await processRunnerPayout(o3)
    const l3 = await ledgerOf(o3)
    assert(r3.outcome === 'held', 'outcome = held')
    assert(created.length === before3, 'NO transfer for unconnected runner')
    assert(l3?.status === 'tracked', 'status stays tracked (the ledger row IS the hold)')

    // ── Assertion 4 — held runner connects → reconciler pays (loop closes) ──────
    console.log('\n[4] held runner THEN connects → reconciler pays them')
    await prisma.runner.update({ where: { id: unconnA.id }, data: { stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true, stripeConnectedAt: new Date() } })
    const before4 = created.length
    const rec4 = await reconcileRunnerPayouts()
    const l4 = await ledgerOf(o3)
    assert(rec4.paid >= 1, `reconciler paid ≥1 (paid=${rec4.paid})`)
    assert(created.length === before4 + 1, 'exactly one transfer created by reconciler')
    assert(l4?.status === 'paid' && !!l4.stripeTransferId, 'held earning now paid + record stamped (pay-when-connected loop closed)')

    // ── Assertion 5 — window gate: in-window not paid; pays after window ────────
    console.log('\n[5] nothing pays inside the refund window; pays after')
    const o5 = await seedDelivered({ eventId: evA.id, vendorId: venA.id, runnerId: connA.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, tipCents: 0, accruedHoursAgo: 0 }) // IN WINDOW
    const before5 = created.length
    const rec5a = await reconcileRunnerPayouts()
    const l5a = await ledgerOf(o5)
    assert(l5a?.status === 'tracked', 'in-window earning NOT paid by reconciler')
    // (we can't assert created delta == 0 globally because rec runs all eligible; assert THIS order unpaid)
    void before5; void rec5a
    // advance past the window
    await prisma.runnerEarning.update({ where: { orderId: o5 }, data: { createdAt: new Date(Date.now() - 5 * 3_600_000) } })
    const before5b = created.length
    await reconcileRunnerPayouts()
    const l5b = await ledgerOf(o5)
    assert(l5b?.status === 'paid', 'after window closes, reconciler pays it')
    assert(created.length === before5b + 1, 'one transfer fired only after the window closed')

    // ── Assertion 7 — refunded-in-window → no transfer fired (no clawback) ──────
    console.log('\n[7] refunded-in-window order → window delay meant no transfer fired (no clawback needed)')
    const o7 = await seedDelivered({ eventId: evA.id, vendorId: venA.id, runnerId: connA.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, tipCents: 200, accruedHoursAgo: 0 }) // IN WINDOW
    // simulate an in-window refund of the order (vendor portion refunded); runner KEEPS (decision #2)
    await prisma.refund.create({ data: { eventId: evA.id, orderId: o7, vendorId: venA.id, amountCents: 1500, status: 'COMPLETED', reason: 'in-window refund' } }).catch(() => {})
    await reconcileRunnerPayouts()
    const l7 = await ledgerOf(o7)
    assert(l7?.status === 'tracked', 'in-window refunded order: runner payout did NOT fire (window covers it; earning intact, no clawback)')

    // ── Assertion 8 — runner%=0 tip-only → transfers the tip ────────────────────
    console.log('\n[8] runner%=0 tip-only → transfers exactly the tip')
    const o8 = await seedDelivered({ eventId: evB.id, vendorId: venB.id, runnerId: connB.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 800, tipCents: 400, accruedHoursAgo: 5 })
    const before8 = created.length
    const r8 = await processRunnerPayout(o8)
    const l8 = await ledgerOf(o8)
    assert(r8.outcome === 'paid', 'outcome = paid')
    assert(created.length === before8 + 1, 'one transfer created')
    assert(created[created.length - 1].amount === 400, `transfer amount = 400¢ (tip only; got ${created[created.length - 1].amount})`)
    assert(l8?.amountCents === 400 && created[created.length - 1].amount === l8?.amountCents, 'tip-only transfer === ledger to the cent')

    // ── Bonus — reconciliation guard halts on ledger drift (no money moves) ─────
    console.log('\n[bonus] ledger drift → PayoutReconciliationError (halt, no transfer)')
    const o9 = await seedDelivered({ eventId: evA.id, vendorId: venA.id, runnerId: connA.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, tipCents: 100, accruedHoursAgo: 5 })
    await prisma.runnerEarning.update({ where: { orderId: o9 }, data: { amountCents: 99999 } }) // corrupt the ledger
    const before9 = created.length
    let halted = false
    try { await processRunnerPayout(o9) } catch (err) { halted = (err as Error).constructor.name === 'PayoutReconciliationError' }
    assert(halted, 'drifted ledger → PayoutReconciliationError thrown')
    assert(created.length === before9, 'NO transfer on ambiguous (drifted) ledger')
  } finally {
    await cleanup()
  }

  console.log('\n══════════════════════════════════════════════════════════════════')
  console.log(`  B2 EXECUTOR TEST — ${pass} passed, ${fail} failed   (real transfers created: ${created.length})`)
  console.log(`  GATES: #2 double-fire inert + #6 amount === ledger — ${fail === 0 ? 'HELD ✅' : 'CHECK ❌'}`)
  console.log('  (cohort deleted — DB back to baseline)')
  console.log('══════════════════════════════════════════════════════════════════\n')

  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('[b2-runner-payout-test] FAILED:', err)
  try { await cleanup() } catch { /* best effort */ }
  await prisma.$disconnect()
  process.exit(2)
})
