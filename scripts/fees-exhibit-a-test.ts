/**
 * EXHIBIT A FEES — STAGE 1 (Batch 1 item 10, B1.13): pure functions, no DB, no wiring.
 *
 *   [1] Service fee and price: 0¢, half-cent rounding, flat-only, pct-only, the $50 booth (5750)
 *       and curbside (6149) totals, input validation
 *   [2] The largest-remainder split: exactness, ties, fee smaller than the number of parties
 *   [3] Exhibit A payouts: the $50 booth case 5750 / 4825 / 728; $50 curbside; 2 and 4 vendors
 *       (30¢ by food share, C-1 a); a real fee above and below nominal (Amex); PLATFORM mode (C-3)
 *   [4] Property test: 3,000 random orders (≤ 20 parties) — shares sum to the fee, each within 1¢
 *       of exact, none negative, money conserved
 *   [5] Refund policy table (C-2) and the C-4 constant
 *   [6] Stage 1 is NOT wired: nothing outside the tests imports the module; the legacy model is unchanged
 *
 * Run:  npx tsx scripts/fees-exhibit-a-test.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  serviceFeeCents, orderTotalCents, splitByLargestRemainder, nominalWeights, planExhibitAPayout,
  wholeOrderRefundParts, NON_RETURNED_FEE_ABSORBED_BY, FAIRSYNQ, PARTNER, type FeeTerms,
} from '../lib/fees/exhibit-a'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
const throws = (f: () => unknown) => { try { f(); return false } catch { return true } }

const TERMS: FeeTerms = { serviceFeeBps: 1500, serviceFeeFlatCents: 0, cardFeesPaidBy: 'VENDOR' }
/** What Stripe charges on a US card, rounded to the cent (half up): 2.9% + 30¢. */
const nominalStripeFee = (totalCents: number) => Math.floor((totalCents * 29 + 500) / 1000) + 30
const sum = (o: Record<string, number>) => Object.values(o).reduce((s, n) => s + n, 0)

// ── [1] price ────────────────────────────────────────────────────────────────────────────
console.log('\n[1] Service fee and price')
assert(serviceFeeCents(0, { serviceFeeBps: 1500, serviceFeeFlatCents: 50 }) === 0, 'a 0¢ subtotal has no service fee, flat amount included')
assert(serviceFeeCents(30, TERMS) === 5 && serviceFeeCents(10, TERMS) === 2, 'half-cents round up (15% of 30¢ = 4.5 → 5; of 10¢ = 1.5 → 2)')
assert(serviceFeeCents(3, TERMS) === 0, 'below half a cent rounds down (15% of 3¢ = 0.45 → 0)')
assert(serviceFeeCents(5000, { serviceFeeBps: 0, serviceFeeFlatCents: 100 }) === 100, 'flat-only: 0% + $1.00 → 100¢')
assert(serviceFeeCents(5000, TERMS) === 750, 'pct-only: 15% of $50 → 750¢')
assert(serviceFeeCents(5000, { serviceFeeBps: 1500, serviceFeeFlatCents: 25 }) === 775, 'pct + flat once per order: 750 + 25')
const booth = orderTotalCents({ subtotalCents: 5000, curbsideFeeCents: 0, tipCents: 0 }, TERMS)
assert(booth.serviceFeeCents === 750 && booth.totalCents === 5750, '$50 booth pickup → service fee 750¢, total 5750¢')
const curb = orderTotalCents({ subtotalCents: 5000, curbsideFeeCents: 399, tipCents: 0 }, TERMS)
assert(curb.totalCents === 6149, '$50 curbside → 6149¢ (+ tip)')
assert(orderTotalCents({ subtotalCents: 5000, curbsideFeeCents: 399, tipCents: 200 }, TERMS).totalCents === 6349, 'tip is added on top, no fee on it')
assert(throws(() => serviceFeeCents(-1, TERMS)) && throws(() => serviceFeeCents(10.5, TERMS)) && throws(() => serviceFeeCents(100, { serviceFeeBps: -5, serviceFeeFlatCents: 0 })),
  'negative or fractional cents are refused')

