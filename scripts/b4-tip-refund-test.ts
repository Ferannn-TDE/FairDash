/**
 * B4 — tip-refund EXECUTOR integration test. Stripe test mode, stripe.refunds.create
 * SPIED (intercept + simulate idempotency). Isolated, self-cleaning; the runner-
 * earned distractor seeded through the REAL accrual path.
 *
 * Gates: the runner-earned tip is NEVER refunded (re-checked at execute) + double-
 * fire inert incl. crash-recovery (marker lost → idempotency key returns original).
 *
 * Run:  npx tsx scripts/b4-tip-refund-test.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''


const prisma = testPrisma()

const SLUG = 'b2seed-'
const MAIL = '@b2seed.local'
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

interface FakeRefund { id: string; amount: number; key?: string }
const created: FakeRefund[] = []
const byKey = new Map<string, FakeRefund>()
/** Orders the spy must FAIL for — lets the failure-marker control force a deterministic throw. */
const throwForOrders = new Set<string>()

async function installStripeSpy() {
  const { stripe } = await import('../lib/stripe')
  void stripe.refunds
  ;(stripe.refunds as unknown as Record<string, unknown>).create = async (params: any, opts: any) => {
    // Shaped like a real Stripe failure (type/code), not a bare Error — the marker path should
    // be exercised by something that looks like what production would actually throw.
    if (params?.metadata?.orderId && throwForOrders.has(params.metadata.orderId)) {
      throw Object.assign(new Error('No such charge: ch_dead'), {
        type: 'StripeInvalidRequestError', rawType: 'invalid_request_error',
        code: 'resource_missing', statusCode: 400, param: 'charge',
      })
    }
    const key = opts?.idempotencyKey as string | undefined
    if (key && byKey.has(key)) return byKey.get(key)!
    const r: FakeRefund = { id: `re_${rand()}`, amount: params.amount, key }
    if (key) byKey.set(key, r)
    created.push(r)
    return r
  }
}

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    await prisma.adminMoneyAction.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function mkUser(role: string) { return prisma.user.create({ data: { clerkId: `${SLUG}clerk-${rand()}`, email: `${SLUG}${role}-${rand()}${MAIL}`, name: `B4 ${role}`, role } }) }
async function mkEvent() {
  const ev = await prisma.event.create({ data: { name: `B4 ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE' } })
  await prisma.fulfillmentConfig.create({ data: { eventId: ev.id, homeDeliveryEnabled: true, homeDeliveryFee: 10, runnerFeePercent: 50 } })
  return ev
}
async function mkVendor(eventId: string) { return prisma.vendor.create({ data: { eventId, name: `V ${rand()}`, slug: `${SLUG}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' } }) }
async function mkRunner(eventId: string) { const u = await mkUser('runner'); return prisma.runner.create({ data: { userId: u.id, eventId, status: 'ACTIVE' } }) }

async function seedCancelledTipped(eventId: string, vendorId: string, tipCents: number, opts?: { noCharge?: boolean }) {
  const customer = await mkUser('customer')
  return prisma.order.create({
    data: {
      eventId, customerId: customer.id, vendorId, status: 'CANCELLED', fulfillmentType: 'HOME_DELIVERY',
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: 10, tip: tipCents / 100, total: 15 + 1.5 + 10 + tipCents / 100, vendorPayout: 15,
      customerName: 'B4', customerPhone: '+10000000000', cancelledAt: new Date(), cancelledBy: 'customer',
      ...(opts?.noCharge ? {} : { stripeChargeId: `ch_${SLUG}${rand()}` }),
    },
  })
}
async function seedDeliveredTipped(eventId: string, vendorId: string, runnerId: string, tipCents: number) {
  const customer = await mkUser('customer')
  const order = await prisma.order.create({
    data: {
      eventId, customerId: customer.id, vendorId, status: 'READY', fulfillmentType: 'HOME_DELIVERY',
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: 10, tip: tipCents / 100, total: 15 + 1.5 + 10 + tipCents / 100, vendorPayout: 15,
      customerName: 'B4', customerPhone: '+10000000000', runnerId, deliveryProofPath: 'https://b2seed.local/p.jpg', stripeChargeId: `ch_${SLUG}${rand()}`,
    },
  })
  await prisma.vendorOrderStatus.create({ data: { orderId: order.id, vendorId, status: 'READY' } })
  const { reconcileMasterStatus } = await import('../lib/reconcile-order-status')
  const res = await reconcileMasterStatus(order.id)
  if (!res.wrote || res.to !== 'DELIVERED') throw new Error(`seed delivered: expected DELIVERED, got ${res.to ?? res.reason}`)
  return order
}

async function main() {
  await cleanup()
  await installStripeSpy()
  try {
    const { processTipRefund, reconcileTipRefunds } = await import('../lib/tip-refund')
    const ev = await mkEvent(); const ven = await mkVendor(ev.id); const run = await mkRunner(ev.id)

    // ── GATE — runner-earned tip → executor leaves it alone (no refund) ─────────
    console.log('\n[GATE] DELIVERED + real RunnerEarning tip → executor does NOT refund')
    const runnerTip = await seedDeliveredTipped(ev.id, ven.id, run.id, 500)
    const beforeGate = created.length
    const rGate = await processTipRefund(runnerTip.id)
    const re = await prisma.runnerEarning.findUnique({ where: { orderId: runnerTip.id }, select: { amountCents: true } })
    assert(re != null, `distractor genuinely accrued a RunnerEarning (${fmt(re?.amountCents ?? 0)})`)
    assert(rGate.outcome === 'excluded_runner_earned', 'outcome = excluded_runner_earned')
    assert(created.length === beforeGate, 'NO refund created for a runner-earned tip (the policy boundary holds at execute)')

    // ── 1 + amount — owed-back refunds exactly tipCents ─────────────────────────
    console.log('\n[1/amount] owed-back → refunds exactly tipCents, marker + key set')
    const owed = await seedCancelledTipped(ev.id, ven.id, 300)
    const before1 = created.length
    const r1 = await processTipRefund(owed.id)
    const owed1 = await prisma.order.findUniqueOrThrow({ where: { id: owed.id }, select: { tip: true, tipRefundId: true, tipRefundedAt: true } })
    assert(r1.outcome === 'refunded', 'outcome = refunded')
    assert(created.length === before1 + 1, 'exactly one refund created')
    assert(created[created.length - 1].amount === 300, `refund amount = $3.00 (got ${fmt(created[created.length - 1].amount)})`)
    assert(created[created.length - 1].amount === Math.round((owed1.tip ?? 0) * 100), 'refund === order tipCents to the cent')
    assert(!!owed1.tipRefundId && !!owed1.tipRefundedAt, 'tipRefundId + tipRefundedAt recorded on the order')
    assert(byKey.has(`tip_refund_${owed.id}`), `idempotencyKey tip_refund_${owed.id} used`)

    // ── 2 (GATE) — double-fire inert ────────────────────────────────────────────
    console.log('\n[2] GATE: double-fire refunds nothing')
    const before2a = created.length
    const r2a = await processTipRefund(owed.id)
    assert(r2a.outcome === 'already_refunded' && created.length === before2a, '(a) re-run → already_refunded, NO new refund (marker short-circuit)')
    // (b) crash recovery: marker write lost — tipRefundId back to null, re-fire
    await prisma.order.update({ where: { id: owed.id }, data: { tipRefundId: null, tipRefundedAt: null } })
    const before2b = created.length
    const r2b = await processTipRefund(owed.id)
    assert(created.length === before2b, '(b) crash-recovery: idempotency key returns original refund, NO 2nd refund')
    assert(r2b.outcome === 'refunded' && r2b.refundId === byKey.get(`tip_refund_${owed.id}`)!.id, '(b) returns the SAME refund id')
    const owed1b = await prisma.order.findUniqueOrThrow({ where: { id: owed.id }, select: { tipRefundId: true } })
    assert(!!owed1b.tipRefundId, '(b) marker re-recorded')

    // ── no-tip → nothing ────────────────────────────────────────────────────────
    console.log('\n[no-tip] cancelled, no tip → nothing')
    const noTip = await seedCancelledTipped(ev.id, ven.id, 0)
    const beforeN = created.length
    const rN = await processTipRefund(noTip.id)
    assert(rN.outcome === 'no_tip' && created.length === beforeN, 'outcome = no_tip, no refund')

    // ── halt-on-ambiguity — no charge → alert, don't refund ─────────────────────
    console.log('\n[halt] owed-back but NO resolvable charge → no_charge (alert, no refund)')
    const noCharge = await seedCancelledTipped(ev.id, ven.id, 300, { noCharge: true })
    const beforeH = created.length
    const rH = await processTipRefund(noCharge.id)
    assert(rH.outcome === 'no_charge' && created.length === beforeH, 'outcome = no_charge, NO refund on ambiguity')

    // ── reconciler end-to-end (Pattern R path) — refunds owed, excludes earned ──
    console.log('\n[reconciler] reconcileTipRefunds refunds owed-back, excludes runner-earned')
    const owed2 = await seedCancelledTipped(ev.id, ven.id, 250)
    const beforeRec = created.length
    const recSummary = await reconcileTipRefunds()
    const owed2row = await prisma.order.findUniqueOrThrow({ where: { id: owed2.id }, select: { tipRefundId: true } })
    const runnerRow = await prisma.order.findUniqueOrThrow({ where: { id: runnerTip.id }, select: { tipRefundId: true } })
    assert(!!owed2row.tipRefundId, 'reconciler refunded the new owed-back tip')
    assert(runnerRow.tipRefundId === null, 'reconciler left the runner-earned tip untouched (never refunded)')
    assert(created.length >= beforeRec + 1, `reconciler created the owed-back refund (refunded=${recSummary.refunded})`)

    // ── [marker] a FAILED tip refund leaves a durable row — the write half ───────
    // Before this, a failure wrote NOTHING: tipRefundId stayed null, the order stayed in the
    // candidate set, and "never attempted" was indistinguishable from "failed 400 times".
    // Everything below is scoped to THIS order — never a table-wide count, which is how the
    // X2 suite went flaky.
    console.log('\n[marker] a failed tip refund writes a durable TIP_REFUND_FAILED audit row')
    const doomed = await seedCancelledTipped(ev.id, ven.id, 400)
    throwForOrders.add(doomed.id)
    const beforeFail = created.length
    const failSummary = await reconcileTipRefunds()
    throwForOrders.delete(doomed.id)

    const marker = await prisma.adminMoneyAction.findFirst({
      where: { orderId: doomed.id, action: 'TIP_REFUND_FAILED' },
      select: { payeeType: true, payeeId: true, amountCents: true, actorType: true, actorId: true, reason: true, eventId: true },
    })
    assert(created.length === beforeFail, 'no refund was created for the doomed order (the throw really happened)')
    assert(failSummary.alerts.some(a => a.includes(doomed.id)), 'the existing alert string is KEPT — this is additive')
    assert(marker != null, 'a durable audit row exists for the failed tip refund')
    assert(marker?.payeeType === 'customer', `payeeType is 'customer' (got ${marker?.payeeType}) — the tip goes back to the payer`)
    assert(marker?.amountCents === 400, `the row carries the owed amount (got ${marker?.amountCents})`)
    assert(marker?.actorType === 'reconciler' && marker?.actorId === 'reconciler:tip-refund', 'honest actor — the reconciler, not an admin')
    assert(marker?.eventId === ev.id, 'scoped to the right fair')
    assert(/resource_missing|No such charge/.test(marker?.reason ?? ''), 'the reason carries the underlying Stripe failure')

    // tipRefundId MUST stay null: it is the SUCCESS record, and a sentinel there would drop the
    // order out of the candidate query — a failed refund would silently stop being retried.
    const doomedRow = await prisma.order.findUniqueOrThrow({ where: { id: doomed.id }, select: { tipRefundId: true } })
    assert(doomedRow.tipRefundId === null, 'tipRefundId is STILL null — not repurposed, so the order stays retryable')

    // NEGATIVE HALF: a SUCCESSFUL refund must write no marker. Without this, a writer that
    // marked unconditionally would pass every assertion above.
    const successMarker = await prisma.adminMoneyAction.count({
      where: { orderId: owed2.id, action: 'TIP_REFUND_FAILED' },
    })
    assert(successMarker === 0, 'the SUCCESSFUL tip refund wrote NO failure marker (the row means failure, not activity)')
  } finally {
    await cleanup()
  }

  console.log('\n══════════════════════════════════════════════════════════════════')
  console.log(`  B4 TIP-REFUND EXECUTOR TEST — ${pass} passed, ${fail} failed   (real refunds: ${created.length})`)
  console.log(`  GATES: runner-earned tip NEVER refunded + double-fire inert (incl. crash-recovery) — ${fail === 0 ? 'HELD ✅' : 'CHECK ❌'}`)
  console.log('  (cohort deleted — DB back to baseline)')
  console.log('══════════════════════════════════════════════════════════════════\n')

  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('[b4-tip-refund-test] FAILED:', err)
  try { await cleanup() } catch { /* best effort */ }
  await prisma.$disconnect()
  process.exit(2)
})
