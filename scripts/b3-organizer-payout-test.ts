/**
 * B3 STEP — organizer per-event BATCH executor integration test. Stripe test mode,
 * stripe.transfers.create SPIED (intercept + simulate idempotency). Isolated,
 * self-cleaning; seeds through the REAL accrual path.
 *
 * Gates: double-fire inert (batch-adapted, incl. crash-recovery) + batch total ===
 * ledger set sum. Plus the batch-specific PARTIAL-PAY guard (a 2nd batch pays only
 * the unpaid remainder, never re-pays a prior batch's rows).
 *
 * Run:  npx tsx scripts/b3-organizer-payout-test.ts
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

interface FakeTransfer { id: string; amount: number; key?: string }
const created: FakeTransfer[] = []
const byKey = new Map<string, FakeTransfer>()
async function installStripeSpy() {
  const { stripe } = await import('../lib/stripe')
  void stripe.transfers
  ;(stripe.transfers as unknown as Record<string, unknown>).create = async (params: any, opts: any) => {
    const key = opts?.idempotencyKey as string | undefined
    if (key && byKey.has(key)) return byKey.get(key)!
    const t: FakeTransfer = { id: `tr_${rand()}`, amount: params.amount, key }
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
    await prisma.event.deleteMany({ where: { id: { in: ids } } }) // cascades OrganizerPayout
  }
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function mkUser(role: string) {
  return prisma.user.create({ data: { clerkId: `${SLUG}clerk-${rand()}`, email: `${SLUG}${role}-${rand()}${MAIL}`, name: `B3 ${role}`, role } })
}
async function mkOrganizer(connected: boolean) {
  return prisma.fairOrganizer.create({ data: { name: `${SLUG}org-${rand()}`, contactEmail: `${SLUG}org-${rand()}${MAIL}`, ...(connected ? { stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true, stripeConnectedAt: new Date() } : {}) } })
}
async function mkEvent(organizerId: string) {
  const ev = await prisma.event.create({ data: { name: `B3 ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE', organizerId } })
  await prisma.fulfillmentConfig.create({ data: { eventId: ev.id, homeDeliveryEnabled: true, homeDeliveryFee: 10, runnerFeePercent: 50 } })
  return ev
}
async function mkVendor(eventId: string) { return prisma.vendor.create({ data: { eventId, name: `V ${rand()}`, slug: `${SLUG}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' } }) }
async function mkRunner(eventId: string) { const u = await mkUser('runner'); return prisma.runner.create({ data: { userId: u.id, eventId, status: 'ACTIVE' } }) }

// fee → org share is 50% (runnerFeePercent=50). seed fee so org share = wanted.
async function seedDelivered(eventId: string, vendorId: string, runnerId: string, orgShareCents: number, accruedHoursAgo: number) {
  const feeCents = orgShareCents * 2 // 50% split → org gets half
  const customer = await mkUser('customer')
  const order = await prisma.order.create({
    data: {
      eventId, customerId: customer.id, vendorId, status: 'READY', fulfillmentType: 'HOME_DELIVERY',
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: feeCents / 100, tip: 0, total: 15 + 1.5 + feeCents / 100, vendorPayout: 15,
      customerName: 'B3', customerPhone: '+10000000000', runnerId, deliveryProofPath: 'https://b2seed.local/p.jpg', stripeChargeId: `ch_${SLUG}${rand()}`,
    },
  })
  await prisma.vendorOrderStatus.create({ data: { orderId: order.id, vendorId, status: 'READY' } })
  const { reconcileMasterStatus } = await import('../lib/reconcile-order-status')
  const res = await reconcileMasterStatus(order.id)
  if (!res.wrote || res.to !== 'DELIVERED') throw new Error(`seed: expected DELIVERED, got ${res.to ?? res.reason}`)
  if (accruedHoursAgo > 0) await prisma.organizerEarning.updateMany({ where: { orderId: order.id }, data: { createdAt: new Date(Date.now() - accruedHoursAgo * 3_600_000) } })
  const oe = await prisma.organizerEarning.findUnique({ where: { orderId: order.id }, select: { id: true, amountCents: true } })
  return oe!
}

async function main() {
  await cleanup()
  await installStripeSpy()
  try {
    const { processEventOrganizerPayout, reconcileOrganizerPayouts } = await import('../lib/organizer-payout')

    // ════ Event A — set membership + amount + double-fire (1,2,4,8) ════
    console.log('\n[1/4/8] connected event with distractors → batch = exactly the unpaid set, amount === ledger sum')
    const orgA = await mkOrganizer(true); const evA = await mkEvent(orgA.id); const venA = await mkVendor(evA.id); const runA = await mkRunner(evA.id)
    const a1 = await seedDelivered(evA.id, venA.id, runA.id, 500, 5)
    const a2 = await seedDelivered(evA.id, venA.id, runA.id, 300, 5)
    const a3 = await seedDelivered(evA.id, venA.id, runA.id, 200, 5)
    const a4 = await seedDelivered(evA.id, venA.id, runA.id, 500, 5); await prisma.organizerEarning.update({ where: { id: a4.id }, data: { status: 'paid' } }) // already paid distractor
    const a5 = await seedDelivered(evA.id, venA.id, runA.id, 400, 0) // in-window distractor
    const b1org = await (async () => { const orgB = await mkOrganizer(true); const evB = await mkEvent(orgB.id); const v = await mkVendor(evB.id); const r = await mkRunner(evB.id); return seedDelivered(evB.id, v.id, r.id, 500, 5) })() // other event

    const before1 = created.length
    const r1 = await processEventOrganizerPayout(evA.id)
    const batchA = await prisma.organizerPayout.findFirstOrThrow({ where: { eventId: evA.id } })
    const coveredA = await prisma.organizerEarning.findMany({ where: { batchId: batchA.id }, select: { id: true } })
    const coveredIds = coveredA.map(c => c.id).sort()
    assert(r1.outcome === 'paid', 'outcome = paid')
    assert(created.length === before1 + 1, 'exactly one transfer created')
    assert(created[created.length - 1].amount === 1000, `transfer amount = $10.00 (got ${fmt(created[created.length - 1].amount)})`)
    assert(r1.totalCents === 1000 && batchA.totalCents === 1000, 'batch total = $10.00 (set sum)')
    assert(JSON.stringify(coveredIds) === JSON.stringify([a1.id, a2.id, a3.id].sort()), '[4] batch covers EXACTLY {a1,a2,a3}')
    assert(!coveredIds.includes(a4.id) && !coveredIds.includes(a5.id) && !coveredIds.includes(b1org.id), '[4] paid/in-window/other-event distractors excluded from batch')
    const a5after = await prisma.organizerEarning.findUnique({ where: { id: a5.id }, select: { status: true } })
    assert(a5after?.status === 'accrued', '[8] in-window a5 still accrued (not paid)')

    // ── Assertion 2 (GATE) — double-fire inert ──────────────────────────────────
    console.log('\n[2] GATE: double-fire transfers nothing')
    const before2a = created.length
    const r2a = await processEventOrganizerPayout(evA.id)
    assert(r2a.outcome === 'nothing' && created.length === before2a, '(a) re-run → nothing (paid rows excluded), NO new transfer')
    // (b) crash recovery: finalize lost — batch back to pending, earnings back to accrued (batchId kept)
    await prisma.organizerPayout.update({ where: { id: batchA.id }, data: { status: 'pending', stripeTransferId: null, paidAt: null } })
    await prisma.organizerEarning.updateMany({ where: { batchId: batchA.id }, data: { status: 'accrued', paidAt: null } })
    const before2b = created.length
    const r2b = await processEventOrganizerPayout(evA.id)
    assert(created.length === before2b, '(b) crash-recovery: reused pending batch, idempotency key → original transfer, NO 2nd transfer')
    assert(r2b.outcome === 'paid' && r2b.transferId === r1.transferId, '(b) returns the SAME transfer id')
    const batchAfin = await prisma.organizerPayout.findUniqueOrThrow({ where: { id: batchA.id } })
    assert(batchAfin.status === 'paid', '(b) batch re-finalized to paid')

    // ── Assertion 3 — PARTIAL-PAY: 2nd batch pays only the unpaid remainder ─────
    console.log('\n[3] partial-pay: a 2nd batch pays ONLY newly-accrued rows, never re-pays the first batch')
    const orgE = await mkOrganizer(true); const evE = await mkEvent(orgE.id); const venE = await mkVendor(evE.id); const runE = await mkRunner(evE.id)
    const e1 = await seedDelivered(evE.id, venE.id, runE.id, 500, 5)
    const e2 = await seedDelivered(evE.id, venE.id, runE.id, 300, 5)
    const rE1 = await processEventOrganizerPayout(evE.id)        // batch1 pays {e1,e2}=800
    const e3 = await seedDelivered(evE.id, venE.id, runE.id, 200, 5) // accrued AFTER batch1
    const e4 = await seedDelivered(evE.id, venE.id, runE.id, 100, 5)
    const beforeE2 = created.length
    const rE2 = await processEventOrganizerPayout(evE.id)        // batch2 pays {e3,e4}=300
    assert(rE1.totalCents === 800 && rE2.totalCents === 300, `batch1 $8.00, batch2 $3.00 (got ${fmt(rE1.totalCents!)}, ${fmt(rE2.totalCents!)})`)
    assert(created.length === beforeE2 + 1 && created[created.length - 1].amount === 300, 'batch2 transferred exactly the $3.00 remainder')
    const batches = await prisma.organizerPayout.findMany({ where: { eventId: evE.id }, orderBy: { createdAt: 'asc' } })
    assert(batches.length === 2 && batches[0].id !== batches[1].id, 'two distinct batches for the event')
    const e1row = await prisma.organizerEarning.findUniqueOrThrow({ where: { id: e1.id } })
    const e3row = await prisma.organizerEarning.findUniqueOrThrow({ where: { id: e3.id } })
    assert(e1row.batchId === batches[0].id && e3row.batchId === batches[1].id, 'e1 stays on batch1; e3 on batch2 (no row re-paid across batches)')
    void e2; void e4

    // ── Assertion 5/6 — unconnected → held; then connects → reconciler pays ─────
    console.log('\n[5/6] unconnected organizer → held; then connects → reconciler batches + pays')
    const orgC = await mkOrganizer(false); const evC = await mkEvent(orgC.id); const venC = await mkVendor(evC.id); const runC = await mkRunner(evC.id)
    const c1 = await seedDelivered(evC.id, venC.id, runC.id, 500, 5)
    const rC = await processEventOrganizerPayout(evC.id)
    const c1held = await prisma.organizerEarning.findUniqueOrThrow({ where: { id: c1.id } })
    const batchCheld = await prisma.organizerPayout.findFirst({ where: { eventId: evC.id } })
    assert(rC.outcome === 'held', '[5] outcome = held (unconnected)')
    assert(c1held.status === 'accrued' && c1held.batchId === null, '[5] earning stays accrued, no batch (ledger row is the hold)')
    assert(batchCheld === null, '[5] no batch created for unconnected organizer')
    await prisma.fairOrganizer.update({ where: { id: orgC.id }, data: { stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true, stripeConnectedAt: new Date() } })
    await reconcileOrganizerPayouts()
    const c1paid = await prisma.organizerEarning.findUniqueOrThrow({ where: { id: c1.id } })
    assert(c1paid.status === 'paid' && !!c1paid.batchId, '[6] after connecting, reconciler paid the held earning (pay-when-connected loop closed)')

    // ── Assertion 7 — in-window excluded; pays after window ─────────────────────
    console.log('\n[7] in-window excluded; pays after the window closes')
    const orgF = await mkOrganizer(true); const evF = await mkEvent(orgF.id); const venF = await mkVendor(evF.id); const runF = await mkRunner(evF.id)
    const f1 = await seedDelivered(evF.id, venF.id, runF.id, 400, 0) // IN WINDOW
    const rF1 = await processEventOrganizerPayout(evF.id)
    const f1a = await prisma.organizerEarning.findUniqueOrThrow({ where: { id: f1.id } })
    assert(rF1.outcome === 'nothing' && f1a.status === 'accrued', 'in-window: nothing paid')
    await prisma.organizerEarning.update({ where: { id: f1.id }, data: { createdAt: new Date(Date.now() - 5 * 3_600_000) } })
    const beforeF2 = created.length
    const rF2 = await processEventOrganizerPayout(evF.id)
    assert(rF2.outcome === 'paid' && created.length === beforeF2 + 1 && created[created.length - 1].amount === 400, 'after window closes → paid exactly $4.00')

    // ── Bonus — reconciliation guard: batch total ≠ covered sum → halt ──────────
    console.log('\n[bonus] batch total ≠ covered sum → PayoutReconciliationError (halt, no transfer)')
    const orgG = await mkOrganizer(true); const evG = await mkEvent(orgG.id); const venG = await mkVendor(evG.id); const runG = await mkRunner(evG.id)
    const g1 = await seedDelivered(evG.id, venG.id, runG.id, 500, 5)
    // hand-create a pending batch with a WRONG total, link g1 to it → guard must halt
    const badBatch = await prisma.organizerPayout.create({ data: { eventId: evG.id, organizerId: orgG.id, totalCents: 99999, status: 'pending' } })
    await prisma.organizerEarning.update({ where: { id: g1.id }, data: { batchId: badBatch.id } })
    const beforeG = created.length
    let halted = false
    try { await processEventOrganizerPayout(evG.id) } catch (err) { halted = (err as Error).constructor.name === 'PayoutReconciliationError' }
    assert(halted, 'drifted batch total → PayoutReconciliationError thrown')
    assert(created.length === beforeG, 'NO transfer on ambiguous (drifted) batch')
  } finally {
    await cleanup()
  }

  console.log('\n══════════════════════════════════════════════════════════════════')
  console.log(`  B3 ORGANIZER BATCH EXECUTOR TEST — ${pass} passed, ${fail} failed   (real transfers: ${created.length})`)
  console.log(`  GATES: double-fire inert (incl. crash-recovery) + batch === ledger set sum + PARTIAL-PAY — ${fail === 0 ? 'HELD ✅' : 'CHECK ❌'}`)
  console.log('  (cohort deleted — DB back to baseline)')
  console.log('══════════════════════════════════════════════════════════════════\n')

  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('[b3-organizer-payout-test] FAILED:', err)
  try { await cleanup() } catch { /* best effort */ }
  await prisma.$disconnect()
  process.exit(2)
})
