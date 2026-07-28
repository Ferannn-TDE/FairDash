/**
 * THE VENDOR FEE COUPLING — an estimate that predicts, next to a payout that measures.
 *
 * `estimateStripeFeeCents` models the Stripe fee as 2.9% + 30¢. The payout does NOT use those
 * numbers: it reads the REAL settled fee from the balance transaction (`process-payout.ts:334`)
 * and splits it. So the two are joined by nothing mechanical, and option (1) — derive the
 * estimator from the payout's constants — is impossible: THE PAYOUT HAS NO RATE CONSTANT.
 *
 * That leaves guarding the coupling, which is what this file does. Three properties, each the
 * failure of which is silent:
 *
 *   [1] BOTH sides route through splitStripeFee, so the per-vendor SPLIT cannot diverge.
 *   [2] THE VENDOR STILL BEARS THE FEE. payout-split computes
 *       `transferCents = subtotalCents − feeShareCents`. If the fee moved off the vendor leg,
 *       the payout would transfer the FULL slice while every vendor surface kept deducting
 *       ~2.9% + 30¢ — vendors shown LESS than they receive, on every order, with nothing
 *       failing. This is the specific silent drift the estimator is exposed to.
 *   [3] CONSERVATIVENESS. vendor-earnings states "never returns more than the vendor will
 *       actually receive". The estimate must therefore be ≥ the real fee, so take-home is
 *       under-stated, never over-stated. Lowering a constant or dropping the ceil breaks it.
 *
 * Pure logic/file reader — no DB, no Stripe, no network. Scoped to the two modules it names.
 * Run:  npx tsx scripts/vendor-fee-coupling-guard.ts
 */

import { readFileSync } from 'node:fs'
import {
  estimateStripeFeeCents,
  STRIPE_FEE_PCT,
  STRIPE_FEE_FIXED_CENTS,
  computeVendorOrderEarnings,
  type OrderForEarnings,
} from '../lib/vendor-earnings'
import { splitStripeFee } from '../lib/payout-split'
import { stripComments } from './_strip-comments'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

/** The real Stripe fee for a charge under the SAME published model, unrounded. */
const realFeeCents = (totalCents: number) => totalCents * 0.029 + 30

console.log('[0] positive controls on the probe')
assert(estimateStripeFeeCents(0) === 0 && estimateStripeFeeCents(-500) === 0,
  'a zero/negative total estimates no fee (no phantom 30¢ on nothing)')
assert(estimateStripeFeeCents(10_000) > estimateStripeFeeCents(1_000),
  'the estimate grows with the charge (not a constant)')
assert(STRIPE_FEE_PCT > 0 && STRIPE_FEE_FIXED_CENTS > 0, 'both rate components are named and non-zero')

console.log('\n[1] both sides route through the SAME splitter — the split cannot diverge')
const earnings = stripComments(readFileSync('lib/vendor-earnings.ts', 'utf8'))
const payout = stripComments(readFileSync('lib/process-payout.ts', 'utf8'))
assert(/splitStripeFee\(/.test(earnings), 'vendor-earnings splits its ESTIMATED fee with splitStripeFee')
assert(/splitStripeFee\(/.test(payout), 'process-payout splits the REAL fee with the same function')
assert(/bt\.fee/.test(payout),
  'and the payout takes the fee from the balance transaction — it MEASURES, which is why no rate constant is shareable')
// Proven behaviourally, not just by both importing it: the split is exact to the cent.
const subtotals = { v1: 4000, v2: 3000, v3: 1234 }
for (const feeTotal of [175, 300, 1, 9999]) {
  const lines = splitStripeFee(subtotals, feeTotal)
  const summed = lines.reduce((s, l) => s + l.feeShareCents, 0)
  assert(summed === feeTotal, `Σ feeShare === ${feeTotal}¢ exactly (no rounding leak)`)
}

console.log('\n[2] ⛔ THE VENDOR STILL BEARS THE FEE — the premise the estimator depends on')
const split = stripComments(readFileSync('lib/payout-split.ts', 'utf8'))
assert(/transferCents:\s*vendorSubtotalsCents\[id\]\s*-\s*shares\[id\]/.test(split),
  'payout-split still computes transferCents = subtotal − feeShare (the vendor absorbs it)')
// Behavioural twin of the source assertion, so a refactor that preserves intent still passes.
const lines = splitStripeFee({ solo: 5000 }, 175)
assert(lines[0].transferCents === 5000 - lines[0].feeShareCents,
  'and a real split confirms it: the vendor is transferred slice MINUS their fee share')
assert(lines[0].transferCents < 5000,
  'the transfer is strictly less than the slice — if this ever passes at equality, the fee moved and the estimator is wrong')

console.log('\n[3] CONSERVATIVE — the estimate never overstates take-home')
for (const total of [500, 1_000, 2_599, 5_000, 12_345, 100_000]) {
  const est = estimateStripeFeeCents(total)
  assert(est >= realFeeCents(total),
    `total ${total}¢ → estimated fee ${est}¢ ≥ real ${realFeeCents(total).toFixed(2)}¢ (take-home under-stated, never over)`)
}
// The invariant end-to-end: estimated take-home ≤ settled take-home for the same order.
const order = (payoutNet?: number): OrderForEarnings => ({
  total: 50,
  orderItems: [{ vendorId: 'v1', subtotal: 50 }],
  payouts: payoutNet == null ? [] : [{ vendorId: 'v1', netAmount: payoutNet, reversedAt: null }],
  refunds: [], vendorOrderStatuses: [{ vendorId: 'v1', status: 'COMPLETED' }],
})
const estimated = computeVendorOrderEarnings(order(), 'v1')
const settled = computeVendorOrderEarnings(order(50 - realFeeCents(5000) / 100), 'v1')
console.log(`     estimated ${estimated.cents}¢ (${estimated.status})  ≤  settled ${settled.cents}¢ (${settled.status})`)
assert(estimated.status === 'estimated' && settled.status === 'settled', 'the two branches are distinguishable')
assert(estimated.cents <= settled.cents,
  '⛔ estimated take-home ≤ settled — the stated invariant, "never more than the vendor will receive"')
assert(/Math\.ceil/.test(earnings), 'the percentage component is still rounded UP (what makes it conservative)')

console.log('\n[4] the constants are NAMED, so a change to them is visible')
assert(/export const STRIPE_FEE_PCT/.test(earnings) && /export const STRIPE_FEE_FIXED_CENTS/.test(earnings),
  'both rate components are named exports, not literals inside an expression')
assert(!/Math\.ceil\(orderTotalCents \* 0\.029\)/.test(earnings),
  'the inline literal form is gone (it was unfindable by anyone auditing the fee model)')
assert(/scripts\/vendor-fee-coupling-guard/.test(readFileSync('lib/vendor-earnings.ts', 'utf8')),
  'and the constants point at this guard, so the reasoning is findable from the value')

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `✅ vendor-fee-coupling-guard: ${pass} passed, 0 failed` : `❌ vendor-fee-coupling-guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
