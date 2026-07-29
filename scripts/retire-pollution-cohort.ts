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
 * ── WHY IT REQUIRES ALLOW_PROD_WRITES (AND WHAT IS *NOT* PROTECTING IT) ─────────────────────
 * All 76 rows sit on LIVE_PROTECTED_EVENT_ID (Italian Fest 2026).
 *
 * ⚠️ CORRECTION (2026-07-29). This header used to say "prod-write-guard blocks script writes
 * there". IT DOES NOT BLOCK THIS SCRIPT. lib/prod-write-guard's protection lives inside the
 * `guardedPrisma()` client extension, and this script deliberately uses the `lib/db` app
 * singleton instead — because it must run the real app-side audit writer. Nothing in the guard
 * is in this call path.
 *
 * So the `ALLOW_PROD_WRITES !== 'true'` check below is a PLAIN ENV CHECK IN THIS FILE. It is a
 * deliberate-intent speed bump and nothing more: no client-level interception, no per-write
 * eventId inspection, no ProdWriteBlockedError. It happens to be equivalent in effect here
 * (a guarded client would let this through anyway once the flag is set), but the mechanism is
 * not the one the old prose named, and stale prose about a guard is its own failure class.
 *
 * A related hole, reported separately and NOT closed here: prod-write-guard-test's structural
 * sweep greps for the LITERAL event cuid, so this script — which imports LIVE_PROTECTED_EVENT_ID
 * as a symbol — is invisible to it and passes without being allowlisted.
 *
 * ── IDEMPOTENT ──────────────────────────────────────────────────────────────────────────────
 * Only rows still `paid` are touched — enforced in the WHERE clause of the update, not just in
 * the candidate query, so a concurrent writer cannot be clobbered. A second run finds them
 * `cancelled`, changes 0 rows, and writes NO audit. A partial failure mid-run is recovered by
 * re-running, not by hand-inspecting which rows made it.
 *
 * ── ⚠️ WHY THE FIRST APPLY RUN (2026-07-28 22:42Z) LIED, AND WHAT CHANGED ───────────────────
 * It printed `rows cancelled: 76 (301834¢)` and `measured AFTER: paid = 14479¢`. Both were true
 * at the instant they were computed. Minutes later the ledger read 76 rows `paid` again.
 *
 * TWO independent defects, both fixed:
 *
 *   1. THE CAUSE — reconciler Pattern X2 heals a non-`paid` VendorEarning back to `paid` from
 *      any un-reversed Payout row. This cohort's Payout rows are KEPT ON PURPOSE (deleting them
 *      would destroy the evidence the transfer-existence audit names), so X2 read 76 fabricated
 *      transfers as "money moved, ledger lags" and undid the remediation 250ms after the loop
 *      finished — stamping its own `paidAt` and the fabricated `stripeTransferId` as it went.
 *      Fixed at source: patternX now skips the declared cohort (lib/reconciler.ts).
 *
 *   2. THE BLINDNESS — the receipt was built from `toCancel`, the PLAN, and would have printed
 *      76 whether or not anything committed. It is now built from the writes' returned counts,
 *      and the run ends with a re-read that asserts the FINAL state. See lib/retire-cohort.ts.
 *
 * A run that changes nothing now says so, and exits non-zero.
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
import {
  applyCohortRetirement, verifyCohort, formatCohortReceipt,
  type CohortCancelWriter, type CohortVerification,
} from '../lib/retire-cohort'

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

  // ── THE WRITE ──────────────────────────────────────────────────────────────────────────
  //
  // INTERACTIVE transaction, not the `$transaction([update, audit])` array form this script
  // originally used. The array form cannot BRANCH: it writes the audit row unconditionally,
  // even when the update matched nothing. That is a partial write by construction — an audit
  // asserting a cancel that did not happen.
  //
  // `updateMany` with `status: 'paid'` in the WHERE (rather than `update` by id) makes the
  // guard conditional at the database, so a concurrent writer cannot be clobbered, and gives
  // back a COUNT — the only honest input to the receipt.
  const write: CohortCancelWriter = (row) => db.$transaction(async (tx) => {
    const res = await tx.vendorEarning.updateMany({
      where: { id: row.id, status: 'paid' },
      data: { status: 'cancelled' },
    })
    if (res.count === 0) return 0 // nothing changed → no audit row. No un-backed audit, ever.
    await writeMoneyAudit(ACTOR, row.eventId, {
      action: 'CANCEL', payeeType: 'vendor', payeeId: row.vendorId,
      orderId: row.orderId, earningId: row.id, amountCents: row.netCents ?? row.subtotalCents,
      reason: `retired as pollution cohort — ${POLLUTION_COHORT_REASON}`,
      metadata: { previousStatus: 'paid', newStatus: 'cancelled', cohort: '2026-07-16/17', reversedBy: 'remediation' },
    }, tx)
    return res.count
  })

  const receipt = await applyCohortRetirement(toCancel, write)

  // ── THE FINAL-STATE RE-READ ────────────────────────────────────────────────────────────
  // The receipt describes what each write RETURNED. This describes what the ledger now SAYS.
  // They came apart once already (Pattern X2 healed every row back within 250ms), so the run
  // is not reported as successful until this agrees.
  let verification: CohortVerification | null = null
  try {
    const after = await db.vendorEarning.findMany({
      where: { OR: payouts.map(p => ({ orderId: p.orderId!, vendorId: p.vendorId })) },
      select: { orderId: true, status: true },
    })
    verification = verifyCohort(after)
  } catch (e) {
    console.error('final-state re-read FAILED:', e instanceof Error ? e.message : String(e))
  }

  console.log('\n' + formatCohortReceipt(receipt, verification, {
    timestamp: new Date().toISOString(),
    actor: `${ACTOR.id} (${ACTOR.type})`,
    alreadyCancelled: already.length,
  }) + '\n')

  const paidAfter = await db.vendorEarning.aggregate({ _sum: { netCents: true }, where: { status: 'paid' } })
  const cancelledAfter = await db.vendorEarning.aggregate({ _sum: { subtotalCents: true }, where: { status: 'cancelled' } })
  console.log(`  measured AFTER (global): paid = ${paidAfter._sum.netCents ?? 0}¢   cancelled = ${cancelledAfter._sum.subtotalCents ?? 0}¢\n`)

  // EXIT CODE FOLLOWS THE LEDGER, not the loop. A run whose writes all "succeeded" but whose
  // rows did not end up cancelled is a FAILED run and must say so to its caller.
  if (receipt.failed.length || !verification || !verification.ok) process.exit(1)
}

main()
  .catch(e => { console.error('ERR', e instanceof Error ? e.message : String(e)); process.exit(1) })
  .finally(() => db.$disconnect())