// ── [2] the split ────────────────────────────────────────────────────────────────────────
console.log('\n[2] Largest-remainder split')
const s1 = splitByLargestRemainder(197, [{ key: 'v', weight: 17500 }, { key: 'f', weight: 2175 }])
assert(s1.v === 175 && s1.f === 22, '197¢ by 175 : 21.75 → 175 / 22 (the leftover cent goes to the LARGEST REMAINDER, not the largest party)')
const tie = splitByLargestRemainder(1, [{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }])
assert(tie.a === 1 && tie.b === 0, 'exact tie → first party (deterministic)')
const tiny = splitByLargestRemainder(2, [{ key: 'a', weight: 5 }, { key: 'b', weight: 4 }, { key: 'c', weight: 3 }, { key: 'd', weight: 2 }, { key: 'e', weight: 1 }])
assert(sum(tiny) === 2 && Object.values(tiny).every(n => n >= 0 && n <= 1), 'a fee smaller than the number of parties: sums to 2¢, nobody negative')
assert(sum(splitByLargestRemainder(0, [{ key: 'a', weight: 3 }])) === 0, 'a 0¢ fee splits to zeros')
assert(throws(() => splitByLargestRemainder(5, [])) && throws(() => splitByLargestRemainder(5, [{ key: 'a', weight: 0 }])) && throws(() => splitByLargestRemainder(5, [{ key: 'a', weight: 1 }, { key: 'a', weight: 2 }])),
  'no parties, zero total weight, or duplicate keys are refused')

// ── [3] Exhibit A payouts ────────────────────────────────────────────────────────────────
console.log('\n[3] Exhibit A payouts')
// Updated 2026-11-19 (item 10 stage 4, S4-Q2): `tax` joins the customer side (0 when absent).
const conserved = (p: ReturnType<typeof planExhibitAPayout>, food: number, svc: number, curbFee: number, tip: number, fee: number, tax = 0) =>
  sum(p.vendorPayoutCents) + p.fairsynqNetCents + p.partnerNetCents + fee === food + tax + svc + curbFee + tip

assert(nominalStripeFee(5750) === 197, 'Stripe fee on a 5750¢ charge = 166.75 + 30 → 197¢')
const b50 = planExhibitAPayout({ vendorFoodCents: { v1: 5000 }, serviceFeeCents: 750, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: 197, cardFeesPaidBy: 'VENDOR' })
assert(b50.feeShares.v1 === 175 && b50.feeShares[FAIRSYNQ] === 22 && sum(b50.feeShares) === 197, '$50 booth: fee shares vendor 175¢, FairSynq 22¢ (sum 197)')
assert(b50.vendorPayoutCents.v1 === 4825 && b50.fairsynqNetCents === 728, '$50 booth: total 5750 → vendor 4825¢ ($48.25), FairSynq 728¢ ($7.28)  ← the Exhibit A example')
assert(conserved(b50, 5000, 750, 0, 0, 197), '$50 booth: every cent accounted for')

assert(nominalStripeFee(6149) === 208, 'Stripe fee on a 6149¢ charge → 208¢')
const c50 = planExhibitAPayout({ vendorFoodCents: { v1: 5000 }, serviceFeeCents: 750, curbsideFeeCents: 399, tipCents: 0, realStripeFeeCents: 208, cardFeesPaidBy: 'VENDOR' })
assert(c50.feeShares.v1 === 175 && c50.feeShares[FAIRSYNQ] === 22 && c50.feeShares[PARTNER] === 11, '$50 curbside: fee shares 175 / 22 / 11')
assert(c50.vendorPayoutCents.v1 === 4825 && c50.fairsynqNetCents === 728 && c50.partnerNetCents === 388, '$50 curbside: vendor $48.25, FairSynq $7.28, partner keeps $3.88')
assert(conserved(c50, 5000, 750, 399, 0, 208), '$50 curbside: every cent accounted for')

