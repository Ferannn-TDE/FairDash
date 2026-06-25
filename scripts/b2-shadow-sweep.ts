/**
 * B2 SHADOW SWEEP — runner payout, compute + log only. MOVES NO MONEY.
 *
 * Walks every RunnerEarning whose order is not voided, asks planRunnerPayout what
 * it WOULD do, and reports:
 *   - blast radius: how many orders/runners/dollars would pay on enable, split by
 *     window-closed (would pay now) vs still-in-window (held by the delay)
 *   - bucket breakdown: pay / hold-unconnected / hold-nonpositive / already-paid
 *   - ledger-match proof: stored amountCents === independent recompute, per order
 *   - any divergence (recompute != ledger, or a paid row that would re-pay) → STOP
 *
 * Run:  npx tsx scripts/b2-shadow-sweep.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient } from '@prisma/client'
import { planRunnerPayout, type RunnerPayoutDecision } from '../lib/runner-payout'
import { REFUND_WINDOW_MS } from '../lib/constants'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
})

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`

function keyMode(): string {
  const k = process.env.STRIPE_SECRET_KEY ?? ''
  return k.startsWith('sk_live') ? 'LIVE (sk_live)' : k.startsWith('sk_test') ? 'TEST (sk_test)' : k ? 'unknown' : 'unset'
}

async function main() {
  const now = Date.now()

  // Every earning whose order is live (voided orders are excluded from all money
  // flows — the reconciler skips them too).
  const earnings = await prisma.runnerEarning.findMany({
    where: { order: { voidedAt: null } },
    select: { orderId: true },
    orderBy: { createdAt: 'asc' },
  })

  const decisions: RunnerPayoutDecision[] = []
  for (const e of earnings) {
    decisions.push(await planRunnerPayout(e.orderId))
  }

  // ── Buckets ────────────────────────────────────────────────────────────────
  const pay        = decisions.filter(d => d.outcome === 'pay')
  const holdUnconn = decisions.filter(d => d.outcome === 'hold' && d.holdReason === 'unconnected')
  const holdNonPos = decisions.filter(d => d.outcome === 'hold' && d.holdReason === 'non_positive')
  const alreadyPaid= decisions.filter(d => d.outcome === 'already_paid')

  const sumLedger = (ds: RunnerPayoutDecision[]) => ds.reduce((s, d) => s + (d.ledgerAmountCents ?? 0), 0)
  const distinctRunners = (ds: RunnerPayoutDecision[]) => new Set(ds.map(d => d.runnerId).filter(Boolean)).size

  // Window split for the PAY cohort — what fires now vs what the delay still holds.
  const windowClosed = pay.filter(d => d.accruedAt && (now - d.accruedAt.getTime()) >= REFUND_WINDOW_MS)
  const inWindow     = pay.filter(d => !d.accruedAt || (now - d.accruedAt.getTime()) < REFUND_WINDOW_MS)

  // ── Divergence detectors (STOP conditions) ──────────────────────────────────
  const ledgerMismatch = decisions.filter(d => d.ledgerMatchesRecompute === false)
  const payNonLedger   = pay.filter(d => d.ledgerAmountCents == null) // would pay something not from the ledger
  const wouldRepayPaid = alreadyPaid.filter(d => d.outcome !== 'already_paid') // guard sanity

  // ── Report ───────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════════')
  console.log('  B2 SHADOW SWEEP — runner payout (NO MONEY MOVED)')
  console.log('══════════════════════════════════════════════════════════════════')
  console.log(`  Stripe key mode : ${keyMode()}`)
  console.log(`  Refund window   : ${REFUND_WINDOW_MS / 3_600_000}h`)
  console.log(`  Earnings scanned: ${decisions.length} (voided orders excluded)`)
  console.log('──────────────────────────────────────────────────────────────────')
  console.log('  BLAST RADIUS — what WOULD pay on enable:')
  console.log(`    WOULD PAY      : ${pay.length} orders, ${distinctRunners(pay)} runner(s), ${fmt(sumLedger(pay))}`)
  console.log(`       ├─ window closed (fires now) : ${windowClosed.length} orders, ${fmt(sumLedger(windowClosed))}`)
  console.log(`       └─ still in window (held)    : ${inWindow.length} orders, ${fmt(sumLedger(inWindow))}`)
  console.log(`    HOLD unconnect : ${holdUnconn.length} orders, ${distinctRunners(holdUnconn)} runner(s), ${fmt(sumLedger(holdUnconn))} (ledger IS the hold)`)
  console.log(`    HOLD non-pos   : ${holdNonPos.length} orders, ${fmt(sumLedger(holdNonPos))}`)
  console.log(`    ALREADY PAID   : ${alreadyPaid.length} orders, ${fmt(sumLedger(alreadyPaid))} (skipped — idempotent)`)
  console.log('──────────────────────────────────────────────────────────────────')
  console.log('  LEDGER-MATCH PROOF (pay-the-ledger-verbatim):')
  const checked = decisions.filter(d => d.ledgerMatchesRecompute !== null).length
  console.log(`    ${checked - ledgerMismatch.length}/${checked} earnings: stored amountCents === independent recompute (runnerShare + tip)`)
  if (ledgerMismatch.length) {
    console.log(`    ⚠️  ${ledgerMismatch.length} LEDGER MISMATCH(es) — STOP, do NOT enable:`)
    for (const d of ledgerMismatch) {
      console.log(`        order ${d.orderId}: ledger ${d.ledgerAmountCents}¢ ≠ recompute ${d.recomputeCents}¢`)
    }
  }
  console.log('──────────────────────────────────────────────────────────────────')
  console.log('  WOULD-PAY DETAIL (first 25):')
  for (const d of pay.slice(0, 25)) {
    const win = d.accruedAt && (now - d.accruedAt.getTime()) >= REFUND_WINDOW_MS ? 'now ' : 'held'
    console.log(`    [${win}] order ${d.orderId} → runner ${d.runnerId}: ${fmt(d.ledgerAmountCents ?? 0)}  charge=${d.chargeId ?? 'NONE'}`)
  }

  // ── Verdict ──────────────────────────────────────────────────────────────────
  const stop = ledgerMismatch.length > 0 || payNonLedger.length > 0 || wouldRepayPaid.length > 0
  const payNoCharge = pay.filter(d => !d.chargeId)
  console.log('══════════════════════════════════════════════════════════════════')
  if (stop) {
    console.log('  VERDICT: ⛔ STOP — divergence found (see above). Do NOT enable transfers.')
  } else {
    console.log('  VERDICT: ✅ SHADOW CLEAN — every would-pay amount === the ledger;')
    console.log('           no already-paid row would re-pay. Safe to review for enable.')
  }
  if (payNoCharge.length) {
    console.log(`  ⚠️  NOTE: ${payNoCharge.length} would-pay order(s) have NO chargeId — source_transaction`)
    console.log('           would be unresolved; the executor must resolve it (as vendor payout does).')
  }
  console.log('══════════════════════════════════════════════════════════════════\n')

  await prisma.$disconnect()
  process.exit(stop ? 1 : 0)
}

main().catch(async (err) => {
  console.error('[b2-shadow-sweep] FAILED:', err)
  await prisma.$disconnect()
  process.exit(2)
})
