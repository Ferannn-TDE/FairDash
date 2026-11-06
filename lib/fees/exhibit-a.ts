// Exhibit A fee model (Batch 1 item 10, B1.13) — STAGE 1: pure functions only.
//
// NOTHING calls this yet. Checkout, the order route, payouts and refunds still run the legacy
// model (10% service fee, vendor pays the whole Stripe fee: lib/constants.ts, lib/payout-split.ts).
// Wiring is stage 2+, after the client answers C-1 to C-4 and the production dry run (BATCH-1 §19).
//
// Every amount is an integer number of cents; every function is pure and deterministic.
//
// Built on the RECOMMENDED answers (pending the client, BATCH-1 §15):
//   C-1 (a)  multi-vendor: Stripe's one 30¢ is split between vendors by food share
//   C-2      booth no-show keeps the service fee; curbside never handed over refunds the curbside
//            fee + tip; a full cancel before acceptance refunds service fee + curbside fee + tip
//   C-3      "FairSynq pays card fees" covers the vendors' food only; the partner still covers the
//            processing on its curbside fee and tips
//   C-4 (a)  FairSynq absorbs Stripe's non-returned fee on a refunded order

export const FEE_MODEL_EXHIBIT_A = 2 as const

/** Stripe's US card pricing used for the NOMINAL weights: 2.9% + 30¢. The real settled fee
 *  (Amex, international) is then split in proportion to these weights. */
export const NOMINAL_PCT_PER_MILLE = 29 // 2.9% as parts per thousand
export const NOMINAL_FIXED_CENTS = 30

export type CardFeesPaidBy = 'VENDOR' | 'PLATFORM'

export interface FeeTerms {
  /** Service fee percent in basis points (1500 = 15%). */
  serviceFeeBps: number
  /** Flat service fee in cents, once per order. */
  serviceFeeFlatCents: number
  cardFeesPaidBy: CardFeesPaidBy
}

