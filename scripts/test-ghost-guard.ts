/**
 * GHOST GUARD — a VOIDED order must be dead to every runner-facing surface.
 *
 * The incident (2026-07-21): the void floor (money/audit INCLUDE voided, operational surfaces
 * EXCLUDE) was locked before the runner feed existed as a consumer, so the feed, the claim, and
 * all four custody ops ran unfiltered. The first two delivery orders ever voided (#WVRDERFI,
 * #8DBXU1FR) appeared as an active delivery + a claimable order, and were actually claimed,
 * COLLECTED, and released as ghosts — custody events written against dead rows.
 *
 * Per the vacuity discipline, every negative here has a POSITIVE-CONTROL TWIN (identical order,
 * not voided) proving the probe works, and refusals are asserted as the SPECIFIC named outcome
 * ('order_voided' / ORDER_VOIDED 409), never just "didn't succeed".
 *
 *   [0] BASELINE + POSITIVE CONTROLS — non-voided twins: feed sees them, ops succeed.
 *   [1] FEED — the voided READY twin is invisible in runnerFeedWhere AND runnerOrderDetailWhere
 *       (the guard imports the REAL predicates from lib/runner-feed — no drifting copy).
 *   [2] COLLECT — voided claimed order → 'order_voided'; no stamp, no custody event.
 *   [3] RELEASE — voided claimed order → 'order_voided'; status/runnerId untouched.
 *   [4] REQUEST-RETURN — voided collected order → 'order_voided'.
 *   [5] CONFIRM-RETURN — voided return-requested order → 'order_voided'; no reset to READY.
 *   [6] SOURCE SHAPE — the claim's atomic WHERE has voidedAt: null + the status route refuses
 *       ORDER_VOIDED; the feed route uses the shared predicates; all 5 custody routes map
 *       order_voided → ORDER_VOIDED.
 *
 * Seeds a throwaway (never-protected) event and cleans up — writes only to its own event.
 * Run:  npx tsx scripts/test-ghost-guard.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import { runnerFeedWhere, runnerOrderDetailWhere } from '../lib/runner-feed'
import { collectOrder } from '../lib/collect-order'
import { releaseOrder } from '../lib/release-order'
import { requestReturn } from '../lib/request-return'
import { confirmReturn } from '../lib/confirm-return'

const prisma = testPrisma()
const SLUG = 'ghost-', MAIL = '@ghost.local', rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    const w = { where: { eventId: { in: ids } } }
    await prisma.order.deleteMany(w)
    await prisma.runner.deleteMany(w)
    await prisma.vendor.deleteMany(w)
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({ data: { name: `GHOST ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' } })
    const mkUser = async (p: string) => (await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}${p}-${rand()}${MAIL}`, name: p, role: 'customer' } })).id
    const runnerUser = await mkUser('r')
    const runner = await prisma.runner.create({ data: { eventId: ev.id, userId: runnerUser, status: 'ACTIVE' } })
    const vendor = await prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })

    const VOID = new Date()
    const mkOrder = async (extra: Record<string, unknown>) => prisma.order.create({ data: {
      eventId: ev.id, customerId: await mkUser('c'), vendorId: vendor.id,
      status: 'READY', fulfillmentType: 'HOME_DELIVERY', readyAt: new Date(),
      subtotal: 30, fairSynqFee: 3, total: 33, vendorPayout: 30, customerName: 'C', customerPhone: '+10000000000',
      placedAt: new Date(), ...extra,
    } })

    // Twins: [live, ghost] for each surface. Ghost = identical + voidedAt.
    const feedLive   = await mkOrder({})
    const feedGhost  = await mkOrder({ voidedAt: VOID })
    const collLive   = await mkOrder({ status: 'RUNNER_COLLECTED', runnerId: runner.id })
    const collGhost  = await mkOrder({ status: 'RUNNER_COLLECTED', runnerId: runner.id, voidedAt: VOID })
    const relLive    = await mkOrder({ status: 'RUNNER_COLLECTED', runnerId: runner.id })
    const relGhost   = await mkOrder({ status: 'RUNNER_COLLECTED', runnerId: runner.id, voidedAt: VOID })
    const reqGhost   = await mkOrder({ status: 'RUNNER_COLLECTED', runnerId: runner.id, collectedAt: new Date(), voidedAt: VOID })
    const confGhost  = await mkOrder({ status: 'RUNNER_COLLECTED', runnerId: runner.id, collectedAt: new Date(), returnRequestedAt: new Date(), voidedAt: VOID })
    await prisma.vendorOrderStatus.create({ data: { orderId: confGhost.id, vendorId: vendor.id, status: 'READY' } })

    const feedIds = async () => (await prisma.order.findMany({ where: runnerFeedWhere(ev.id, runner.id), select: { id: true } })).map(o => o.id)
    const custodyEvents = (orderId: string) => prisma.deliveryCustodyEvent.count({ where: { orderId } })

    // ── [0] BASELINE + POSITIVE CONTROLS — the probes genuinely work on live twins ──
    console.log('[0] positive controls: non-voided twins are visible and operable')
    const ids0 = await feedIds()
    assert(ids0.includes(feedLive.id), 'live READY order IS in the feed (feed probe works)')
    assert((await prisma.order.findFirst({ where: runnerOrderDetailWhere(feedLive.id, ev.id, runner.id), select: { id: true } }))?.id === feedLive.id, 'live order IS visible via detail predicate')
    const c0 = await collectOrder({ orderId: collLive.id, runnerId: runner.id, eventId: ev.id })
    assert(c0.outcome === 'collected', `collect on live twin succeeds (got '${c0.outcome}')`)
    const r0 = await releaseOrder({ orderId: relLive.id, runnerId: runner.id, eventId: ev.id })
    assert(r0.outcome === 'released', `release on live twin succeeds (got '${r0.outcome}')`)

    // ── [1] FEED — ghosts invisible through the REAL predicates ──────────────────
    console.log('\n[1] a voided order is invisible to the feed and the detail read')
    assert(!ids0.includes(feedGhost.id) && !ids0.includes(collGhost.id), 'voided READY + voided RUNNER_COLLECTED are NOT in the feed')
    assert((await prisma.order.findFirst({ where: runnerOrderDetailWhere(feedGhost.id, ev.id, runner.id) })) === null, 'voided order detail read returns nothing')

    // ── [2] COLLECT refuses BY NAME, writes nothing ───────────────────────────────
    console.log('\n[2] collect on a voided order → order_voided, no stamp, no event')
    const c1 = await collectOrder({ orderId: collGhost.id, runnerId: runner.id, eventId: ev.id })
    assert(c1.outcome === 'order_voided', `outcome is 'order_voided' (got '${c1.outcome}')`)
    const collAfter = await prisma.order.findUnique({ where: { id: collGhost.id }, select: { collectedAt: true } })
    assert(collAfter?.collectedAt === null, 'collectedAt still null')
    assert((await custodyEvents(collGhost.id)) === 0, 'zero custody events written')

    // ── [3] RELEASE refuses BY NAME, resets nothing ───────────────────────────────
    console.log('\n[3] release on a voided order → order_voided, no reset')
    const r1 = await releaseOrder({ orderId: relGhost.id, runnerId: runner.id, eventId: ev.id })
    assert(r1.outcome === 'order_voided', `outcome is 'order_voided' (got '${r1.outcome}')`)
    const relAfter = await prisma.order.findUnique({ where: { id: relGhost.id }, select: { status: true, runnerId: true, releasedAt: true } })
    assert(relAfter?.status === 'RUNNER_COLLECTED' && relAfter.runnerId === runner.id && relAfter.releasedAt === null, 'status/runnerId untouched, no releasedAt re-arm')

    // ── [4] REQUEST-RETURN refuses BY NAME ────────────────────────────────────────
    console.log('\n[4] request-return on a voided collected order → order_voided')
    const q1 = await requestReturn({ orderId: reqGhost.id, runnerId: runner.id, eventId: ev.id })
    assert(q1.outcome === 'order_voided', `outcome is 'order_voided' (got '${q1.outcome}')`)

    // ── [5] CONFIRM-RETURN refuses BY NAME, never resurrects to READY ─────────────
    console.log('\n[5] confirm-return on a voided order → order_voided, no reset to READY')
    const f1 = await confirmReturn({ orderId: confGhost.id, vendorId: vendor.id })
    assert(f1.outcome === 'order_voided', `outcome is 'order_voided' (got '${f1.outcome}')`)
    const confAfter = await prisma.order.findUnique({ where: { id: confGhost.id }, select: { status: true, runnerId: true } })
    assert(confAfter?.status === 'RUNNER_COLLECTED' && confAfter.runnerId === runner.id, 'no resurrection: status/runnerId untouched')

    // ── [5b] THE ORDER LOG — the aggregate that was NOT ghost-aware ───────────────
    // Third instance of this class: lib/fair-orders had no voidedAt filter, so the admin/
    // organizer log counted out-of-model rows as live work (measured on the real fair: 92
    // "active" when 4 were real, 377 total when 152 were). The live twins seeded above are the
    // positive control — if the filter were over-broad and hid everything, they would vanish too.
    console.log('\n[5b] the order log excludes ghosts by default, and can opt in')
    const { getFairOrders } = await import('../lib/fair-orders')
    const logDefault = await getFairOrders(ev.id, { take: 100 })
    const logIds = new Set(logDefault.orders.map(o => o.id))
    assert(logIds.has(feedLive.id), 'POSITIVE CONTROL: the LIVE twin IS in the log (the filter is not hiding everything)')
    assert(!logIds.has(feedGhost.id), 'the VOIDED twin is absent from the log')
    assert(logDefault.total === logDefault.orders.length && !logIds.has(collGhost.id),
      'the total counts only what is listed — ghosts are out of the count, not just the page')
    const ghostTabs = logDefault.meta.tabCounts
    const logAll = await getFairOrders(ev.id, { take: 100, includeVoided: true })
    assert(logAll.total > logDefault.total, 'includeVoided is a real OPT-IN — it returns strictly more')
    assert(new Set(logAll.orders.map(o => o.id)).has(feedGhost.id), 'the opt-in DOES surface the voided row (an admin can still audit it)')
    assert((logAll.meta.tabCounts.all ?? 0) > (ghostTabs.all ?? 0),
      'TAB COUNTS honour the filter too — a badge cannot claim more than the list shows')

    // ── [6] SOURCE SHAPE — the paths this guard cannot call directly ──────────────
    console.log('\n[6] source shape: claim guard + shared predicates + named 409 mappings')
    const statusRoute = readFileSync(new URL('../app/api/orders/[id]/status/route.ts', import.meta.url), 'utf8')
    assert(/runnerId:\s*null,\s*status:\s*OrderStatus\.READY,\s*voidedAt:\s*null/.test(statusRoute), "claim's atomic WHERE includes voidedAt: null")
    assert(statusRoute.includes("'ORDER_VOIDED'"), 'status route refuses runner transitions on voided orders BY NAME')
    const feedRoute = readFileSync(new URL('../app/api/runners/me/orders/route.ts', import.meta.url), 'utf8')
    assert(feedRoute.includes('runnerFeedWhere(') && feedRoute.includes('runnerOrderDetailWhere('), 'feed route uses the SHARED predicates this guard just exercised')
    for (const rel of ['orders/[id]/collect', 'orders/[id]/release', 'orders/[id]/request-return', 'orders/[id]/confirm-return', 'admin/events/[id]/orders/[orderId]/release']) {
      const src = readFileSync(new URL(`../app/api/${rel}/route.ts`, import.meta.url), 'utf8')
      assert(src.includes("case 'order_voided'") && src.includes("'ORDER_VOIDED'"), `${rel} maps order_voided → 409 ORDER_VOIDED`)
    }
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }

  console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} ghost-guard: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
