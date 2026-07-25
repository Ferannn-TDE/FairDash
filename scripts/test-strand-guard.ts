/**
 * STRAND GUARD (Commit 2, U4) — the delivery-custody strand clocks (reconciler Pattern V).
 * Flag only: sets strandedAt + strandedReason (+ a `stranded` custody event) and reads them to
 * the ALERTS line. A human decides — nothing here moves money or status. Self-healing: it CLEARS
 * a strand the moment a legitimate action resolves the condition, and clearing RESETS (a
 * re-claimed order strands afresh, never immunised).
 *
 * Proven against lib/patternV with a [0] baseline + positive control:
 *   [0] BASELINE   — a fresh RUNNER_COLLECTED order is NOT stranded; zero-strands ⇒ no ALERT.
 *   [1] SET        — each condition past threshold strands with the RIGHT reason + one event +
 *                    a condition-named ALERTS entry.
 *   [2] THRESHOLD  — an under-threshold order is withheld.
 *   [3] VOIDED     — a voided order never strands (voidedAt: null filter).
 *   [4] IDEMPOTENT — a second sweep writes no second event, leaves strandedAt unchanged.
 *   [5] CLEAR      — resolving the condition clears the strand (+ one `strand_cleared`).
 *   [6] RE-STRAND  — strand → release clears it → re-claim + stall → strands AGAIN (2 `stranded`
 *                    + 1 `strand_cleared`): clearing reset the condition, it did not immunise.
 *
 * Seeds a throwaway (never-protected) event and cleans up.
 * Run:  npx tsx scripts/test-strand-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient, StrandedReason } from '@prisma/client'
import { patternV, type SweepSummary } from '../lib/reconciler'
import { releaseOrder } from '../lib/release-order'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const SLUG = 'strand-', MAIL = '@strand.local', rand = () => Math.random().toString(36).slice(2, 10)
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

function emptySummary(): SweepSummary {
  const zero = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, K: 0, L: 0, M: 0, N: 0, O: 0, P: 0, Q: 0, R: 0, S: 0, T: 0, X: 0 }
  const empty = { A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [], I: [], J: [], K: [], L: [], M: [], N: [], O: [], P: [], Q: [], R: [], S: [], T: [], X: [] }
  return {
    startedAt: '', finishedAt: '', durationMs: 0, dryRun: false, patternEEnabled: false, backstopEnabled: false,
    scanned: { stripePIs: 0, completedOrders: 0, activeOrders: 0, pendingOrders: 0, unresolvedHolds: 0 },
    repaired: { ...zero }, details: { ...empty } as SweepSummary['details'],
    alerted: [], ambiguousSkipped: 0, backstopWarnings: [],
  }
}

const evCount = (orderId: string, type: string) => prisma.deliveryCustodyEvent.count({ where: { orderId, eventType: type } })
const sweep = async () => { const s = emptySummary(); await patternV(s, { maxPerPattern: 5000 }); return s.alerted }

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

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({ data: { name: `STR ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' } })
    const mkUser = async (p: string) => (await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}${p}-${rand()}${MAIL}`, name: p, role: 'customer' } })).id
    const runner = await prisma.runner.create({ data: { eventId: ev.id, userId: await mkUser('r'), status: 'ACTIVE' } })
    const vendor = await prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })

    // A RUNNER_COLLECTED order with tunable custody timestamps.
    const mkOrder = async (extra: Record<string, unknown> = {}) => prisma.order.create({ data: {
      eventId: ev.id, customerId: await mkUser('c'), vendorId: vendor.id,
      status: 'RUNNER_COLLECTED', fulfillmentType: 'HOME_DELIVERY', runnerId: runner.id,
      dispatchedAt: minsAgo(1), // recent by default (not stranded)
      subtotal: 30, fairSynqFee: 3, total: 33, vendorPayout: 30, customerName: 'C', customerPhone: '+10000000000',
      placedAt: new Date(), ...extra,
    } })
    const inAlert = (alerts: string[], needle: string) => alerts.some(a => a.includes(needle))

    // ── [0] BASELINE ────────────────────────────────────────────────────────────
    console.log('[0] baseline: a fresh collected order is not stranded, and emits no alert')
    const fresh = await mkOrder({ dispatchedAt: minsAgo(1) })
    const a0 = await sweep()
    assert((await prisma.order.findUnique({ where: { id: fresh.id }, select: { strandedAt: true } }))?.strandedAt == null, 'fresh order not stranded')
    assert(!inAlert(a0, fresh.id) && !inAlert(a0, '[STRAND'), 'no [STRAND …] alert when nothing is stranded (clean birth)')
    assert((await evCount(fresh.id, 'stranded')) === 0, 'zero stranded events')

    // ── [1] SET — each condition strands with the right reason + one event + alert ──
    console.log('\n[1] each condition past threshold strands, named correctly')
    const cnc = await mkOrder({ dispatchedAt: minsAgo(20), collectedAt: null }) // CLAIMED_NOT_COLLECTED (>15m)
    const unr = await mkOrder({ dispatchedAt: minsAgo(30), collectedAt: minsAgo(15) }) // RUNNER_UNREACHABLE (>10m)
    const avc = await mkOrder({ dispatchedAt: minsAgo(30), collectedAt: minsAgo(20), returnRequestedAt: minsAgo(15) }) // AWAITING (>10m)
    const a1 = await sweep()
    const reasonOf = async (id: string) => (await prisma.order.findUnique({ where: { id }, select: { strandedReason: true } }))?.strandedReason
    assert(await reasonOf(cnc.id) === StrandedReason.CLAIMED_NOT_COLLECTED, 'pre-collection → CLAIMED_NOT_COLLECTED')
    assert(await reasonOf(unr.id) === StrandedReason.RUNNER_UNREACHABLE_WITH_FOOD, 'post-collection → RUNNER_UNREACHABLE_WITH_FOOD')
    assert(await reasonOf(avc.id) === StrandedReason.AWAITING_VENDOR_CONFIRMATION, 'return requested → AWAITING_VENDOR_CONFIRMATION')
    assert(inAlert(a1, '[STRAND CLAIMED_NOT_COLLECTED]') && inAlert(a1, cnc.id), 'CLAIMED alert names the order')
    assert(inAlert(a1, '[STRAND RUNNER_UNREACHABLE_WITH_FOOD]') && inAlert(a1, unr.id), 'UNREACHABLE alert names the order')
    assert(inAlert(a1, '[STRAND AWAITING_VENDOR_CONFIRMATION]') && inAlert(a1, avc.id), 'AWAITING alert names the order')
    assert((await evCount(cnc.id, 'stranded')) === 1, 'one stranded event for the CLAIMED order')

    // ── [2] THRESHOLD — an under-threshold order is withheld ────────────────────
    console.log('\n[2] an under-threshold order is not stranded')
    const young = await mkOrder({ dispatchedAt: minsAgo(5) }) // < 15m
    await sweep()
    assert((await prisma.order.findUnique({ where: { id: young.id }, select: { strandedAt: true } }))?.strandedAt == null, '5m-old claim is withheld (below 15m)')

    // ── [3] VOIDED — never strands ──────────────────────────────────────────────
    console.log('\n[3] a voided order never strands')
    const voided = await mkOrder({ dispatchedAt: minsAgo(60), voidedAt: new Date(), voidReason: 'test' })
    const a3 = await sweep()
    assert((await prisma.order.findUnique({ where: { id: voided.id }, select: { strandedAt: true } }))?.strandedAt == null, 'voided order not stranded')
    assert(!inAlert(a3, voided.id), 'voided order absent from alerts')

    // ── [4] IDEMPOTENT — a second sweep writes no second event ──────────────────
    console.log('\n[4] a second sweep is idempotent')
    const strandedAtBefore = (await prisma.order.findUnique({ where: { id: cnc.id }, select: { strandedAt: true } }))?.strandedAt?.getTime()
    await sweep()
    assert((await evCount(cnc.id, 'stranded')) === 1, 'still exactly one stranded event (no re-fire)')
    assert((await prisma.order.findUnique({ where: { id: cnc.id }, select: { strandedAt: true } }))?.strandedAt?.getTime() === strandedAtBefore, 'strandedAt unchanged on the second sweep')

    // ── [5] CLEAR — resolving the condition clears the strand ───────────────────
    console.log('\n[5] resolving the condition clears the strand')
    await prisma.order.update({ where: { id: cnc.id }, data: { collectedAt: new Date() } }) // now collected (fresh) → no condition
    await sweep()
    const cleared = await prisma.order.findUnique({ where: { id: cnc.id }, select: { strandedAt: true, strandedReason: true } })
    assert(cleared?.strandedAt == null && cleared?.strandedReason == null, 'strand cleared (strandedAt + reason null)')
    assert((await evCount(cnc.id, 'strand_cleared')) === 1, 'one strand_cleared event')

    // ── [6] RE-STRAND — clearing RESETS, does not immunise ──────────────────────
    console.log('\n[6] full cycle: strand → release clears → re-claim → strands AGAIN')
    const cyc = await mkOrder({ dispatchedAt: minsAgo(20) }) // pre-collection, past threshold
    await sweep() // stranded #1
    assert((await evCount(cyc.id, 'stranded')) === 1, 'stranded once')
    const rel = await releaseOrder({ orderId: cyc.id, runnerId: runner.id, eventId: ev.id, actorId: 'test' })
    assert(rel.outcome === 'released', 'released back to the pool (status READY, runnerId null)')
    await sweep() // condition gone (status READY) → clear
    assert((await evCount(cyc.id, 'strand_cleared')) === 1, 'strand cleared by the release')
    // Re-claim + stall again: RUNNER_COLLECTED, fresh runner, dispatchedAt aged.
    await prisma.order.update({ where: { id: cyc.id }, data: { status: 'RUNNER_COLLECTED', runnerId: runner.id, dispatchedAt: minsAgo(20) } })
    await sweep() // stranded #2
    assert((await evCount(cyc.id, 'stranded')) === 2, 'stranded AGAIN after re-claim — clearing reset, did not immunise')
    assert((await evCount(cyc.id, 'strand_cleared')) === 1, 'still exactly one clear (the cycle is honest)')

    console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} strand-guard: ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('💥', e); process.exit(1) })
