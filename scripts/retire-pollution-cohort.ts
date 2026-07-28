/**
 * REMEDIATION — retire the 2026-07-16/17 pollution cohort's VendorEarning rows.
 *
 * ⚠️ DRY-RUN BY DEFAULT. Writes only with `--apply`, and only with `ALLOW_PROD_WRITES=true`.
 *
 * ── WHY THIS IS NOT lib/reverse-accrual.ts ──────────────────────────────────────────────────
 * The obvious move is the shared reverser, and it REFUSES this cohort by design — correctly:
 *   `if (earning.status !== 'accrued') return { skipped: 'not-accrued' }`   ← ours are 'paid'
 *   and it demands the portion's VOS be non-payable                          ← ours are COMPLETED
 * Its own doc gives the reason: *"'paid' → the money already transferred; reversing a sent
 * transfer is the chargeback/clawback domain, NOT this."*
 *
 * That premise — paid means the money moved — is TRUE for every row in the system except these
 * 76, which is the entire reason this cohort is special. Loosening the shared reverser to accept
 * `paid` would permanently weaken a guard protecting every legitimate paid row, to serve a
 * one-time event. So this borrows its SHAPE (single $transaction, honest actor,
 * previousStatus/newStatus metadata) and not its code, with membership narrowed to the declared
 * 76 transfer ids.
 *
 * ── WHY IT NEEDS ALLOW_PROD_WRITES ──────────────────────────────────────────────────────────
 * All 76 rows sit on LIVE_PROTECTED_EVENT_ID (Italian Fest 2026). prod-write-guard blocks script
 * writes there — it was built after three pollution incidents of exactly the class that produced
 * this cohort. The escape hatch is documented for "a deliberate, reviewed prod operation — e.g.
 * a remediation receipt", which is precisely this. The guard is doing its job by making this an
 * explicit act rather than a side effect.
 *
 * ── IDEMPOTENT ──────────────────────────────────────────────────────────────────────────────
 * Only rows still `paid` are touched. A second run finds them `cancelled` and does nothing — no
 * double audit, no second status write. So a partial failure mid-run is recovered by re-running,
 * not by hand-inspecting which rows made it.
 *
 * Usage:
 *   npx tsx scripts/retire-pollution-cohort.ts                    # dry run, writes nothing
 *   ALLOW_PROD_WRITES=true npx tsx scripts/retire-pollution-cohort.ts --apply
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { db } from '../lib/db'
import { writeMoneyAudit } from '../lib/admin-money'
import { POLLUTED_TRANSFER_IDS, POLLUTION_COHORT_REASON } from '../lib/pollution-cohort'
import { LIVE_PROTECTED_EVENT_ID } from '../lib/prod-write-guard'

const APPLY = process.argv.includes('--apply')
const ACTOR = { id: 'remediation:pollution-cohort-2026-07-28', type: 'system' as const }

async function main() {
  const ids = [...POLLUTED_TRANSFER_IDS]
  console.log(`\n${'═'.repeat(72)}`)
  console.log(`  RETIRE POLLUTION COHORT — ${APPLY ? '⚠️  APPLY (WRITES)' : 'DRY RUN (writes nothing)'}`)
  console.log(`${'═'.repeat(72)}\n`)

  const payouts = await db.payout.findMany({
    where: { stripeTransferId: { in: ids } },
    select: { stripeTransferId: true, orderId: true, vendorId: true, eventId: true, netAmount: true },
  })
  console.log(`declared transfer ids : ${ids.length}`)
  console.log(`matching Payout rows  : ${payouts.length}`)

  const offEvent = payouts.filter(p => p.eventId !== LIVE_PROTECTED_EVENT_ID)
  if (offEvent.length) {
    console.error(`\n❌ ABORT — ${offEvent.length} cohort row(s) are NOT on the expected event. Scope is wrong; investigate.`)
    process.exit(1)
  }
  console.log(`all on LIVE_PROTECTED_EVENT_ID : yes`)

  const earnings = await db.vendorEarning.findMany({
    where: { OR: payouts.map(p => ({ orderId: p.orderId!, vendorId: p.vendorId })) },
    select: { id: true, orderId: true, vendorId: true, eventId: true, status: true, subtotalCents: true, netCents: true },
  })
  const toCancel = earnings.filter(e => e.status === 'paid')
  const already = earnings.filter(e => e.status === 'cancelled')
  const other = earnings.filter(e => e.status !== 'paid' && e.status !== 'cancelled')

  console.log(`\nVendorEarning rows found : ${earnings.length}`)
  console.log(`  status 'paid'      → will cancel : ${toCancel.length}  (${toCancel.reduce((s, e) => s + (e.netCents ?? 0), 0)}¢)`)
  console.log(`  status 'cancelled' → already done: ${already.length}   ← idempotent, untouched`)
  if (other.length) {
    console.log(`  ⚠️ OTHER statuses (NOT touched): ${other.map(o => `${o.orderId}:${o.status}`).join(', ')}`)
  }

  if (!APPLY) {
    console.log(`\n${'─'.repeat(72)}`)
    console.log(`  DRY RUN — NOTHING WAS WRITTEN.`)
    console.log(`  ⚠️  THE LEDGER IS STILL UNCORRECTED. Until this runs with --apply, the admin`)
    console.log(`      money page and the sweep summary still report the inflated paid= figure.`)
    console.log(`      The vendor-facing display is ALREADY correct (the excluded filter ships`)
    console.log(`      with the code) — so the vendor-facing lie is closed and the admin-facing`)
    console.log(`      one remains, visible to someone who knows why.`)
    console.log(`\n  To apply:  ALLOW_PROD_WRITES=true npx tsx scripts/retire-pollution-cohort.ts --apply`)
    console.log(`${'─'.repeat(72)}\n`)
    return
  }

  if (process.env.ALLOW_PROD_WRITES !== 'true') {
    console.error('\n❌ REFUSED — --apply requires ALLOW_PROD_WRITES=true (prod-write-guard).')
    process.exit(1)
  }

  // ── THE RECEIPT ────────────────────────────────────────────────────────────────────────
  const receipt: { orderId: string; vendorId: string; from: string; to: string; cents: number }[] = []
  for (const e of toCancel) {
    // Same shape as the shared reverser: status flip and audit in ONE transaction, so a failed
    // audit rolls the cancel back. There is no un-audited money-state change.
    await db.$transaction([
      db.vendorEarning.update({ where: { id: e.id }, data: { status: 'cancelled' } }),
      writeMoneyAudit(ACTOR, e.eventId, {
        action: 'CANCEL', payeeType: 'vendor', payeeId: e.vendorId,
        orderId: e.orderId, earningId: e.id, amountCents: e.netCents ?? e.subtotalCents,
        reason: `retired as pollution cohort — ${POLLUTION_COHORT_REASON}`,
        metadata: { previousStatus: 'paid', newStatus: 'cancelled', cohort: '2026-07-16/17', reversedBy: 'remediation' },
      }),
    ])
    receipt.push({ orderId: e.orderId, vendorId: e.vendorId, from: 'paid', to: 'cancelled', cents: e.netCents ?? 0 })
  }

  const paidAfter = await db.vendorEarning.aggregate({ _sum: { netCents: true }, where: { status: 'paid' } })
  const cancelledAfter = await db.vendorEarning.aggregate({ _sum: { subtotalCents: true }, where: { status: 'cancelled' } })

  console.log(`\n${'═'.repeat(72)}`)
  console.log(`  RECEIPT — fourth pollution incident, resolved`)
  console.log(`${'═'.repeat(72)}`)
  console.log(`  timestamp        : ${new Date().toISOString()}`)
  console.log(`  actor            : ${ACTOR.id} (${ACTOR.type})`)
  console.log(`  rows cancelled   : ${receipt.length}  (${receipt.reduce((s, r) => s + r.cents, 0)}¢)`)
  console.log(`  already cancelled: ${already.length} (untouched, idempotent)`)
  console.log(`  measured AFTER   : paid = ${paidAfter._sum.netCents ?? 0}¢   cancelled = ${cancelledAfter._sum.subtotalCents ?? 0}¢`)
  console.log(`\n  rows:`)
  for (const r of receipt) console.log(`    ${r.orderId}  vendor ${r.vendorId}  ${r.from} → ${r.to}  ${r.cents}¢`)
  console.log(`${'═'.repeat(72)}\n`)
}

main()
  .catch(e => { console.error('ERR', e instanceof Error ? e.message : String(e)); process.exit(1) })
  .finally(() => db.$disconnect())
