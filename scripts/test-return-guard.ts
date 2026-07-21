/**
 * RETURN GUARD (Commit 2, U3) — the POST-collection return: a runner who has the bag but can't
 * deliver requests a return; the VENDOR confirms possession; the order goes back to the pool.
 * This is the two-step path release (U2) can't take — once collected, a human (the vendor) must
 * confirm the food is actually back before it's re-offered.
 *
 * Proven against lib/requestReturn + lib/confirmReturn, with a [0] baseline + the round-trip:
 *   [0] BASELINE   — a collected order, no return requested, 0 return events.
 *   [1] REQUEST    — runner requests → returnRequestedAt set, order UNMOVED (still RUNNER_COLLECTED,
 *                    still collected, still the runner's — he has the bag), one `return_requested`.
 *   [2] IDEMPOTENT — a second request is benign (already_requested), one event, same stamp.
 *   [3] CONFIRM    — vendor confirms → status READY (explicit regression), runnerId/collectedAt/
 *                    returnRequestedAt cleared, releasedAt set, one `return_confirmed`.
 *   [4] ROUND-TRIP — a second runner's claim matches the returned row — genuinely re-claimable.
 *   [5..8] NEGATIVES — request pre-collection (not_collected) / confirm with no request
 *                    (no_return_requested) / confirm by a vendor not on the order (not_on_order) /
 *                    request by a foreign runner (not_your_delivery): no events written.
 *   [9] CONCURRENT — two confirms in parallel → exactly one wins, one event.
 *
 * Seeds a throwaway (never-protected) event and cleans up.
 * Run:  npx tsx scripts/test-return-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { requestReturn } from '../lib/request-return'
import { confirmReturn } from '../lib/confirm-return'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const SLUG = 'return-', MAIL = '@return.local', rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    const w = { where: { eventId: { in: ids } } }
    await prisma.vendorOrderStatus.deleteMany({ where: { order: { eventId: { in: ids } } } })
    await prisma.order.deleteMany(w) // cascades DeliveryCustodyEvent
    await prisma.runner.deleteMany(w)
    await prisma.vendor.deleteMany(w)
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

const evCount = (orderId: string, type: string) => prisma.deliveryCustodyEvent.count({ where: { orderId, eventType: type } })
const claimAtomic = (orderId: string, runnerId: string) =>
  prisma.order.updateMany({ where: { id: orderId, runnerId: null, status: 'READY' }, data: { runnerId, dispatchedAt: new Date() } })

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({ data: { name: `RET ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' } })
    const mkUser = async (p: string) => (await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}${p}-${rand()}${MAIL}`, name: p, role: 'customer' } })).id
    const runner = await prisma.runner.create({ data: { eventId: ev.id, userId: await mkUser('r'), status: 'ACTIVE' } })
    const runner2 = await prisma.runner.create({ data: { eventId: ev.id, userId: await mkUser('r2'), status: 'ACTIVE' } })
    const vendor = await prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
    const otherVendor = await prisma.vendor.create({ data: { eventId: ev.id, name: `OV ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })

    // A collected order assigned to runner1, with a VOS row for `vendor` (so it's on the order).
    const mkCollected = async (extra: Record<string, unknown> = {}) => {
      const o = await prisma.order.create({ data: {
        eventId: ev.id, customerId: await mkUser('c'), vendorId: vendor.id,
        status: 'RUNNER_COLLECTED', fulfillmentType: 'HOME_DELIVERY', runnerId: runner.id, dispatchedAt: new Date(), collectedAt: new Date(),
        subtotal: 30, fairSynqFee: 3, total: 33, vendorPayout: 30, customerName: 'C', customerPhone: '+10000000000',
        placedAt: new Date(), ...extra,
      } })
      await prisma.vendorOrderStatus.create({ data: { orderId: o.id, vendorId: vendor.id, status: 'READY' } })
      return o
    }
    const reqRet = (orderId: string, rid = runner.id) => requestReturn({ orderId, runnerId: rid, eventId: ev.id, actorId: 'test' })
    const confRet = (orderId: string, vid = vendor.id) => confirmReturn({ orderId, vendorId: vid, actorId: 'test' })

    // ── [0] BASELINE ────────────────────────────────────────────────────────────
    console.log('[0] baseline: a collected order with no return requested')
    const o1 = await mkCollected()
    const pre = await prisma.order.findUnique({ where: { id: o1.id }, select: { status: true, collectedAt: true, returnRequestedAt: true } })
    assert(pre?.status === 'RUNNER_COLLECTED' && pre?.collectedAt != null && pre?.returnRequestedAt == null, 'collected, no return requested')
    assert((await evCount(o1.id, 'return_requested')) === 0, 'zero return_requested events')

    // ── [1] REQUEST — the order does NOT move; the runner still has the bag ─────
    console.log('\n[1] runner requests return → flag set, order unmoved, one event')
    const r1 = await reqRet(o1.id)
    const p1 = await prisma.order.findUnique({ where: { id: o1.id }, select: { status: true, runnerId: true, collectedAt: true, returnRequestedAt: true } })
    assert(r1.outcome === 'return_requested', `outcome 'return_requested' (got '${r1.outcome}')`)
    assert(p1?.returnRequestedAt != null, 'returnRequestedAt stamped')
    assert(p1?.status === 'RUNNER_COLLECTED' && p1?.runnerId === runner.id && p1?.collectedAt != null, 'order UNMOVED — still collected & assigned (runner has the bag)')
    assert((await evCount(o1.id, 'return_requested')) === 1, 'exactly one return_requested event')

    // ── [2] IDEMPOTENT REQUEST ──────────────────────────────────────────────────
    console.log('\n[2] a second request is benign')
    const stamp = p1?.returnRequestedAt?.getTime()
    const r2 = await reqRet(o1.id)
    const p2 = await prisma.order.findUnique({ where: { id: o1.id }, select: { returnRequestedAt: true } })
    assert(r2.outcome === 'already_requested', `outcome 'already_requested' (got '${r2.outcome}')`)
    assert(p2?.returnRequestedAt?.getTime() === stamp, 'returnRequestedAt unchanged')
    assert((await evCount(o1.id, 'return_requested')) === 1, 'still exactly one event')

    // ── [3] CONFIRM — vendor confirms → status READY, custody cleared ───────────
    console.log('\n[3] vendor confirms → status READY (explicit), lifecycle cleared, one event')
    const c1 = await confRet(o1.id)
    const p3 = await prisma.order.findUnique({ where: { id: o1.id }, select: { status: true, runnerId: true, collectedAt: true, returnRequestedAt: true, releasedAt: true } })
    assert(c1.outcome === 'returned', `outcome 'returned' (got '${c1.outcome}')`)
    assert(p3?.status === 'READY', 'status READY — the asserted regression')
    assert(p3?.runnerId === null && p3?.collectedAt === null && p3?.returnRequestedAt === null, 'runnerId/collectedAt/returnRequestedAt all cleared')
    assert(p3?.releasedAt != null, 'releasedAt stamped')
    assert((await evCount(o1.id, 'return_confirmed')) === 1, 'exactly one return_confirmed event')

    // ── [4] ROUND-TRIP — a second runner can claim the returned row ─────────────
    console.log('\n[4] round-trip: a second runner claims the returned order')
    const claim = await claimAtomic(o1.id, runner2.id)
    assert(claim.count === 1, 'the atomic claim matches the returned row (count 1) — re-claimable')
    assert((await prisma.order.findUnique({ where: { id: o1.id }, select: { runnerId: true } }))?.runnerId === runner2.id, 'now assigned to the second runner')

    // ── [5] NEGATIVE — request on a PRE-collection order → not_collected ────────
    console.log('\n[5] a pre-collection order cannot be RETURNED (it is a release)')
    const o5 = await mkCollected({ collectedAt: null })
    const r5 = await reqRet(o5.id)
    assert(r5.outcome === 'not_collected', `outcome 'not_collected' (got '${r5.outcome}')`)
    assert((await evCount(o5.id, 'return_requested')) === 0, 'no event')

    // ── [6] NEGATIVE — confirm with no return requested ─────────────────────────
    console.log('\n[6] a vendor cannot confirm a return that was never requested')
    const o6 = await mkCollected()
    const c6 = await confRet(o6.id)
    assert(c6.outcome === 'no_return_requested', `outcome 'no_return_requested' (got '${c6.outcome}')`)
    assert((await evCount(o6.id, 'return_confirmed')) === 0, 'no event')

    // ── [7] NEGATIVE — a vendor not on the order cannot confirm ─────────────────
    console.log('\n[7] a vendor not on the order cannot confirm its return')
    const o7 = await mkCollected(); await reqRet(o7.id)
    const c7 = await confRet(o7.id, otherVendor.id)
    assert(c7.outcome === 'not_on_order', `outcome 'not_on_order' (got '${c7.outcome}')`)
    assert((await evCount(o7.id, 'return_confirmed')) === 0, 'no event for a foreign vendor')

    // ── [8] NEGATIVE — a foreign runner cannot request the return ───────────────
    console.log('\n[8] a different runner cannot request the return')
    const o8 = await mkCollected()
    const r8 = await reqRet(o8.id, runner2.id)
    assert(r8.outcome === 'not_your_delivery', `outcome 'not_your_delivery' (got '${r8.outcome}')`)
    assert((await evCount(o8.id, 'return_requested')) === 0, 'no event')

    // ── [9] CONCURRENT — two confirms → exactly one wins, one event ─────────────
    console.log('\n[9] two confirms in parallel → exactly one wins, one event')
    const o9 = await mkCollected(); await reqRet(o9.id)
    const [a, b] = await Promise.all([confRet(o9.id), confRet(o9.id)])
    const wins = [a, b].filter(r => r.outcome === 'returned').length
    assert(wins === 1, `exactly one confirm reports 'returned' (got ${wins})`)
    assert((await evCount(o9.id, 'return_confirmed')) === 1, 'exactly one return_confirmed event despite two concurrent confirms')

    console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} return-guard: ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('💥', e); process.exit(1) })
