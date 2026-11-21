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
 * UPDATED 2026-11-19 (item 10 stage 4): feeModel 2 (Exhibit A) orders are estimated and paid with
 * the Exhibit A weights instead of splitStripeFee. [5] holds the same three properties for them,
 * with a planted break; [1]–[4] stay as the legacy (feeModel null) half.
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
import { estimateExhibitAVendorShareCents } from '../lib/vendor-earnings'
import { planExhibitAPayout, nominalWeights } from '../lib/fees/exhibit-a'
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
  status: 'COMPLETED',
  feeModel: null, cardFeesPaidBy: null, vendorTaxes: [],
  orderItems: [{ vendorId: 'v1', subtotal: 50 }],
  payouts: payoutNet == null ? [] : [{ vendorId: 'v1', netAmount: payoutNet, reversedAt: null, stripeTransferId: 'tr_realLookingId_000000001' }],
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

console.log('\n[5] feeModel 2 (Exhibit A): same weights both sides, vendor bears its share, estimate conservative')
const feeSplit = stripComments(readFileSync('lib/fee-split.ts', 'utf8'))
assert(/nominalWeights\(/.test(earnings), 'vendor-earnings estimates a feeModel 2 share with nominalWeights (the payout\'s weights)')
assert(/planExhibitAPayout\(/.test(feeSplit) && /ensureOrderFeeSplit\(/.test(payout),
  'the payout splits a feeModel 2 REAL fee with planExhibitAPayout (via ensureOrderFeeSplit), which weights with nominalWeights')
assert(/order\.feeModel === FEE_MODEL_EXHIBIT_A/.test(earnings) && /order\.feeModel === FEE_MODEL_EXHIBIT_A/.test(payout),
  'both sides branch on the order\'s stored feeModel (never today\'s setting)')
const booth = planExhibitAPayout({ vendorFoodCents: { v1: 5000 }, serviceFeeCents: 750, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: 197, cardFeesPaidBy: 'VENDOR' })
assert(booth.vendorPayoutCents.v1 === 5000 - booth.feeShares.v1 && booth.feeShares.v1 > 0,
  'VENDOR mode: the vendor is paid food MINUS its share (the estimate deducts a share for the same reason)')
const plat = planExhibitAPayout({ vendorFoodCents: { v1: 5000 }, serviceFeeCents: 750, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: 197, cardFeesPaidBy: 'PLATFORM' })
assert(plat.vendorPayoutCents.v1 === 5000, 'PLATFORM mode: the vendor is paid the full food, so its estimate deducts nothing')
const m2 = (cardFeesPaidBy: string, payoutNet?: number): OrderForEarnings => ({
  total: 57.50, status: 'COMPLETED', feeModel: 2, cardFeesPaidBy, vendorTaxes: [],
  orderItems: [{ vendorId: 'v1', subtotal: 50 }],
  payouts: payoutNet == null ? [] : [{ vendorId: 'v1', netAmount: payoutNet, reversedAt: null, stripeTransferId: 'tr_realLookingId_000000002' }],
  refunds: [], vendorOrderStatuses: [{ vendorId: 'v1', status: 'COMPLETED' }],
})
const est2 = computeVendorOrderEarnings(m2('VENDOR'), 'v1').cents
console.log(`     $50 booth, feeModel 2: estimated ${est2}¢ ≤ real payout ${booth.vendorPayoutCents.v1}¢ (real fee 197¢)`)
assert(est2 <= booth.vendorPayoutCents.v1 && est2 >= booth.vendorPayoutCents.v1 - 1, '$50 booth: estimate ≤ the real 4825¢ and within 1¢ of it')
assert(computeVendorOrderEarnings(m2('PLATFORM'), 'v1').cents === 5000, 'PLATFORM: the estimate is exact (5000¢)')
assert(computeVendorOrderEarnings(m2('VENDOR', 48.25), 'v1').cents === 4825, 'after payout the settled figure is the real one')
// Conservative for EVERY real fee up to the prediction, on random multi-vendor orders.
// The PROBE: an estimator rounding DOWN instead of up must be caught by the same loop (planted break).
const floorEst = (food: Record<string, number>, total: number, id: string) => {
  const parties = nominalWeights({ vendorFoodCents: food, serviceFeeCents: total - Object.values(food).reduce((a, b) => a + b, 0), curbsideFeeCents: 0, tipCents: 0 })
  const W = parties.reduce((a, p) => a + p.weight, 0)
  return Math.floor(estimateStripeFeeCents(total) * parties.find(p => p.key === id)!.weight / W)
}
let seed = 42
const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
let checked = 0, over = 0, plantedCaught = 0
for (let t = 0; t < 600; t++) {
  const nV = 1 + rnd(5)
  const food: Record<string, number> = {}
  for (let i = 0; i < nV; i++) food[`v${i}`] = 100 + rnd(8000)
  const F = Object.values(food).reduce((a, b) => a + b, 0)
  const service = Math.floor(F * 0.15 + 0.5), curb = rnd(2) ? 399 : 0, tip = curb ? rnd(800) : 0
  const total = F + service + curb + tip
  const P = estimateStripeFeeCents(total)
  for (const realFee of [P, P - 1, Math.floor(P * 0.9), rnd(P + 1)]) {
    const plan = planExhibitAPayout({ vendorFoodCents: food, serviceFeeCents: service, curbsideFeeCents: curb, tipCents: tip, realStripeFeeCents: realFee, cardFeesPaidBy: 'VENDOR' })
    for (const id of Object.keys(food)) {
      checked++
      if (food[id] - estimateExhibitAVendorShareCents(food, total, id) > plan.vendorPayoutCents[id]) over++
      if (food[id] - floorEst(food, total, id) > plan.vendorPayoutCents[id]) plantedCaught++
    }
  }
}
console.log(`     ${checked} vendor slices, real fee ≤ prediction: ${over} estimates above the real payout; planted floor-rounding: ${plantedCaught}`)
assert(plantedCaught > 0, '[0] planted break: a ROUND-DOWN estimator is caught by this loop (the probe can fail)')
assert(over === 0, '⛔ feeModel 2: estimated take-home ≤ real payout whenever the real fee ≤ the prediction')
// Documented, not hidden: a fee ABOVE the prediction can pay below the estimate (the wording says so).
const hi = planExhibitAPayout({ vendorFoodCents: { v1: 5000 }, serviceFeeCents: 750, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: 260, cardFeesPaidBy: 'VENDOR' })
assert(hi.vendorPayoutCents.v1 < est2, `a 260¢ fee (above the 197¢ prediction) pays ${hi.vendorPayoutCents.v1}¢ < estimate ${est2}¢ — the case the "some cards cost more" wording covers`)

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `✅ vendor-fee-coupling-guard: ${pass} passed, 0 failed` : `❌ vendor-fee-coupling-guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
