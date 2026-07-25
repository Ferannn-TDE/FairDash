/**
 * COLLECT GUARD (Commit 2, U1) — the "collect from vendor" action must be ATOMIC + IDEMPOTENT.
 * Sets Order.collectedAt AND writes exactly one `collected` DeliveryCustodyEvent, in ONE
 * transaction. The nasty real-world case is NOT a clean failure — it's a POST that succeeds
 * server-side, whose response is lost, so the runner retries. That retry (and a fair-wifi
 * double-tap, and a true concurrent double-fire) must be BENIGN: one stamp, one event, never two.
 *
 * Proven directly against lib/collectOrder (the real path the route calls), with a positive
 * control on the probe + a [0] baseline, or the "collected" assertions are vacuous:
 *   [0] BASELINE — a fresh RUNNER_COLLECTED order reads collectedAt=null and 0 custody events.
 *   [1] POSITIVE — collect → collected, collectedAt set, EXACTLY ONE `collected` event.
 *   [2] IDEMPOTENT RETRY (the lost-response sequence) — retry → already_collected, still ONE
 *       event, the SAME collectedAt (no second stamp).
 *   [2b] CONCURRENT DOUBLE-FIRE — two collects in parallel → exactly one wins, ONE event, ONE
 *        stamp (proves the atomic guard, not a read-then-write race).
 *   [3..6] NEGATIVES — not-your-delivery / not-collectable / wrong-event / booth: no event written.
 *
 * Seeds a throwaway (never-protected) event and cleans up — writes only to its own event.
 * Run:  npx tsx scripts/test-collect-guard.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
import { collectOrder } from '../lib/collect-order'

const prisma = testPrisma()
const SLUG = 'collect-', MAIL = '@collect.local', rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    const w = { where: { eventId: { in: ids } } }
    await prisma.order.deleteMany(w) // cascades DeliveryCustodyEvent (onDelete: Cascade)
    await prisma.runner.deleteMany(w)
    await prisma.vendor.deleteMany(w)
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

const custodyCount = (orderId: string) => prisma.deliveryCustodyEvent.count({ where: { orderId, eventType: 'collected' } })

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({ data: { name: `COLLECT ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' } })
    const mkUser = async (p: string) => (await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}${p}-${rand()}${MAIL}`, name: p, role: 'customer' } })).id
    const runnerUser = await mkUser('r'), runner2User = await mkUser('r2')
    const runner = await prisma.runner.create({ data: { eventId: ev.id, userId: runnerUser, status: 'ACTIVE' } })
    const runner2 = await prisma.runner.create({ data: { eventId: ev.id, userId: runner2User, status: 'ACTIVE' } })
    const vendor = await prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })

    const mkOrder = async (extra: Record<string, unknown>) => prisma.order.create({ data: {
      eventId: ev.id, customerId: await mkUser('c'), vendorId: vendor.id,
      status: 'RUNNER_COLLECTED', fulfillmentType: 'HOME_DELIVERY', runnerId: runner.id,
      subtotal: 30, fairSynqFee: 3, total: 33, vendorPayout: 30, customerName: 'C', customerPhone: '+10000000000',
      placedAt: new Date(), ...extra,
    } })
    const collect = (orderId: string, opts?: { runnerId?: string; eventId?: string }) =>
      collectOrder({ orderId, runnerId: opts?.runnerId ?? runner.id, eventId: opts?.eventId ?? ev.id, actorId: runnerUser })

    // ── [0] BASELINE (positive control on the probe) ────────────────────────────
    console.log('[0] baseline: a fresh RUNNER_COLLECTED order is genuinely uncollected')
    const o1 = await mkOrder({})
    const pre = await prisma.order.findUnique({ where: { id: o1.id }, select: { collectedAt: true } })
    assert(pre?.collectedAt == null, 'collectedAt is null before collect')
    assert((await custodyCount(o1.id)) === 0, 'zero `collected` custody events before collect')

    // ── [1] POSITIVE ────────────────────────────────────────────────────────────
    console.log('\n[1] collect → collected, stamp set, exactly one event')
    const r1 = await collect(o1.id)
    const post = await prisma.order.findUnique({ where: { id: o1.id }, select: { collectedAt: true, status: true } })
    assert(r1.outcome === 'collected', `outcome is 'collected' (got '${r1.outcome}')`)
    assert(post?.collectedAt != null, 'collectedAt is now set')
    assert(post?.status === 'RUNNER_COLLECTED', 'master status stays RUNNER_COLLECTED (collect is orthogonal)')
    assert((await custodyCount(o1.id)) === 1, 'exactly ONE `collected` custody event written')

    // ── [2] IDEMPOTENT RETRY — the lost-response sequence ───────────────────────
    console.log('\n[2] retry after a succeeded-but-lost response is benign')
    const stampBefore = post?.collectedAt?.getTime()
    const r2 = await collect(o1.id)
    const post2 = await prisma.order.findUnique({ where: { id: o1.id }, select: { collectedAt: true } })
    assert(r2.outcome === 'already_collected', `retry outcome is 'already_collected' (got '${r2.outcome}')`)
    assert(post2?.collectedAt?.getTime() === stampBefore, 'collectedAt UNCHANGED — no second stamp')
    assert((await custodyCount(o1.id)) === 1, 'still exactly ONE event — no second event on retry')

    // ── [2b] CONCURRENT DOUBLE-FIRE — the true race, not a read-then-write ──────
    console.log('\n[2b] two collects in parallel → exactly one wins, one event, one stamp')
    const o2 = await mkOrder({})
    const [a, b] = await Promise.all([collect(o2.id), collect(o2.id)])
    const wins = [a, b].filter(r => r.outcome === 'collected').length
    const benign = [a, b].filter(r => r.outcome === 'already_collected').length
    assert(wins === 1, `exactly one call reports 'collected' (got ${wins})`)
    assert(benign === 1, `the other reports 'already_collected' (got ${benign})`)
    assert((await custodyCount(o2.id)) === 1, 'exactly ONE event despite two concurrent calls')

    // ── [3] NEGATIVE — not your delivery ────────────────────────────────────────
    console.log('\n[3] a different runner cannot collect — and writes no event')
    const o3 = await mkOrder({})
    const r3 = await collect(o3.id, { runnerId: runner2.id })
    assert(r3.outcome === 'not_your_delivery', `outcome is 'not_your_delivery' (got '${r3.outcome}')`)
    assert((await custodyCount(o3.id)) === 0, 'no custody event written for a foreign runner')
    assert((await prisma.order.findUnique({ where: { id: o3.id }, select: { collectedAt: true } }))?.collectedAt == null, 'collectedAt untouched')

    // ── [4] NEGATIVE — not collectable (wrong status) ───────────────────────────
    console.log('\n[4] an order not in RUNNER_COLLECTED is not collectable')
    const o4 = await mkOrder({ status: 'READY' })
    const r4 = await collect(o4.id)
    assert(r4.outcome === 'not_collectable', `outcome is 'not_collectable' (got '${r4.outcome}')`)
    assert((await custodyCount(o4.id)) === 0, 'no event written for a non-collectable order')

    // ── [5] NEGATIVE — wrong event (auth boundary) ──────────────────────────────
    console.log('\n[5] a runner from another event is rejected')
    const o5 = await mkOrder({})
    const r5 = await collect(o5.id, { eventId: 'some-other-event-id' })
    assert(r5.outcome === 'wrong_event', `outcome is 'wrong_event' (got '${r5.outcome}')`)
    assert((await custodyCount(o5.id)) === 0, 'no event written across an event boundary')

    // ── [6] NEGATIVE — BOOTH_PICKUP is not runner-collected ─────────────────────
    console.log('\n[6] a BOOTH_PICKUP order is not collected by a runner')
    const o6 = await mkOrder({ fulfillmentType: 'BOOTH_PICKUP' })
    const r6 = await collect(o6.id)
    assert(r6.outcome === 'not_runner_order', `outcome is 'not_runner_order' (got '${r6.outcome}')`)
    assert((await custodyCount(o6.id)) === 0, 'no event written for a booth order')

    console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} collect-guard: ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('💥', e); process.exit(1) })
