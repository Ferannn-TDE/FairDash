/**
 * Vendor VOS advances on DELIVERED — closes the delivery-order under-report, safely.
 *
 * THE BUG: a delivery order's vendor VendorOrderStatus stays at READY forever (vendor marks
 * READY, runner delivers, vendor never marks COMPLETED). Every VOS-join reader (vendor
 * analytics / dashboard revenue / Firebase stats) filters VOS IN (COMPLETED, DELIVERED), so a
 * delivered order is DROPPED from the vendor's own revenue view — even though they were PAID
 * (accrual is VOS-independent). Fix: on the DELIVERED transition, advance the vendor's READY
 * portions to COMPLETED.
 *
 * THE HAZARD the fix must not create: reconcileMasterStatus DERIVES master FROM VOS, and we're
 * writing VOS from master=DELIVERED — a cycle. The proof below is at the RIGHT state (master
 * actually DELIVERED, not RUNNER_COLLECTED): advancing VOS must NOT flip master to COMPLETED.
 * It can't, by construction — the delivery arm CLAMPS a vendor COMPLETED to READY and the
 * proof-arm returns DELIVERED — but [2] proves the fixed point rather than trusting it.
 *
 * Run:  npx tsx scripts/vendor-vos-advance-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient, OrderStatus } from '@prisma/client'
import { reconcileMasterStatus, deriveMasterStatus } from '../lib/reconcile-order-status'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const SLUG = 'vva-', MAIL = '@vva.local', rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    const w = { where: { eventId: { in: ids } } }
    await prisma.vendorEarning.deleteMany(w); await prisma.runnerEarning.deleteMany(w); await prisma.organizerEarning.deleteMany(w)
    await prisma.vendorOrderStatus.deleteMany({ where: { order: { eventId: { in: ids } } } })
    await prisma.order.deleteMany(w); await prisma.menuItem.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany(w); await prisma.runner.deleteMany(w); await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

/** The exact vendor-analytics summary read (VOS-join COMPLETED/DELIVERED). */
async function analyticsRevenue(vendorId: string) {
  const r = await prisma.orderItem.aggregate({
    where: { vendorId, order: { vendorOrderStatuses: { some: { vendorId, status: { in: ['COMPLETED', 'DELIVERED'] } } } } },
    _sum: { totalPrice: true }, _count: { id: true },
  })
  return { revenue: r._sum.totalPrice ?? 0, items: r._count.id }
}