const two = planExhibitAPayout({ vendorFoodCents: { a: 3000, b: 2000 }, serviceFeeCents: 750, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: 197, cardFeesPaidBy: 'VENDOR' })
assert(two.feeShares.a === 105 && two.feeShares.b === 70 && two.feeShares[FAIRSYNQ] === 22, '2 vendors ($30 + $20): 30¢ split 18/12 by food → fee shares 105 / 70, FairSynq 22')
assert(two.vendorPayoutCents.a === 2895 && two.vendorPayoutCents.b === 1930 && conserved(two, 5000, 750, 0, 0, 197), '2 vendors: $28.95 and $19.30, conserved')
const w4 = nominalWeights({ vendorFoodCents: { a: 1000, b: 1000, c: 1000, d: 2000 }, serviceFeeCents: 750, curbsideFeeCents: 0, tipCents: 0 })
const fixedPart = (k: string) => (w4.find(w => w.key === k)!.weight - 29 * ({ a: 1000, b: 1000, c: 1000, d: 2000 } as Record<string, number>)[k] * 5000) / 1000 / 5000
assert(fixedPart('a') === 6 && fixedPart('d') === 12 && ['a', 'b', 'c', 'd'].reduce((s, k) => s + fixedPart(k), 0) === 30, '4 vendors: one 30¢ per order, split by food share (6 + 6 + 6 + 12), never 4 × 30¢ (C-1 a)')
const four = planExhibitAPayout({ vendorFoodCents: { a: 1000, b: 1000, c: 1000, d: 2000 }, serviceFeeCents: 750, curbsideFeeCents: 399, tipCents: 150, realStripeFeeCents: nominalStripeFee(6299), cardFeesPaidBy: 'VENDOR' })
assert(sum(four.feeShares) === nominalStripeFee(6299) && conserved(four, 5000, 750, 399, 150, nominalStripeFee(6299)), '4 vendors + curbside + tip: shares sum to the fee and money is conserved')

const amexHigh = planExhibitAPayout({ vendorFoodCents: { v1: 5000 }, serviceFeeCents: 750, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: 216, cardFeesPaidBy: 'VENDOR' })
assert(sum(amexHigh.feeShares) === 216 && amexHigh.feeShares.v1 === 192 && amexHigh.feeShares[FAIRSYNQ] === 24, 'a real fee above nominal (Amex, 216¢) is split by the same weights: 192 / 24')
const low = planExhibitAPayout({ vendorFoodCents: { v1: 5000 }, serviceFeeCents: 750, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: 150, cardFeesPaidBy: 'VENDOR' })
assert(sum(low.feeShares) === 150 && low.feeShares.v1 === 133 && low.feeShares[FAIRSYNQ] === 17, 'a real fee below nominal (150¢): 133 / 17')

const plat = planExhibitAPayout({ vendorFoodCents: { v1: 5000 }, serviceFeeCents: 750, curbsideFeeCents: 399, tipCents: 0, realStripeFeeCents: 208, cardFeesPaidBy: 'PLATFORM' })
assert(plat.vendorPayoutCents.v1 === 5000 && plat.fairsynqNetCents === 750 - 22 - 175, 'PLATFORM mode: the vendor gets the full $50; FairSynq absorbs the vendor\'s 175¢ (nets 553¢)')
assert(plat.partnerNetCents === 388 && conserved(plat, 5000, 750, 399, 0, 208), 'PLATFORM mode: the partner still covers its own 11¢ (C-3), money conserved')
assert(throws(() => planExhibitAPayout({ vendorFoodCents: {}, serviceFeeCents: 0, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: 30, cardFeesPaidBy: 'VENDOR' })) &&
  throws(() => planExhibitAPayout({ vendorFoodCents: { a: 0 }, serviceFeeCents: 0, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: 30, cardFeesPaidBy: 'VENDOR' })),
  'an order with no vendors or no food is refused')

// ── [3b] tax (stage 4, S4-Q2: VENDOR remitter, fed 0 until B1.19 adds tax columns) ──────────
console.log('\n[3b] Tax rides with the vendor (S4-Q2)')
assert(nominalStripeFee(6150) === 208, 'Stripe fee on $50 + $4 tax (8%) + $7.50 service = 6150¢ → 208¢')
const t50 = planExhibitAPayout({ vendorFoodCents: { v1: 5000 }, vendorTaxCents: { v1: 400 }, serviceFeeCents: 750, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: 208, cardFeesPaidBy: 'VENDOR' })
assert(t50.feeShares.v1 === 186 && t50.feeShares[FAIRSYNQ] === 22, '$50 + 8% tax: vendor share 186¢ (2.9% of $54 + 30¢), FairSynq 22¢')
assert(t50.vendorPayoutCents.v1 === 5214 && t50.fairsynqNetCents === 728, '$50 + 8% tax: vendor paid $52.14 (food + tax − share), FairSynq $7.28')
assert(conserved(t50, 5000, 750, 0, 0, 208, 400), '$50 + 8% tax: every cent accounted for, tax included')
const t0 = planExhibitAPayout({ vendorFoodCents: { v1: 5000 }, vendorTaxCents: { v1: 0 }, serviceFeeCents: 750, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: 197, cardFeesPaidBy: 'VENDOR' })
assert(t0.vendorPayoutCents.v1 === 4825 && t0.fairsynqNetCents === 728 && sum(t0.feeShares) === 197 && JSON.stringify(t0) === JSON.stringify(b50),
  'zero tax is exactly the untaxed plan: 4825 / 728 / 197, byte-identical')
