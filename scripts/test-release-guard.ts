/**
 * RELEASE GUARD (Commit 2, U2) — a runner hands a claimed-but-NOT-collected order back to the
 * pool. Inherits U1's shape (atomic conditional updateMany + custody event in one tx), and adds
 * the one thing release must prove that collect didn't: the pool return is REAL — a second
 * runner can actually claim the released row. The round-trip claim → release → re-claim is the
 * assertion; that the fields nulled is necessary but not sufficient.
 *
 * Also asserts the subtle correctness point: release writes status=READY EXPLICITLY (an
 * asserted regression), because canAdvance(RUNNER_COLLECTED → READY) is false — the monotonic
 * reconciler would never regress it, so a "nulled runnerId" alone would leave status stuck at
 * RUNNER_COLLECTED and the re-claim (WHERE status:READY) would fail.
 *
 * Proven against lib/releaseOrder with a [0] baseline + positive control:
 *   [0] BASELINE   — a RUNNER_COLLECTED, uncollected order, mine, 0 released events.
 *   [1] POSITIVE   — release → status READY (explicit), runnerId/dispatchedAt null, releasedAt
 *                    set, exactly one `released` event.
 *   [2] ROUND-TRIP — a SECOND runner's claim succeeds against the released row (re-claimable).
 *   [3] GATED      — a COLLECTED order refuses release (already_collected → that's U3), unchanged.
 *   [4] NEGATIVE   — a foreign runner cannot release; no event.
 *   [5] CONCURRENT — two releases in parallel → exactly one wins, one event.
 *
 * Seeds a throwaway (never-protected) event and cleans up.
 * Run:  npx tsx scripts/test-release-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { releaseOrder } from '../lib/release-order'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const SLUG = 'release-', MAIL = '@release.local', rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    const w = { where: { eventId: { in: ids } } }
    await prisma.order.deleteMany(w) // cascades DeliveryCustodyEvent
    await prisma.runner.deleteMany(w)
    await prisma.vendor.deleteMany(w)
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

const releasedCount = (orderId: string) => prisma.deliveryCustodyEvent.count({ where: { orderId, eventType: 'released' } })

// Mirror of the real claim in app/api/orders/[id]/status/route.ts:211 — the atomic race-safe
// claim. If this returns count 1, the released row is genuinely re-claimable.
const claimAtomic = (orderId: string, runnerId: string) =>
  prisma.order.updateMany({
    where: { id: orderId, runnerId: null, status: 'READY' },
    data: { runnerId, dispatchedAt: new Date() },
  })

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({ data: { name: `REL ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' } })
    const mkUser = async (p: string) => (await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}${p}-${rand()}${MAIL}`, name: p, role: 'customer' } })).id
    const runner = await prisma.runner.create({ data: { eventId: ev.id, userId: await mkUser('r'), status: 'ACTIVE' } })
    const runner2 = await prisma.runner.create({ data: { eventId: ev.id, userId: await mkUser('r2'), status: 'ACTIVE' } })
    const vendor = await prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })

    const mkOrder = async (extra: Record<string, unknown>) => prisma.order.create({ data: {
      eventId: ev.id, customerId: await mkUser('c'), vendorId: vendor.id,
      status: 'RUNNER_COLLECTED', fulfillmentType: 'HOME_DELIVERY', runnerId: runner.id, dispatchedAt: new Date(),
      subtotal: 30, fairSynqFee: 3, total: 33, vendorPayout: 30, customerName: 'C', customerPhone: '+10000000000',
      placedAt: new Date(), ...extra,
    } })
    const release = (orderId: string, rid = runner.id) => releaseOrder({ orderId, runnerId: rid, eventId: ev.id, actorId: 'test' })

    // ── [0] BASELINE ────────────────────────────────────────────────────────────
    console.log('[0] baseline: a claimed, uncollected order is mine and unreleased')
    const o1 = await mkOrder({})
    const pre = await prisma.order.findUnique({ where: { id: o1.id }, select: { status: true, runnerId: true, collectedAt: true } })
    assert(pre?.status === 'RUNNER_COLLECTED' && pre?.runnerId === runner.id && pre?.collectedAt == null, 'RUNNER_COLLECTED, mine, uncollected')
    assert((await releasedCount(o1.id)) === 0, 'zero `released` events before release')

    // ── [1] POSITIVE — the explicit READY regression + nulled fields + one event ─
    console.log('\n[1] release → status READY (explicit), fields nulled, releasedAt set, one event')
    const r1 = await release(o1.id)
    const post = await prisma.order.findUnique({ where: { id: o1.id }, select: { status: true, runnerId: true, dispatchedAt: true, releasedAt: true } })
    assert(r1.outcome === 'released', `outcome 'released' (got '${r1.outcome}')`)
    assert(post?.status === 'READY', 'status is READY — the asserted regression the reconciler would refuse')
    assert(post?.runnerId === null, 'runnerId nulled')
    assert(post?.dispatchedAt === null, 'dispatchedAt nulled')
    assert(post?.releasedAt != null, 'releasedAt stamped (the feed re-arm signal)')
    assert((await releasedCount(o1.id)) === 1, 'exactly one `released` custody event')

    // ── [2] ROUND-TRIP — the pool return is REAL: runner2 can claim it ──────────
    console.log('\n[2] round-trip: a second runner claims the released row')
    const claim = await claimAtomic(o1.id, runner2.id)
    const reclaimed = await prisma.order.findUnique({ where: { id: o1.id }, select: { runnerId: true, status: true } })
    assert(claim.count === 1, 'the atomic claim matches the released row (count 1) — genuinely re-claimable')
    assert(reclaimed?.runnerId === runner2.id, 'the order is now assigned to the second runner')
    // The claim ASSIGNS runnerId; the master status flips to RUNNER_COLLECTED on the next
    // reconcile (derived from the new runnerId — the real route runs it after the claim). So
    // post-claim/pre-reconcile the status is still READY. That the claim MATCHED is the proof.
    assert(reclaimed?.status === 'READY', 'status stays READY until reconcile derives RUNNER_COLLECTED from the new runnerId')

    // ── [3] GATED — a COLLECTED order cannot be released here (→ U3 return) ──────
    console.log('\n[3] a collected order refuses release (needs the vendor-confirmed return)')
    const o3 = await mkOrder({ collectedAt: new Date() })
    const r3 = await release(o3.id)
    const o3post = await prisma.order.findUnique({ where: { id: o3.id }, select: { status: true, runnerId: true } })
    assert(r3.outcome === 'already_collected', `outcome 'already_collected' (got '${r3.outcome}')`)
    assert(o3post?.status === 'RUNNER_COLLECTED' && o3post?.runnerId === runner.id, 'collected order untouched — not released')
    assert((await releasedCount(o3.id)) === 0, 'no `released` event for a collected order')

    // ── [4] NEGATIVE — a foreign runner cannot release ──────────────────────────
    console.log('\n[4] a different runner cannot release my order')
    const o4 = await mkOrder({})
    const r4 = await release(o4.id, runner2.id)
    assert(r4.outcome === 'not_your_delivery', `outcome 'not_your_delivery' (got '${r4.outcome}')`)
    assert((await releasedCount(o4.id)) === 0, 'no event for a foreign runner')
    assert((await prisma.order.findUnique({ where: { id: o4.id }, select: { status: true } }))?.status === 'RUNNER_COLLECTED', 'order untouched')

    // ── [5] CONCURRENT — two releases → exactly one wins, one event ─────────────
    console.log('\n[5] two releases in parallel → exactly one wins, one event')
    const o5 = await mkOrder({})
    const [a, b] = await Promise.all([release(o5.id), release(o5.id)])
    const wins = [a, b].filter(r => r.outcome === 'released').length
    assert(wins === 1, `exactly one call reports 'released' (got ${wins})`)
    assert((await releasedCount(o5.id)) === 1, 'exactly one `released` event despite two concurrent calls')

    console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} release-guard: ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('💥', e); process.exit(1) })
