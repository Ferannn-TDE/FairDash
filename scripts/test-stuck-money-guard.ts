/**
 * STUCK-MONEY READER (Pattern U) — a permanently-failed payout must not be a flag with no
 * reader. The worker durably marks a failed payout (vendor: order.payoutStatus='FAILED';
 * runner: RunnerEarning.status='failed'; organizer: OrganizerPayout.status='failed') and
 * writes a PAYOUT_FAILED audit; Pattern U reads those and alerts, condition-named, with
 * count/$total/ids, past a per-condition threshold (15m for failed; the audit createdAt is
 * the failed-since clock, since the marker rows carry no updatedAt).
 *
 * Proven directly (no Stripe, no full sweep) with a positive control AND the two ways it must
 * NOT fire, or a "detected stuck money" assertion is vacuous:
 *   • POSITIVE  — a >15m-old failed vendor / runner / organizer payout each alerts, by id.
 *   • BASELINE  — a healthy PAID runner earning never appears (paid ≠ failed).
 *   • THRESHOLD — a failed runner earning only 5m old is withheld (auto-retry still has time).
 *
 * Seeds a throwaway (never-protected) event and cleans up — same discipline as the reverser
 * guard; writes only to its own event, safe against the prod DB.
 *
 * Run:  npx tsx scripts/test-stuck-money-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { patternU, type SweepSummary } from '../lib/reconciler'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const SLUG = 'stuck-', MAIL = '@stuck.local', rand = () => Math.random().toString(36).slice(2, 10)
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

function emptySummary(): SweepSummary {
  const zero = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, K: 0, L: 0, M: 0, N: 0, O: 0, P: 0, Q: 0, R: 0, S: 0, T: 0 }
  return {
    startedAt: '', finishedAt: '', durationMs: 0, dryRun: false, patternEEnabled: false, backstopEnabled: false,
    scanned: { stripePIs: 0, completedOrders: 0, activeOrders: 0, pendingOrders: 0, unresolvedHolds: 0 },
    repaired: { ...zero }, details: { A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [], I: [], J: [], K: [], L: [], M: [], N: [], O: [], P: [], Q: [], R: [], S: [], T: [] },
    alerted: [], ambiguousSkipped: 0, backstopWarnings: [],
  }
}

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    const w = { where: { eventId: { in: ids } } }
    await prisma.adminMoneyAction.deleteMany(w)
    await prisma.runnerEarning.deleteMany(w)
    await prisma.organizerPayout.deleteMany(w)
    await prisma.vendorEarning.deleteMany(w)
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
    const ev = await prisma.event.create({ data: { name: `STUCK ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' } })
    const cust = async () => (await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}c-${rand()}${MAIL}`, name: 'C', role: 'customer' } })).id
    const runnerUser = await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}r-${rand()}${MAIL}`, name: 'R', role: 'customer' } })
    const runner = await prisma.runner.create({ data: { eventId: ev.id, userId: runnerUser.id, status: 'OFFLINE' } })
    const vendor = await prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })

    const mkOrder = async (extra: Record<string, unknown>) => prisma.order.create({ data: {
      eventId: ev.id, customerId: await cust(), vendorId: vendor.id, status: 'DELIVERED', fulfillmentType: 'HOME_DELIVERY',
      subtotal: 30, fairSynqFee: 3, total: 33, vendorPayout: 30, customerName: 'C', customerPhone: '+10000000000',
      placedAt: new Date(), ...extra,
    } })
    const auditFailed = async (payeeType: string, payeeId: string, orderId: string | null, cents: number, when: Date) =>
      prisma.adminMoneyAction.create({ data: {
        actorId: 'worker:test', actorType: 'system', action: 'PAYOUT_FAILED', eventId: ev.id,
        payeeType, payeeId, orderId, amountCents: cents, reason: 'test', createdAt: when,
      } })

    // ── POSITIVE: three payouts failed >15m ago ────────────────────────────────
    const vOrder = await mkOrder({ payoutStatus: 'FAILED' })
    await auditFailed('vendor', vendor.id, vOrder.id, 3000, minsAgo(20))

    const rOrderStuck = await mkOrder({})
    await prisma.runnerEarning.create({ data: { eventId: ev.id, orderId: rOrderStuck.id, runnerId: runner.id, amountCents: 1200, status: 'failed' } })
    await auditFailed('runner', runner.id, rOrderStuck.id, 1200, minsAgo(20))

    const oBatch = await prisma.organizerPayout.create({ data: { eventId: ev.id, totalCents: 5000, status: 'failed' } })
    await auditFailed('organizer', ev.id, null, 5000, minsAgo(20))

    // ── BASELINE: a healthy PAID runner earning — must never surface ────────────
    const rOrderPaid = await mkOrder({})
    await prisma.runnerEarning.create({ data: { eventId: ev.id, orderId: rOrderPaid.id, runnerId: runner.id, amountCents: 999, status: 'paid', stripeTransferId: `tr_${rand()}`, paidAt: new Date() } })

    // ── THRESHOLD: a failed runner earning only 5m old — withheld (retry has time) ─
    const rOrderRecent = await mkOrder({})
    await prisma.runnerEarning.create({ data: { eventId: ev.id, orderId: rOrderRecent.id, runnerId: runner.id, amountCents: 700, status: 'failed' } })
    await auditFailed('runner', runner.id, rOrderRecent.id, 700, minsAgo(5))

    // ── run the reader ──────────────────────────────────────────────────────────
    const sum = emptySummary()
    await patternU(sum, { maxPerPattern: 5000 })
    const alerts = sum.alerted
    const inAlert = (needle: string) => alerts.some(a => a.includes(needle))
    const vendorAlert = alerts.find(a => a.includes('[STUCK-MONEY vendor]'))
    const runnerAlert = alerts.find(a => a.includes('[STUCK-MONEY runner]'))
    const orgAlert = alerts.find(a => a.includes('[STUCK-MONEY organizer]'))

    // ── [0] BASELINE (positive control on the probe) — paid never appears ───────
    console.log('[0] baseline: a healthy PAID runner earning is absent from every alert')
    assert(!inAlert(rOrderPaid.id), 'the paid runner order id is in NO stuck alert (paid ≠ failed — the reader distinguishes)')

    // ── [1] POSITIVE — each failed leg alerts, by id ────────────────────────────
    console.log('\n[1] each >15m-failed payout surfaces, named by condition and id')
    assert(!!vendorAlert && vendorAlert.includes(vOrder.id), 'vendor: [STUCK-MONEY vendor] names the failed order')
    assert(!!runnerAlert && runnerAlert.includes(rOrderStuck.id), 'runner: [STUCK-MONEY runner] names the failed order')
    assert(!!orgAlert && orgAlert.includes(oBatch.id), 'organizer: [STUCK-MONEY organizer] names the failed batch')

    // ── [2] THRESHOLD — the 5m-old failure is withheld ──────────────────────────
    console.log('\n[2] the 5m-old failed runner earning is NOT alerted (below the 15m gate)')
    assert(!inAlert(rOrderRecent.id), 'the recent (5m) failed order id is withheld — auto-retry still has time')

    // ── [3] WALLPAPER-RESISTANCE — the alert carries count, $total, new/standing ─
    console.log('\n[3] the alert is actionable at a glance: count, $total, new/standing')
    assert(!!runnerAlert && /\d+ failed >15m/.test(runnerAlert), 'carries a count and the >15m threshold')
    assert(!!runnerAlert && runnerAlert.includes('$12.00'), 'carries the $total (runner $12.00)')
    assert(!!runnerAlert && /\(\d+ new, \d+ standing\)/.test(runnerAlert), 'distinguishes new vs standing so a fresh failure never hides')
    assert(!!vendorAlert && vendorAlert.includes('$30.00'), 'vendor alert carries $30.00 total')

    console.log(`\n${'─'.repeat(52)}`)
    console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
  }
}

main()
  .then(() => prisma.$disconnect().then(() => process.exit(fail === 0 ? 0 : 1)))
  .catch(async (e) => { console.error('\n💥', e); await prisma.$disconnect(); process.exit(1) })