const t2 = planExhibitAPayout({ vendorFoodCents: { a: 3000, b: 2000 }, vendorTaxCents: { a: 240, b: 0 }, serviceFeeCents: 750, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: nominalStripeFee(5990), cardFeesPaidBy: 'VENDOR' })
assert(t2.feeShares.a > two.feeShares.a && t2.vendorPayoutCents.a === 3240 - t2.feeShares.a && t2.vendorPayoutCents.b === 2000 - t2.feeShares.b,
  '2 vendors, different tax: only the taxed vendor carries the tax\'s processing; each is paid food + own tax − share')
assert(conserved(t2, 5000, 750, 0, 0, nominalStripeFee(5990), 240), '2 vendors with tax: conserved')
const tp = planExhibitAPayout({ vendorFoodCents: { v1: 5000 }, vendorTaxCents: { v1: 400 }, serviceFeeCents: 750, curbsideFeeCents: 399, tipCents: 0, realStripeFeeCents: nominalStripeFee(6549), cardFeesPaidBy: 'PLATFORM' })
assert(tp.vendorPayoutCents.v1 === 5400 && conserved(tp, 5000, 750, 399, 0, nominalStripeFee(6549), 400), 'PLATFORM with tax: the vendor gets food + tax in full ($54), conserved')
assert(throws(() => planExhibitAPayout({ vendorFoodCents: { a: 1000 }, vendorTaxCents: { b: 80 }, serviceFeeCents: 150, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: 66, cardFeesPaidBy: 'VENDOR' })) &&
  throws(() => planExhibitAPayout({ vendorFoodCents: { a: 1000 }, vendorTaxCents: { a: -1 }, serviceFeeCents: 150, curbsideFeeCents: 0, tipCents: 0, realStripeFeeCents: 66, cardFeesPaidBy: 'VENDOR' })),
  'tax for a vendor with no food, or negative tax, is refused')

// ── [4] property test ────────────────────────────────────────────────────────────────────
console.log('\n[4] Property test (3,000 random orders, with tax since stage 4)')
let seed = 20261106
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
let sumOk = 0, nearOk = 0, nonNegOk = 0, conservedOk = 0
const N = 3000
for (let t = 0; t < N; t++) {
  const vendors = int(1, 18)
  const food: Record<string, number> = {}
  for (let i = 0; i < vendors; i++) food[`v${i}`] = int(1, 20000)
  const F = Object.values(food).reduce((s, n) => s + n, 0)
  const svc = serviceFeeCents(F, { serviceFeeBps: int(0, 2500), serviceFeeFlatCents: int(0, 200) })
  const curbFee = rnd() < 0.5 ? 0 : int(0, 600), tip = curbFee === 0 ? 0 : int(0, 2000)
  const tax: Record<string, number> = {}
  for (const id of Object.keys(food)) if (rnd() < 0.5) tax[id] = Math.floor(food[id] * int(0, 15000) / 100000 + 0.5)
  const T = Object.values(tax).reduce((s, n) => s + n, 0)
  const total = F + T + svc + curbFee + tip
  const fee = rnd() < 0.2 ? int(0, 40) : Math.max(0, Math.round(nominalStripeFee(total) * (0.6 + rnd() * 0.8)))
  const input = { vendorFoodCents: food, vendorTaxCents: tax, serviceFeeCents: svc, curbsideFeeCents: curbFee, tipCents: tip, realStripeFeeCents: fee, cardFeesPaidBy: (rnd() < 0.5 ? 'VENDOR' : 'PLATFORM') as 'VENDOR' | 'PLATFORM' }
  const p = planExhibitAPayout(input)
  const weights = nominalWeights(input)
  const W = weights.reduce((s, w) => s + w.weight, 0)
  if (sum(p.feeShares) === fee) sumOk++
  if (weights.every(w => Math.abs(p.feeShares[w.key] - (fee * w.weight) / W) < 1)) nearOk++
  if (Object.values(p.feeShares).every(n => n >= 0)) nonNegOk++
  if (conserved(p, F, svc, curbFee, tip, fee, T)) conservedOk++
}
assert(sumOk === N, `shares always sum to the real fee (${sumOk}/${N})`)
assert(nearOk === N, `each share is within 1¢ of its exact proportional share (${nearOk}/${N})`)
assert(nonNegOk === N, `no share is ever negative (${nonNegOk}/${N})`)
assert(conservedOk === N, `money is conserved on every order, tax included (${conservedOk}/${N})`)

