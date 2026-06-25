/**
 * B4 SHADOW — tip-refund execution, compute + log only. MOVES NO MONEY.
 *
 * Proves the POLICY BOUNDARY non-vacuously: a tip is owed back to the customer
 * ONLY when no runner earned it. Seeds, side by side:
 *   - owed-back: a CANCELLED tipped order with NO RunnerEarning → would-refund = tipCents
 *   - DISTRACTOR (the gate): a DELIVERED tipped order WITH a real RunnerEarning
 *     (accrued through the real path) → EXCLUDED, never refunded (the tip is the runner's)
 *   - already-tip-refunded → skip
 *   - cancelled, no tip → nothing
 *
 * Proven: owed-back === the order's tipCents to the cent; the runner-earned tip is
 * EXCLUDED entirely. Refunding a tip a runner earned is the dangerous inverse of a
 * double-pay; this proves the partition holds before any refund code exists.
 *
 * Run:  npx tsx scripts/b4-shadow-seed-and-verify.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })

const SLUG = 'b2seed-'
const MAIL = '@b2seed.local'
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function mkUser(role: string) {
  return prisma.user.create({ data: { clerkId: `${SLUG}clerk-${rand()}`, email: `${SLUG}${role}-${rand()}${MAIL}`, name: `B4 ${role}`, role } })
}
async function mkEvent() {
  const ev = await prisma.event.create({ data: { name: `B4 ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE' } })
  await prisma.fulfillmentConfig.create({ data: { eventId: ev.id, homeDeliveryEnabled: true, homeDeliveryFee: 10, runnerFeePercent: 50 } })
  return ev
}
async function mkVendor(eventId: string) { return prisma.vendor.create({ data: { eventId, name: `V ${rand()}`, slug: `${SLUG}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' } }) }
async function mkRunner(eventId: string) { const u = await mkUser('runner'); return prisma.runner.create({ data: { userId: u.id, eventId, status: 'ACTIVE' } }) }

// A CANCELLED runner-fulfilled order, tipped, that NO runner ever earned (cancelled
// pre-delivery → no accrual ran). The tip is the customer-paid order field — a given
// input, not a derived value — so creating the cancelled state directly is faithful.
async function seedCancelledTipped(eventId: string, vendorId: string, tipCents: number, opts?: { alreadyRefunded?: boolean }) {
  const customer = await mkUser('customer')
  return prisma.order.create({
    data: {
      eventId, customerId: customer.id, vendorId, status: 'CANCELLED', fulfillmentType: 'HOME_DELIVERY',
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: 10, tip: tipCents / 100, total: 15 + 1.5 + 10 + tipCents / 100, vendorPayout: 15,
      customerName: 'B4', customerPhone: '+10000000000', cancelledAt: new Date(), cancelledBy: 'customer',
      stripeChargeId: `ch_${SLUG}${rand()}`,
      ...(opts?.alreadyRefunded ? { tipRefundId: `re_${SLUG}${rand()}`, tipRefundedAt: new Date() } : {}),
    },
  })
}

// A DELIVERED tipped order driven through the REAL accrual path → a genuine
// RunnerEarning exists carrying the tip. This is the policy-boundary distractor.
async function seedDeliveredTipped(eventId: string, vendorId: string, runnerId: string, tipCents: number) {
  const customer = await mkUser('customer')
  const order = await prisma.order.create({
    data: {
      eventId, customerId: customer.id, vendorId, status: 'READY', fulfillmentType: 'HOME_DELIVERY',
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: 10, tip: tipCents / 100, total: 15 + 1.5 + 10 + tipCents / 100, vendorPayout: 15,
      customerName: 'B4', customerPhone: '+10000000000', runnerId, curbsidePhotoUrl: 'https://b2seed.local/p.jpg', stripeChargeId: `ch_${SLUG}${rand()}`,
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
  try {
    const { planTipRefund } = await import('../lib/tip-refund')
    const ev = await mkEvent()
    const ven = await mkVendor(ev.id)
    const run = await mkRunner(ev.id)

    const owedBack   = await seedCancelledTipped(ev.id, ven.id, 300)                       // → refund 300
    const runnerTip  = await seedDeliveredTipped(ev.id, ven.id, run.id, 500)               // → excluded (runner earned it)
    const refunded   = await seedCancelledTipped(ev.id, ven.id, 300, { alreadyRefunded: true }) // → already_refunded
    const noTip      = await seedCancelledTipped(ev.id, ven.id, 0)                          // → no_tip

    // sanity: the distractor genuinely has a RunnerEarning carrying the tip
    const re = await prisma.runnerEarning.findUnique({ where: { orderId: runnerTip.id }, select: { amountCents: true } })

    console.log('\n[1] owed-back: cancelled + tipped + NO runner earning → would-refund === tipCents')
    const p1 = await planTipRefund(owedBack.id)
    assert(p1.outcome === 'refund', 'outcome = refund')
    assert(p1.owedBackCents === 300, `owed-back = $3.00 (got ${fmt(p1.owedBackCents)})`)
    assert(p1.owedBackCents === Math.round((owedBack.tip ?? 0) * 100), 'owed-back === the order tipCents to the cent')
    assert(!p1.hasRunnerEarning, 'no runner earning (tip belongs to no one)')

    console.log('\n[GATE] runner-earned tip → EXCLUDED, never refunded to the customer')
    const p2 = await planTipRefund(runnerTip.id)
    assert(re != null, `distractor genuinely accrued a RunnerEarning (${fmt(re?.amountCents ?? 0)} incl. tip)`)
    assert(p2.outcome === 'excluded_runner_earned', 'outcome = excluded_runner_earned (the tip is the runner\'s)')
    assert(p2.owedBackCents === 0, 'owed-back = $0.00 — the runner-earned tip is NEVER clawed back')
    assert(p2.hasRunnerEarning, 'hasRunnerEarning = true (the discriminator)')

    console.log('\n[3] already-tip-refunded → skip (idempotency)')
    const p3 = await planTipRefund(refunded.id)
    assert(p3.outcome === 'already_refunded', 'outcome = already_refunded')
    assert(p3.owedBackCents === 0, 'no second refund would fire')

    console.log('\n[4] cancelled, no tip → nothing')
    const p4 = await planTipRefund(noTip.id)
    assert(p4.outcome === 'no_tip' && p4.owedBackCents === 0, 'outcome = no_tip, nothing owed')

    console.log('\n[totals] only the owed-back order contributes to the refund total')
    const totalOwed = [p1, p2, p3, p4].reduce((s, p) => s + p.owedBackCents, 0)
    assert(totalOwed === 300, `total would-refund = $3.00 (only the owed-back order; got ${fmt(totalOwed)})`)
  } finally {
    await cleanup()
  }

  console.log('\n══════════════════════════════════════════════════════════════════════════════════')
  console.log(`  B4 SHADOW — tip-refund execution (NO MONEY MOVED) — ${pass} passed, ${fail} failed`)
  if (fail === 0) {
    console.log('  VERDICT: ✅ NON-VACUOUS SHADOW CLEAN — owed-back === the order tipCents to the cent;')
    console.log('           POLICY BOUNDARY holds: the runner-earned tip is EXCLUDED entirely (never refunded);')
    console.log('           already-refunded skipped; no-tip nothing.')
  } else {
    console.log('  VERDICT: ⛔ DIVERGENCE — STOP. Do NOT build the executor until resolved.')
  }
  console.log('  (cohort deleted — DB back to baseline)')
  console.log('══════════════════════════════════════════════════════════════════════════════════\n')

  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('[b4-shadow-seed-and-verify] FAILED:', err)
  try { await cleanup() } catch { /* best effort */ }
  await prisma.$disconnect()
  process.exit(2)
})
