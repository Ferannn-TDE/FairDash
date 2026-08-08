/**
 * REMEDIATION RECEIPT — close the vendor lanes left open by the asserted-terminal paths.
 *
 * THE BACKLOG this clears: three asserted master terminals (UNDELIVERABLE / UNCOLLECTED /
 * operator CANCELLED) advanced the order and never touched the per-vendor rows, so the lane
 * stayed at whatever it was. Those orders sat in a vendor's LIVE queue indefinitely (one had been
 * in Randy's "Ready" lane for 52 days) and kept quoting "pending" take-home, because the
 * estimator treats any non-failed lane without a payout as money owed.
 *
 * The forward fix is in reconcileMasterStatus. This script is only for rows that predate it.
 *
 * ⚠️ WHY THIS DOES NOT CALL reconcileMasterStatus. These orders are ALREADY at their terminal
 * master status, so `canAdvance(<terminal>, anything)` is false: the reconcile no-ops on the
 * monotonic guard and returns before it ever reaches the lane-close. The guard is right to refuse
 * — resurrecting a terminal order is the exact race it exists to block — so the backfill applies
 * the SAME shared policy function (vendorLaneClosePlan) directly. That function is the single
 * source of the mapping; nothing here re-describes which status closes to what.
 *
 * IDEMPOTENT AND FINAL-STATE ASSERTED, per the money-op rule: every update is status-conditional,
 * so a re-run matches nothing, and the receipt below is a RE-READ of the rows afterwards — never
 * the plan's own expectation. A mid-run failure resumes cleanly rather than half-applying.
 *
 * DRY RUN BY DEFAULT.  npx tsx scripts/close-dangling-vendor-lanes.ts
 * To write:            ALLOW_PROD_WRITES=true npx tsx scripts/close-dangling-vendor-lanes.ts --apply
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { guardedPrisma } from '../lib/prod-write-guard'
import { vendorLaneClosePlan, type LaneClosingTarget } from '../lib/reconcile-order-status'
import { computeVendorOrderEarnings } from '../lib/vendor-earnings'

const prisma = guardedPrisma()
const APPLY = process.argv.includes('--apply')
const OPEN = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY']
const TERMINALS: LaneClosingTarget[] = ['UNDELIVERABLE', 'UNCOLLECTED', 'CANCELLED']
const money = (c: number) => `$${(c / 100).toFixed(2)}`
const short = (id: string) => '#' + id.slice(-8).toUpperCase()

const ORDER_SELECT = {
  id: true, status: true, total: true,
  orderItems: { select: { vendorId: true, subtotal: true } },
  payouts: { select: { vendorId: true, netAmount: true, reversedAt: true, stripeTransferId: true } },
  refunds: { select: { vendorId: true, status: true, amountCents: true } },
  vendorOrderStatuses: { select: { vendorId: true, status: true, vendor: { select: { name: true } } } },
} as const

/** Orders whose master is a terminal override but which still carry an open vendor lane. */
async function findDangling() {
  return prisma.order.findMany({
    where: { status: { in: TERMINALS }, voidedAt: null, vendorOrderStatuses: { some: { status: { in: OPEN } } } },
    orderBy: { placedAt: 'asc' },
    select: ORDER_SELECT,
  })
}

/** Per-lane earnings, read exactly the way every vendor surface reads them. */
function lanes(o: Awaited<ReturnType<typeof findDangling>>[number]) {
  return o.vendorOrderStatuses.map(v => ({
    vendorId: v.vendorId, name: v.vendor.name, vos: v.status,
    cents: computeVendorOrderEarnings(o, v.vendorId).cents,
  }))
}

async function main() {
  console.log(`\n${'═'.repeat(78)}`)
  console.log(`  CLOSE DANGLING VENDOR LANES — ${APPLY ? '⚠️  APPLY (writing)' : 'DRY RUN (no writes)'}`)
  console.log('═'.repeat(78))

  const before = await findDangling()
  if (before.length === 0) { console.log('\n  Nothing to do — no dangling lanes.\n'); return }

  // ── BEFORE ────────────────────────────────────────────────────────────────
  let beforeTotal = 0
  const expected = new Map<string, string>() // `${orderId}|${vendorId}` → expected VOS
  console.log('\nBEFORE')
  for (const o of before) {
    console.log(`\n  ${short(o.id)}  master=${o.status}`)
    const plan = vendorLaneClosePlan(o.status as LaneClosingTarget)
    for (const l of lanes(o)) {
      beforeTotal += l.cents
      const rule = plan.find(p => (p.from as readonly string[]).includes(l.vos))
      const to = rule?.to
      expected.set(`${o.id}|${l.vendorId}`, to ?? l.vos)
      const verdict = !to ? 'UNTOUCHED (terminal already)'
        : to === 'DECLINED' ? `→ DECLINED  ($0 — work never started)`
        : `→ CANCELLED (paid — work was done)`
      console.log(`      ${l.vos.padEnd(10)} ${money(l.cents).padStart(8)}  "${l.name}"  ${verdict}`)
    }
  }

  // ── APPLY ─────────────────────────────────────────────────────────────────
  if (!APPLY) {
    console.log(`\n  DRY RUN — re-run with --apply (and ALLOW_PROD_WRITES=true) to write.\n`)
    return
  }
  let updated = 0
  for (const o of before) {
    const plan = vendorLaneClosePlan(o.status as LaneClosingTarget)
    // One transaction per order: an order's lanes close together or not at all.
    const results = await prisma.$transaction(
      plan.map(({ from, to }) => prisma.vendorOrderStatus.updateMany({
        where: { orderId: o.id, status: { in: from as unknown as string[] } },
        data: { status: to },
      })),
    )
    const n = results.reduce((s, r) => s + r.count, 0)
    updated += n
    console.log(`\n  ${short(o.id)}: ${n} lane(s) closed`)
  }

  // ── AFTER — a RE-READ, never the plan's own expectation ───────────────────
  const afterOrders = await prisma.order.findMany({ where: { id: { in: before.map(o => o.id) } }, select: ORDER_SELECT })
  let afterTotal = 0
  console.log('\nAFTER (re-read from the database)')
  let mismatches = 0
  for (const o of afterOrders) {
    console.log(`\n  ${short(o.id)}  master=${o.status}`)
    for (const l of lanes(o)) {
      afterTotal += l.cents
      const want = expected.get(`${o.id}|${l.vendorId}`)
      const ok = l.vos === want
      if (!ok) mismatches++
      console.log(`      ${ok ? '✅' : '❌'} ${l.vos.padEnd(10)} ${money(l.cents).padStart(8)}  "${l.name}"${ok ? '' : `  (expected ${want})`}`)
    }
  }

  const stillDangling = await findDangling()
  console.log(`\n${'─'.repeat(78)}`)
  console.log(`  lanes closed:      ${updated}`)
  console.log(`  earnings before:   ${money(beforeTotal)}`)
  console.log(`  earnings after:    ${money(afterTotal)}`)
  console.log(`  NET CHANGE:        ${afterTotal - beforeTotal >= 0 ? '+' : '−'}${money(Math.abs(afterTotal - beforeTotal))}`)
  console.log(`  dangling orders remaining: ${stillDangling.length}`)
  console.log(`  final-state mismatches:    ${mismatches}`)
  console.log('─'.repeat(78) + '\n')
  if (mismatches > 0 || stillDangling.length > 0) process.exit(1)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async e => { console.error('\n💥', e); await prisma.$disconnect(); process.exit(1) })
