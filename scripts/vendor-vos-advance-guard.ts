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
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
import { OrderStatus } from '@prisma/client'
import { reconcileMasterStatus, deriveMasterStatus } from '../lib/reconcile-order-status'

const prisma = testPrisma()
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

    // ── [5] ONE runner-fulfilled predicate — UI and route cannot drift ──────────
    console.log('\n[5] isRunnerFulfilled: truth table + both the route AND the dashboard use the SHARED predicate')
    const { isRunnerFulfilled } = await import('../lib/order-status')
    assert(isRunnerFulfilled('HOME_DELIVERY') === true, 'HOME_DELIVERY → runner-fulfilled (always)')
    assert(isRunnerFulfilled('CURBSIDE', 'RUNNER_DELIVERS') === true, '⛔ CURBSIDE + RUNNER_DELIVERS → runner-fulfilled (no vendor button, route rejects)')
    assert(isRunnerFulfilled('CURBSIDE', 'CUSTOMER_WALKS') === false, 'CURBSIDE + CUSTOMER_WALKS → vendor-completed (button stays)')
    assert(isRunnerFulfilled('BOOTH_PICKUP') === false, 'BOOTH_PICKUP → vendor-completed (button stays)')
    const { readFileSync } = await import('node:fs')
    const routeSrc = readFileSync('app/api/orders/[id]/vendor-status/route.ts', 'utf8')
    const dashSrc  = readFileSync('app/vendor/[fairSlug]/dashboard/page.tsx', 'utf8')
    assert(routeSrc.includes('isRunnerFulfilled('), 'the vendor-status ROUTE gates via the shared predicate (not a hand-rolled copy)')
    assert(dashSrc.includes('isRunnerFulfilled('), 'the DASHBOARD ready-lane gates via the shared predicate (not a hand-rolled copy)')

    // ══ TERMINAL OVERRIDES MUST CLOSE THE LANE TOO ═══════════════════════════════
    // DELIVERED (above) was the ONLY target that closed the vendor lane. The three asserted
    // terminals left it open, which stranded orders in a vendor's live queue (one sat in Randy's
    // "Ready" lane for 52 days) and kept them quoting "pending" take-home for money nobody would
    // ever receive. WHICH terminal value each case closes to is a MONEY decision: earnings zero
    // on DECLINED and only on DECLINED, so DECLINED = "$0, never touched it" and
    // CANCELLED = "paid, did the work".
    const { computeVendorOrderEarnings } = await import('../lib/vendor-earnings')
    const { vendorLaneClosePlan } = await import('../lib/reconcile-order-status')

    /** The analysis query, as a reusable probe: lanes still open on a terminal-failure order. */
    const danglingLanes = async (orderId: string) =>
      prisma.vendorOrderStatus.count({
        where: { orderId, status: { in: ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'] } },
      })

    /** Earnings for one lane, read the way every vendor surface reads it. */
    const laneCents = async (orderId: string, vendorId: string) => {
      const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: {
        total: true, status: true,
        orderItems: { select: { vendorId: true, subtotal: true } },
        payouts: { select: { vendorId: true, netAmount: true, reversedAt: true, stripeTransferId: true } },
        refunds: { select: { vendorId: true, status: true, amountCents: true } },
        vendorOrderStatuses: { select: { vendorId: true, status: true } },
      } })
      return computeVendorOrderEarnings(o, vendorId)
    }

    // ── [6] undeliverable / uncollected → CANCELLED (the food was made; vendor is paid) ──
    console.log('\n[6] an asserted terminal closes the vendor lane — to CANCELLED, which KEEPS the money')
    for (const [ft, timeout] of [['HOME_DELIVERY', 'UNDELIVERABLE'], ['BOOTH_PICKUP', 'UNCOLLECTED']] as const) {
      const id = await mkOrder(ft, OrderStatus.READY, 'READY')
      // [0] baseline on the PROBE: the lane is open BEFORE, or "closed after" proves nothing.
      assert(await danglingLanes(id) === 1, `[0] ${timeout}: baseline — the lane IS open before reconcile`)
      const paidBefore = (await laneCents(id, v.id)).cents
      assert(paidBefore > 0, `[0] ${timeout}: baseline — the open lane IS quoting money (${paidBefore}¢), so "still paid" is testable`)

      await reconcileMasterStatus(id, { timeout: { status: timeout } })
      assert(await master(id) === timeout, `${timeout}: master asserted (got ${await master(id)})`)
      assert(await vos(id, v.id) === 'CANCELLED', `${timeout}: lane closed READY→CANCELLED (got ${await vos(id, v.id)})`)
      assert(await danglingLanes(id) === 0, `${timeout}: ZERO lanes left open — the order leaves the vendor's queue`)
      const after = await laneCents(id, v.id)
      assert(after.cents === paidBefore, `${timeout}: the vendor KEEPS their money (${after.cents}¢ = ${paidBefore}¢) — they made the food`)

      // Idempotent: every update is status-conditional, so a re-run matches nothing.
      await reconcileMasterStatus(id, { timeout: { status: timeout } })
      assert(await vos(id, v.id) === 'CANCELLED', `${timeout}: re-run is a no-op (idempotent)`)
    }

    // ── [7] operator cancel is PER LANE — the #OMKVUDXZ shape ───────────────────
    console.log('\n[7] ⛔ operator CANCEL closes per-lane BY PROGRESS — it must not zero a vendor who did the work')
    const v2 = await prisma.vendor.create({ data: { eventId: ev.id, name: `V2 ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
    const v3 = await prisma.vendor.create({ data: { eventId: ev.id, name: `V3 ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
    const mi2 = await prisma.menuItem.create({ data: { vendorId: v2.id, name: 'I2', price: 10, category: 'T' } })
    const mi3 = await prisma.menuItem.create({ data: { vendorId: v3.id, name: 'I3', price: 10, category: 'T' } })

    // Three vendors, three lane states — exactly the real order that made this per-lane:
    //   v  = PLACED    (never started)  → DECLINED, $0
    //   v2 = READY     (food made)      → CANCELLED, paid
    //   v3 = COMPLETED (already done)   → UNTOUCHED
    const multi = await prisma.order.create({ data: {
      eventId: ev.id, customerId: await mkCustomer(), vendorId: v.id, status: OrderStatus.PLACED,
      fulfillmentType: 'BOOTH_PICKUP', subtotal: 30, fairSynqFee: 3, total: 33, vendorPayout: 30,
      customerName: 'C', customerPhone: '+10000000000', placedAt: new Date(),
      orderItems: { create: [
        { vendorId: v.id,  menuItemId: mi.id,  itemName: 'Item', quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 },
        { vendorId: v2.id, menuItemId: mi2.id, itemName: 'I2',   quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 },
        { vendorId: v3.id, menuItemId: mi3.id, itemName: 'I3',   quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 },
      ] },
      vendorOrderStatuses: { create: [
        { vendorId: v.id,  status: 'PLACED' },
        { vendorId: v2.id, status: 'READY' },
        { vendorId: v3.id, status: 'COMPLETED' },
      ] },
    } })
    const workedBefore = (await laneCents(multi.id, v2.id)).cents
    const doneBefore   = (await laneCents(multi.id, v3.id)).cents
    assert(await danglingLanes(multi.id) === 2, '[0] baseline: 2 lanes open (PLACED + READY), COMPLETED is not "open"')
    assert(workedBefore > 0 && doneBefore > 0, `[0] baseline: the worked (${workedBefore}¢) and done (${doneBefore}¢) lanes both quote money`)

    await reconcileMasterStatus(multi.id, { timeout: { status: 'CANCELLED', by: 'system', reason: 'Event cancelled by operator' } })
    assert(await master(multi.id) === 'CANCELLED', 'master asserted CANCELLED')
    assert(await vos(multi.id, v.id)  === 'DECLINED',  `the NOT-STARTED lane → DECLINED (got ${await vos(multi.id, v.id)})`)
    assert(await vos(multi.id, v2.id) === 'CANCELLED', `the WORKED lane → CANCELLED (got ${await vos(multi.id, v2.id)})`)
    assert(await vos(multi.id, v3.id) === 'COMPLETED', `⛔ the COMPLETED lane is UNTOUCHED (got ${await vos(multi.id, v3.id)}) — a per-order flip would have overwritten it`)
    assert(await danglingLanes(multi.id) === 0, 'no lane left open on the cancelled order')

    assert((await laneCents(multi.id, v.id)).cents === 0, 'the not-started vendor earns $0 (DECLINED zeroes)')
    assert((await laneCents(multi.id, v2.id)).cents === workedBefore, `the vendor who COOKED keeps ${workedBefore}¢ (CANCELLED does NOT zero)`)
    assert((await laneCents(multi.id, v3.id)).cents === doneBefore, `⛔ the vendor who FINISHED keeps ${doneBefore}¢ — the failure this test exists to catch`)

    // ── [8] the plan itself: an allowlist of LEGAL vendor statuses, never a master-only one ──
    console.log('\n[8] the close plan never writes a MASTER-only status into a vendor lane')
    const LEGAL_VENDOR = new Set(['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'DECLINED', 'REFUNDED', 'CANCELLED'])
    for (const t of ['UNDELIVERABLE', 'UNCOLLECTED', 'CANCELLED'] as const) {
      for (const { to } of vendorLaneClosePlan(t)) {
        // Widened to string ON PURPOSE. `to` is typed VendorStatus, and tsc ALREADY refuses the
        // master-only comparison below as provably impossible ("no overlap") — the type is the
        // real guarantee. This keeps a runtime check anyway, so the invariant still holds if
        // someone later widens VendorStatus or reaches the plan through an `as` cast.
        const value: string = to
        assert(LEGAL_VENDOR.has(value), `${t} → writes "${value}", a legal VendorOrderStatus`)
        assert(value !== 'UNDELIVERABLE' && value !== 'UNCOLLECTED',
          `${t} → does NOT write a master-only status (deriveMasterStatus would throw on it forever)`)
      }
    }
    assert(vendorLaneClosePlan('CANCELLED').length === 2, 'operator cancel has TWO rules (progress-split), not one blanket flip')
    assert(vendorLaneClosePlan('UNDELIVERABLE').length === 1 && vendorLaneClosePlan('UNDELIVERABLE')[0].to === 'CANCELLED',
      'undeliverable has ONE rule, closing to CANCELLED (paid)')
    // [0] control on the detector itself: re-open a lane and the probe MUST see it.
    await prisma.vendorOrderStatus.update({ where: { orderId_vendorId: { orderId: multi.id, vendorId: v.id } }, data: { status: 'READY' } })
    assert(await danglingLanes(multi.id) === 1, '[0] positive control: the dangling-lane probe DOES catch a re-opened lane (not vacuously 0)')

    console.log(`\n${'─'.repeat(52)}`)
    console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
  }
}

main()
  .then(() => prisma.$disconnect().then(() => process.exit(fail === 0 ? 0 : 1)))
  .catch(async (e) => { console.error('\n💥', e); await prisma.$disconnect(); process.exit(1) })