function assertCents(name: string, n: number) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer number of cents (got ${n})`)
}

// ── Price ───────────────────────────────────────────────────────────────────────────────────
/** One service fee per order, on the order's TOTAL food subtotal: round(subtotal × pct) + flat.
 *  Half-cents round up. An order with no food has no service fee (the flat amount included). */
export function serviceFeeCents(subtotalCents: number, terms: Pick<FeeTerms, 'serviceFeeBps' | 'serviceFeeFlatCents'>): number {
  assertCents('subtotalCents', subtotalCents)
  assertCents('serviceFeeBps', terms.serviceFeeBps)
  assertCents('serviceFeeFlatCents', terms.serviceFeeFlatCents)
  if (subtotalCents === 0) return 0
  // Integer half-up: floor((subtotal × bps + 5000) / 10000).
  return Math.floor((subtotalCents * terms.serviceFeeBps + 5000) / 10000) + terms.serviceFeeFlatCents
}

export interface OrderPriceInput { subtotalCents: number; curbsideFeeCents: number; tipCents: number }

export function orderTotalCents(input: OrderPriceInput, terms: FeeTerms): { serviceFeeCents: number; totalCents: number } {
  assertCents('curbsideFeeCents', input.curbsideFeeCents)
  assertCents('tipCents', input.tipCents)
  const fee = serviceFeeCents(input.subtotalCents, terms)
  return { serviceFeeCents: fee, totalCents: input.subtotalCents + fee + input.curbsideFeeCents + input.tipCents }
}

// ── Splitting the real Stripe fee ───────────────────────────────────────────────────────────
export interface Weighted { key: string; weight: number }

/**
 * Largest-remainder split of `totalCents` in proportion to integer weights: each party gets the
 * floor of its exact share, then the leftover cents go one each to the LARGEST FRACTIONAL
 * REMAINDERS (ties: larger weight, then key order). Shares always sum to totalCents exactly, each
 * is within 1¢ of its exact proportional share, and none is negative. Exact integer arithmetic.
 */
export function splitByLargestRemainder(totalCents: number, parties: Weighted[]): Record<string, number> {
  assertCents('totalCents', totalCents)
  if (parties.length === 0) throw new Error('splitByLargestRemainder: no parties')
  for (const p of parties) {
    if (!Number.isInteger(p.weight) || p.weight < 0) throw new Error(`weight for ${p.key} must be a non-negative integer`)
  }
  const keys = new Set(parties.map(p => p.key))
  if (keys.size !== parties.length) throw new Error('splitByLargestRemainder: duplicate party keys')
  const W = parties.reduce((s, p) => s + p.weight, 0)
  if (W === 0) throw new Error('splitByLargestRemainder: total weight is zero')
  const T = BigInt(totalCents), BW = BigInt(W)
  const rows = parties.map((p, i) => {
    const num = T * BigInt(p.weight)
    return { key: p.key, weight: p.weight, i, floor: Number(num / BW), rem: num % BW }
  })
  let left = totalCents - rows.reduce((s, r) => s + r.floor, 0)
  const order = [...rows].sort((a, b) =>
    a.rem === b.rem ? (b.weight - a.weight || a.i - b.i) : (b.rem > a.rem ? 1 : -1))
  const out: Record<string, number> = Object.fromEntries(rows.map(r => [r.key, r.floor]))
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length].key] += 1
  return out
}

export const FAIRSYNQ = 'fairsynq'
export const PARTNER = 'partner'

export interface PayoutInput {
  /** Food subtotal per vendor id (the multi-vendor order's lines). */
  vendorFoodCents: Record<string, number>
  serviceFeeCents: number
  curbsideFeeCents: number
  tipCents: number
  /** The REAL settled Stripe fee for the charge (balance transaction `fee`). */
  realStripeFeeCents: number
  cardFeesPaidBy: CardFeesPaidBy
}

/** Nominal weights, scaled to integers by (1000 × total food) so the split can be exact:
 *    vendor i : 2.9% × food_i + food_i/totalFood × 30¢      (C-1 a: 30¢ split by food share)
 *    FairSynq : 2.9% × serviceFee
 *    partner  : 2.9% × (curbsideFee + tip)                  (omitted when there's nothing to carry) */
export function nominalWeights(input: Omit<PayoutInput, 'realStripeFeeCents' | 'cardFeesPaidBy'>): Weighted[] {
  const ids = Object.keys(input.vendorFoodCents)
  if (ids.length === 0) throw new Error('nominalWeights: at least one vendor')
  ids.forEach(id => assertCents(`food for ${id}`, input.vendorFoodCents[id]))
  assertCents('serviceFeeCents', input.serviceFeeCents)
  assertCents('curbsideFeeCents', input.curbsideFeeCents)
  assertCents('tipCents', input.tipCents)
  const F = ids.reduce((s, id) => s + input.vendorFoodCents[id], 0)
  if (F === 0) throw new Error('nominalWeights: the order has no food')
  const parties: Weighted[] = ids.map(id => ({
    key: id,
    weight: NOMINAL_PCT_PER_MILLE * input.vendorFoodCents[id] * F + NOMINAL_FIXED_CENTS * 1000 * input.vendorFoodCents[id],
  }))
  parties.push({ key: FAIRSYNQ, weight: NOMINAL_PCT_PER_MILLE * input.serviceFeeCents * F })
  const partnerBase = input.curbsideFeeCents + input.tipCents
  if (partnerBase > 0) parties.push({ key: PARTNER, weight: NOMINAL_PCT_PER_MILLE * partnerBase * F })
  return parties
}

export interface PayoutPlan {
  /** Each party's share of the real Stripe fee (sums to realStripeFeeCents). */
  feeShares: Record<string, number>
  /** What each vendor is paid. */
  vendorPayoutCents: Record<string, number>
  /** What FairSynq keeps of the service fee, after its processing share (and, in PLATFORM mode,
   *  the vendors' shares). Can be negative only if FairSynq's absorbed fees exceed the service fee. */
  fairsynqNetCents: number
  /** The partner's amount (curbside fee + tip − its processing share). 0 with no curbside/tip. */
  partnerNetCents: number
}

/** The Exhibit A payout for one paid order. Money is conserved:
 *  Σ vendors + fairsynqNet + partnerNet + realStripeFee === food + serviceFee + curbsideFee + tip. */
export function planExhibitAPayout(input: PayoutInput): PayoutPlan {
  assertCents('realStripeFeeCents', input.realStripeFeeCents)
  const shares = splitByLargestRemainder(input.realStripeFeeCents, nominalWeights(input))
  const ids = Object.keys(input.vendorFoodCents)
  const vendorShare = (id: string) => shares[id] ?? 0
  const vendorPayoutCents = Object.fromEntries(ids.map(id => [
    id, input.cardFeesPaidBy === 'PLATFORM' ? input.vendorFoodCents[id] : input.vendorFoodCents[id] - vendorShare(id),
  ]))
  const vendorSharesTotal = ids.reduce((s, id) => s + vendorShare(id), 0)
  // C-3: in PLATFORM mode FairSynq takes over the vendors' processing only; the partner's stays.
  const fairsynqNetCents = input.serviceFeeCents - (shares[FAIRSYNQ] ?? 0) - (input.cardFeesPaidBy === 'PLATFORM' ? vendorSharesTotal : 0)
  const partnerNetCents = input.curbsideFeeCents + input.tipCents - (shares[PARTNER] ?? 0)
  return { feeShares: shares, vendorPayoutCents, fairsynqNetCents, partnerNetCents }
}

// ── Refund policy (whole-order parts) ───────────────────────────────────────────────────────
export type OrderOutcome =
  | 'CANCELLED_BEFORE_ACCEPTANCE'   // every vendor portion cancelled before any vendor accepted
  | 'PARTIAL_CANCEL_OTHERS_FULFILLED' // a vendor cancelled, another vendor's food was handed over
  | 'BOOTH_NO_SHOW'                 // booth pickup never collected (vendor made the food)
  | 'CURBSIDE_NOT_HANDED_OVER'      // curbside: customer didn't show / volunteer couldn't find them
  | 'FULFILLED'

export interface WholeOrderRefund { serviceFee: boolean; curbsideFee: boolean; tip: boolean }

/** Which whole-order parts come back, per the Refund Policy and C-2's recommended answer. Food is
 *  refunded per vendor by the existing engine and isn't decided here. */
export function wholeOrderRefundParts(outcome: OrderOutcome): WholeOrderRefund {
  switch (outcome) {
    case 'CANCELLED_BEFORE_ACCEPTANCE': return { serviceFee: true, curbsideFee: true, tip: true }
    case 'CURBSIDE_NOT_HANDED_OVER': return { serviceFee: false, curbsideFee: true, tip: true }
    case 'PARTIAL_CANCEL_OTHERS_FULFILLED':
    case 'BOOTH_NO_SHOW':
    case 'FULFILLED':
      return { serviceFee: false, curbsideFee: false, tip: false }
  }
}

/** C-4 (a): who absorbs the Stripe fee Stripe keeps on a refunded charge. */
export const NON_RETURNED_FEE_ABSORBED_BY = 'FAIRSYNQ' as const
