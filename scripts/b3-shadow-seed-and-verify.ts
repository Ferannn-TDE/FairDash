/**
 * B3 SHADOW — organizer per-event batch, compute + log only. MOVES NO MONEY.
 *
 * Seeds a multi-order event accruing OrganizerEarning across several deliveries
 * through the REAL accrual path (reconcileMasterStatus → splitRunnerFee), WITH
 * the distractors present — another event's earnings, an already-paid row, an
 * in-window row — and proves planOrganizerPayout picks EXACTLY the right set.
 *
 * The new correctness surface (vs B2): SET MEMBERSHIP. The batch must include
 * exactly the unpaid + window-closed earnings for THIS event and nothing else.
 * Proven non-vacuously: batch total === sum of the included ledger rows to the
 * cent, and the included id set === exactly the expected rows (distractors out).
 *
 * Run:  npx tsx scripts/b3-shadow-seed-and-verify.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.REDIS_URL = '' // DELIVERED side-effect enqueues become inert no-ops

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
})

const SLUG = 'b2seed-'   // shared marker so cleanup catches B2 + B3 seed rows
const MAIL = '@b2seed.local'
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
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
  return prisma.user.create({ data: { clerkId: `${SLUG}clerk-${rand()}`, email: `${SLUG}${role}-${rand()}${MAIL}`, name: `B3 ${role}`, role } })
}
async function mkOrganizer(connected: boolean) {
  return prisma.fairOrganizer.create({
    data: {
      name: `${SLUG}org-${rand()}`, contactEmail: `${SLUG}org-${rand()}${MAIL}`,
      ...(connected ? { stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true, stripeConnectedAt: new Date() } : {}),
    },
  })
}
async function mkEvent(runnerFeePercent: number, organizerId: string) {
  const ev = await prisma.event.create({ data: { name: `B3 ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE', organizerId } })
  await prisma.fulfillmentConfig.create({ data: { eventId: ev.id, homeDeliveryEnabled: true, curbsideEnabled: true, homeDeliveryFee: 10, curbsideFee: 4, runnerFeePercent } })
  return ev
}
async function mkVendor(eventId: string) {
  return prisma.vendor.create({ data: { eventId, name: `V ${rand()}`, slug: `${SLUG}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' } })
}
async function mkRunner(eventId: string) {
  const u = await mkUser('runner')
  return prisma.runner.create({ data: { userId: u.id, eventId, status: 'ACTIVE' } })
}

async function seedDelivered(opts: {
  eventId: string; vendorId: string; runnerId: string
  fulfillmentType: 'HOME_DELIVERY' | 'CURBSIDE'; feeCents: number
  accruedHoursAgo: number; markOrgPaid?: boolean
}): Promise<{ orderId: string; orgEarning: { id: string; amountCents: number } | null }> {
  const customer = await mkUser('customer')
  const order = await prisma.order.create({
    data: {
      eventId: opts.eventId, customerId: customer.id, vendorId: opts.vendorId,
      status: 'READY', fulfillmentType: opts.fulfillmentType,
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: opts.feeCents / 100, tip: 0,
      total: 15 + 1.5 + opts.feeCents / 100, vendorPayout: 15,
      customerName: 'B3', customerPhone: '+10000000000',
      runnerId: opts.runnerId, curbsidePhotoUrl: 'https://b2seed.local/p.jpg',
      stripeChargeId: `ch_${SLUG}${rand()}`,
    },
  })
  await prisma.vendorOrderStatus.create({ data: { orderId: order.id, vendorId: opts.vendorId, status: 'READY' } })

  const { reconcileMasterStatus } = await import('../lib/reconcile-order-status')
  const res = await reconcileMasterStatus(order.id)
  if (!res.wrote || res.to !== 'DELIVERED') throw new Error(`seed: expected DELIVERED, got ${res.to ?? res.reason}`)

  if (opts.accruedHoursAgo > 0) {
    await prisma.organizerEarning.updateMany({ where: { orderId: order.id }, data: { createdAt: new Date(Date.now() - opts.accruedHoursAgo * 3_600_000) } })
  }
  if (opts.markOrgPaid) {
    await prisma.organizerEarning.updateMany({ where: { orderId: order.id }, data: { status: 'paid' } })
  }
  const orgEarning = await prisma.organizerEarning.findUnique({ where: { orderId: order.id }, select: { id: true, amountCents: true } })
  return { orderId: order.id, orgEarning }
}

async function main() {
  await cleanup()

  try {
    const { planOrganizerPayout } = await import('../lib/organizer-payout')

    // ── Event A — the target: 3 payable + 2 distractors (paid, in-window) ──────
    const orgA = await mkOrganizer(true)
    const evA = await mkEvent(50, orgA.id)
    const venA = await mkVendor(evA.id)
    const runA = await mkRunner(evA.id)
    const a1 = await seedDelivered({ eventId: evA.id, vendorId: venA.id, runnerId: runA.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, accruedHoursAgo: 5 })                 // org 500
    const a2 = await seedDelivered({ eventId: evA.id, vendorId: venA.id, runnerId: runA.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 600,  accruedHoursAgo: 5 })                 // org 300
    const a3 = await seedDelivered({ eventId: evA.id, vendorId: venA.id, runnerId: runA.id, fulfillmentType: 'CURBSIDE',      feeCents: 400,  accruedHoursAgo: 5 })                 // org 200
    const a4 = await seedDelivered({ eventId: evA.id, vendorId: venA.id, runnerId: runA.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, accruedHoursAgo: 5, markOrgPaid: true }) // org 500 — ALREADY PAID (distractor)
    const a5 = await seedDelivered({ eventId: evA.id, vendorId: venA.id, runnerId: runA.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 800,  accruedHoursAgo: 0 })                 // org 400 — IN-WINDOW (distractor)

    // ── Event B — distractor: another event's earnings must NOT be included ────
    const orgB = await mkOrganizer(true)
    const evB = await mkEvent(50, orgB.id)
    const venB = await mkVendor(evB.id)
    const runB = await mkRunner(evB.id)
    const b1 = await seedDelivered({ eventId: evB.id, vendorId: venB.id, runnerId: runB.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, accruedHoursAgo: 5 })                 // org 500 — other event

    // ── Event C — unconnected organizer → would-hold ───────────────────────────
    const orgC = await mkOrganizer(false)
    const evC = await mkEvent(50, orgC.id)
    const venC = await mkVendor(evC.id)
    const runC = await mkRunner(evC.id)
    await seedDelivered({ eventId: evC.id, vendorId: venC.id, runnerId: runC.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, accruedHoursAgo: 5 })                            // org 500

    // ── Event D — all earnings already paid → nothing ──────────────────────────
    const orgD = await mkOrganizer(true)
    const evD = await mkEvent(50, orgD.id)
    const venD = await mkVendor(evD.id)
    const runD = await mkRunner(evD.id)
    await seedDelivered({ eventId: evD.id, vendorId: venD.id, runnerId: runD.id, fulfillmentType: 'HOME_DELIVERY', feeCents: 1000, accruedHoursAgo: 5, markOrgPaid: true })

    // ── PROVE: Event A set membership + total ───────────────────────────────────
    console.log('\n[A] target event — batch = exactly {a1,a2,a3}; distractors (paid a4, in-window a5, other-event b1) excluded')
    const planA = await planOrganizerPayout(evA.id)
    const expectedIds = [a1.orgEarning!.id, a2.orgEarning!.id, a3.orgEarning!.id].sort()
    const gotIds = [...planA.includedEarningIds].sort()
    const dbSum = a1.orgEarning!.amountCents + a2.orgEarning!.amountCents + a3.orgEarning!.amountCents

    assert(planA.outcome === 'pay', 'outcome = pay (connected organizer, unpaid set present)')
    assert(planA.includedCount === 3, `included count = 3 (got ${planA.includedCount})`)
    assert(planA.batchTotalCents === 1000, `batch total = $10.00 hand-computed (got ${fmt(planA.batchTotalCents)})`)
    assert(planA.batchTotalCents === dbSum, `batch total === DB sum of included rows (${fmt(dbSum)}) — three-way agreement`)
    assert(JSON.stringify(gotIds) === JSON.stringify(expectedIds), 'included id set === exactly {a1,a2,a3}')
    assert(!planA.includedEarningIds.includes(a4.orgEarning!.id), 'already-paid a4 EXCLUDED')
    assert(!planA.includedEarningIds.includes(a5.orgEarning!.id), 'in-window a5 EXCLUDED')
    assert(!planA.includedEarningIds.includes(b1.orgEarning!.id), "other-event b1 EXCLUDED (set is per-event)")
    assert(!!planA.destinationAccountId, 'destination resolved via event.organizer.stripeAccountId')

    // ── PROVE: unconnected → hold ────────────────────────────────────────────────
    console.log('\n[C] unconnected organizer → would-hold (total computed, held)')
    const planC = await planOrganizerPayout(evC.id)
    assert(planC.outcome === 'hold' && planC.holdReason === 'unconnected', 'outcome = hold (unconnected)')
    assert(planC.includedCount === 1 && planC.batchTotalCents === 500, `held batch = $5.00 / 1 row (got ${fmt(planC.batchTotalCents)}/${planC.includedCount})`)
    assert(planC.destinationAccountId === null, 'no destination (organizer not connected)')

    // ── PROVE: all-paid → nothing ────────────────────────────────────────────────
    console.log('\n[D] all earnings already paid → nothing to pay')
    const planD = await planOrganizerPayout(evD.id)
    assert(planD.outcome === 'nothing', 'outcome = nothing')
    assert(planD.includedCount === 0 && planD.batchTotalCents === 0, 'empty batch (already-paid rows drained out)')

    // ── PROVE: Event B sees its own set (isolation both directions) ─────────────
    console.log('\n[B] distractor event sees ONLY its own earning (isolation holds both ways)')
    const planB = await planOrganizerPayout(evB.id)
    assert(planB.includedCount === 1 && planB.includedEarningIds[0] === b1.orgEarning!.id, "Event B batch = exactly {b1}, not Event A's rows")
    assert(planB.batchTotalCents === 500, `Event B total = $5.00 (got ${fmt(planB.batchTotalCents)})`)
  } finally {
    await cleanup()
  }

  console.log('\n══════════════════════════════════════════════════════════════════════════════════')
  console.log(`  B3 SHADOW — organizer per-event batch (NO MONEY MOVED) — ${pass} passed, ${fail} failed`)
  if (fail === 0) {
    console.log('  VERDICT: ✅ NON-VACUOUS SHADOW CLEAN — batch total === ledger set sum to the cent;')
    console.log('           SET MEMBERSHIP correct (paid / in-window / other-event distractors all excluded);')
    console.log('           connected→pay, unconnected→hold, all-paid→nothing; three-way agreement holds.')
  } else {
    console.log('  VERDICT: ⛔ DIVERGENCE — STOP. Do NOT build the executor until resolved.')
  }
  console.log('  (cohort deleted — DB back to baseline)')
  console.log('══════════════════════════════════════════════════════════════════════════════════\n')

  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('[b3-shadow-seed-and-verify] FAILED:', err)
  try { await cleanup() } catch { /* best effort */ }
  await prisma.$disconnect()
  process.exit(2)
})