async function vos(orderId: string, vendorId: string) {
  return (await prisma.vendorOrderStatus.findUnique({ where: { orderId_vendorId: { orderId, vendorId } }, select: { status: true } }))?.status
}
async function master(orderId: string) {
  return (await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }))?.status
}

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({ data: { name: `VVA ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' } })
    const v = await prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
    const mi = await prisma.menuItem.create({ data: { vendorId: v.id, name: 'Item', price: 10, category: 'T' } })
    const mkCustomer = async () => (await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}c-${rand()}${MAIL}`, name: 'C', role: 'customer' } })).id
    const runnerUser = await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}r-${rand()}${MAIL}`, name: 'R', role: 'runner' } })
    const runner = await prisma.runner.create({ data: { userId: runnerUser.id, eventId: ev.id, status: 'ACTIVE', approvalStatus: 'APPROVED' } })

    const mkOrder = async (ft: 'HOME_DELIVERY' | 'BOOTH_PICKUP', masterStatus: OrderStatus, vosStatus: string, opts: { proof?: boolean } = {}) => {
      const o = await prisma.order.create({ data: {
        eventId: ev.id, customerId: await mkCustomer(), vendorId: v.id, status: masterStatus, fulfillmentType: ft,
        subtotal: 10, fairSynqFee: 1, total: 11, vendorPayout: 10, deliveryFee: ft === 'HOME_DELIVERY' ? 5 : 0,
        customerName: 'C', customerPhone: '+10000000000', placedAt: new Date(),
        ...(ft === 'HOME_DELIVERY' ? { runnerId: runner.id } : {}),
        ...(opts.proof ? { deliveryProofPath: 'proofs/x.jpg' } : {}),
        orderItems: { create: [{ vendorId: v.id, menuItemId: mi.id, itemName: 'Item', quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 }] },
        vendorOrderStatuses: { create: [{ vendorId: v.id, status: vosStatus }] },
      } })
      return o.id
    }

    // ── [0] BASELINE — the under-report condition exists ────────────────────────
    console.log('\n[0] baseline: a runner-delivered order sits at VOS=READY → dropped from vendor analytics')
    // master RUNNER_COLLECTED, proof present → reconcile will derive DELIVERED.
    const del = await mkOrder('HOME_DELIVERY', OrderStatus.RUNNER_COLLECTED, 'READY', { proof: true })
    const before = await analyticsRevenue(v.id)
    assert(before.items === 0, `analytics shows $0 / 0 items for the VOS=READY delivery order (the bug: got $${before.revenue}/${before.items})`)

    // ── [1] THE FIX — reconcile to DELIVERED advances the vendor VOS ────────────
    console.log('\n[1] reconcile → DELIVERED advances vendor VOS READY→COMPLETED and analytics now counts it')
    const r1 = await reconcileMasterStatus(del)
    assert(r1.to === 'DELIVERED', `master derived DELIVERED (got ${r1.to})`)
    assert(await master(del) === 'DELIVERED', 'order master is DELIVERED')
    assert(await vos(del, v.id) === 'COMPLETED', `vendor VOS advanced READY→COMPLETED (got ${await vos(del, v.id)})`)
    const after = await analyticsRevenue(v.id)
    assert(after.items === 1 && after.revenue === 10, `⛔ analytics NOW counts it: $${after.revenue}/${after.items} (was $${before.revenue}/${before.items}) — proves the fix, non-vacuously`)

    // ── [2] FIXED POINT — the loop, at the RIGHT state (master already DELIVERED) ─
    console.log('\n[2] ⛔ re-run reconcile on the now-DELIVERED order — master must NOT flip to COMPLETED')
    const r2 = await reconcileMasterStatus(del)
    assert(await master(del) === 'DELIVERED', `master STILL DELIVERED after re-derive with VOS=COMPLETED (got ${await master(del)}) — converges, never flips`)
    assert(await vos(del, v.id) === 'COMPLETED', 'vendor VOS stable at COMPLETED (idempotent — only READY portions advance)')

    // ── [3] NEGATIVE CONTROL — booth arm untouched ──────────────────────────────
    console.log('\n[3] a BOOTH_PICKUP order still reaches COMPLETED normally — the delivery-arm change did not touch it')
    const pick = await mkOrder('BOOTH_PICKUP', OrderStatus.READY, 'COMPLETED') // vendor marked complete (booth flow)
    const r3 = await reconcileMasterStatus(pick)
    assert(r3.to === 'COMPLETED', `booth order derives COMPLETED (got ${r3.to}) — not DELIVERED, not broken`)
    assert(await vos(pick, v.id) === 'COMPLETED', 'booth VOS unchanged (the delivery advance never fired for it)')

    // ── [4] THE ?? 0 KILL — an unrecognized active VOS fails LOUD, not silently PLACED ─
    console.log('\n[4] deriveMasterStatus THROWS on an unrecognized active VOS (no silent rank-0 → PLACED)')
    let threw = false
    try { deriveMasterStatus({ fulfillmentType: 'HOME_DELIVERY', vendorStatuses: [{ status: 'BOGUS_STATUS' }] }) }
    catch { threw = true }
    assert(threw, 'unrecognized active VendorOrderStatus throws (the money-adjacent aggregator fails loud)')
    // positive control: a RECOGNIZED status does NOT throw
    let ok = true
    try { deriveMasterStatus({ fulfillmentType: 'HOME_DELIVERY', vendorStatuses: [{ status: 'READY' }] }) } catch { ok = false }
    assert(ok, 'a recognized status still derives fine (the throw is specific to the unknown)')

    console.log(`\n${'─'.repeat(52)}`)
    console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
  }
}

main()
  .then(() => prisma.$disconnect().then(() => process.exit(fail === 0 ? 0 : 1)))
  .catch(async (e) => { console.error('\n💥', e); await prisma.$disconnect(); process.exit(1) })