// ── [5] refund policy ────────────────────────────────────────────────────────────────────
console.log('\n[5] Refund policy (C-2) and C-4')
const eq = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b)
assert(eq(wholeOrderRefundParts('CANCELLED_BEFORE_ACCEPTANCE'), { serviceFee: true, curbsideFee: true, tip: true }), 'full cancel before acceptance → service fee, curbside fee and tip all refunded')
assert(eq(wholeOrderRefundParts('CURBSIDE_NOT_HANDED_OVER'), { serviceFee: false, curbsideFee: true, tip: true }), 'curbside never handed over → curbside fee + tip refunded, service fee kept')
assert(eq(wholeOrderRefundParts('BOOTH_NO_SHOW'), { serviceFee: false, curbsideFee: false, tip: false }), 'booth no-show → service fee kept (the vendor made the food)')
assert(eq(wholeOrderRefundParts('PARTIAL_CANCEL_OTHERS_FULFILLED'), { serviceFee: false, curbsideFee: false, tip: false }), 'partial cancel where another vendor fulfilled → service fee kept')
assert(NON_RETURNED_FEE_ABSORBED_BY === 'FAIRSYNQ', 'C-4 (a): FairSynq absorbs Stripe\'s non-returned fee')

// ── [6] not wired ────────────────────────────────────────────────────────────────────────
// Updated 2026-11-18 (item 10 stage 3): the PRICE side is now wired (lib/checkout-total.ts since 2026-11-23, and the order
// route imports FEE_MODEL_EXHIBIT_A for the snapshot). Payouts and refunds must still not use it until
// stages 4 and 5.
// Updated 2026-11-19 (item 10 stage 4): the PAYOUT side is wired too (fee split, payout, vendor estimate,
// reconciler check). Refunds (stage 5) must still not use it.
console.log('\n[6] Price (stage 3) and payout (stage 4) are wired; refunds are not')
function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) { const q = join(dir, n); statSync(q).isDirectory() ? (n !== 'node_modules' && walk(q, out)) : out.push(q) }
  return out
}
const IMPORT = /from ['"](@\/lib\/fees\/exhibit-a|\.\.?\/(?:\.\.\/)*(?:lib\/)?fees\/exhibit-a)['"]/
assert(IMPORT.test("import { planExhibitAPayout } from '@/lib/fees/exhibit-a'") && IMPORT.test("import x from '../lib/fees/exhibit-a'"), '[0] positive control: the scanner sees both import forms')
const importers = ['app', 'lib', 'workers'].flatMap(d => walk(join(process.cwd(), d)))
  .filter(f => /\.(ts|tsx)$/.test(f) && !f.endsWith(join('fees', 'exhibit-a.ts')))
  .filter(f => IMPORT.test(readFileSync(f, 'utf8')))
  .map(f => relative(process.cwd(), f).split(sep).join('/'))
for (const i of importers) console.log(`     ↳ imports it: ${i}`)
assert(JSON.stringify(importers.sort()) === JSON.stringify(['app/api/orders/route.ts', 'lib/checkout-total.ts', 'lib/fee-split.ts', 'lib/process-payout.ts', 'lib/reconciler.ts', 'lib/vendor-earnings.ts']),
  'importers are exactly the price side + the payout side (fee-split, process-payout, vendor-earnings, reconciler); no refund module')
const constants = readFileSync('lib/constants.ts', 'utf8')
assert(/export const SERVICE_FEE_RATE = 0\.10/.test(constants), 'the legacy 10% constant is still there (legacy orders keep their stored 10%)')

console.log(`\n${'─'.repeat(64)}`)
console.log(fail === 0 ? `  ${pass} passed, 0 failed` : `  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
console.log(`${'─'.repeat(64)}\n`)
process.exit(fail === 0 ? 0 : 1)
