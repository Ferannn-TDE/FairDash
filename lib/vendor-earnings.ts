/**
 * Vendor earnings — the ONE source of truth for every vendor-facing money
 * display (dashboard, analytics, history, order cards). Same discipline as the
 * money engine: one function, consumed everywhere, so the surfaces can't diverge.
 *
 * A vendor's take-home for an order is their SUBTOTAL SLICE minus their share of
 * the STRIPE PROCESSING FEE — NOT FairSynq's 10% service fee. The 10% is paid by
 * the customer ON TOP of the subtotal and never touches the vendor's money. So:
 *   take-home = slice − (vendor's share of the Stripe fee)
 *
 *   - settled  : Payout.netAmount — real money transferred (money-truth).
 *   - estimated: slice − ESTIMATED Stripe-fee share, before payout fires. The
 *                fee is modeled as 2.9% + $0.30 per charge and split across
 *                vendors with the SAME splitStripeFee used by the real payout, so
 *                the estimate tracks the eventual settled number closely. The fee
 *                is rounded UP so the estimate is conservative — the settled
 *                figure only ever matches or RISES from it, never drops.
 *   - declined / reversed (chargeback/refund clawback) / refunded → reduced to $0
 *     or the remaining amount. These OVERRIDE a stale Payout row.
 *
 * INVARIANT: never returns more than the vendor will actually receive.
 */

import { splitStripeFee } from './payout-split'
import { isPollutedTransfer } from './pollution-cohort'

/**
 * `excluded` — the slice is NOT REAL and must render as NOTHING. Not zero, not a "cancelled"
 * label: a written-off slice showing "$0" invites a question whose only honest answer is "a
 * testing accident". See lib/pollution-cohort.ts.
 */
export type EarningsStatus = 'settled' | 'estimated' | 'refunded' | 'reversed' | 'declined' | 'excluded'

export interface VendorOrderEarnings {
  cents: number
  status: EarningsStatus
}

/** Minimal shape each display surface must load per order to compute earnings. */
export interface OrderForEarnings {
  total: number
  orderItems: { vendorId: string; subtotal: number }[]
  /**
   * `stripeTransferId` is REQUIRED — without it this helper cannot tell a real payout from a
   * fabricated one, and would show a vendor money that was never sent. Widening this shape also
   * closed a latent fragility: `payouts.find(p => p.vendorId === …)` was deterministic only
   * because no (order, vendor) pair had two payout rows. It is now deterministic BY
   * CONSTRUCTION, because the polluted row is removed before the lookup.
   */
  payouts: { vendorId: string; netAmount: number; reversedAt: Date | null; stripeTransferId: string }[]
  refunds: { vendorId: string; status: string; amountCents: number }[]
  vendorOrderStatuses: { vendorId: string; status: string }[]
}

const c = (n: number) => Math.round(n * 100)

/**
 * Estimated TOTAL Stripe processing fee for a charge, in cents. Standard US card
 * pricing 2.9% + $0.30. The percentage part is rounded UP (Math.ceil) so the
 * estimate is conservative (estimated fee ≥ real fee ⇒ estimated take-home ≤ real).
 */
/**
 * THE RATE MODEL — named, so a change to it is visible instead of buried in an expression.
 *
 * ⚠️ THIS IS A PREDICTION, AND NOTHING MECHANICALLY TIES IT TO REALITY. The payout does NOT
 * use these numbers: it reads the REAL settled fee from Stripe's balance transaction
 * (`process-payout.ts:334`, `bt.fee`) and splits that. So there is no shared rate constant to
 * derive this from — the estimator predicts, the payout measures. They are coupled only by
 * being about the same fee.
 *
 * WHAT ACTUALLY KEEPS THEM HONEST, and what would break it:
 *   1. BOTH route through `splitStripeFee`, so the SPLIT across vendors cannot diverge.
 *   2. The vendor BEARS the fee — `payout-split.ts` computes
 *      `transferCents = subtotalCents − feeShareCents`. If the fee ever moved off the vendor
 *      leg (absorbed by the platform, or charged to the customer), the payout would transfer
 *      the full slice while every vendor surface kept deducting ~2.9% + 30¢. Vendors would be
 *      shown LESS than they receive, on every order, and nothing would fail — the silent-drift
 *      shape exactly.
 *   3. CONSERVATIVENESS: the percentage part is rounded UP so the estimate is never optimistic.
 *      `vendor-earnings.ts` states the invariant as "never returns more than the vendor will
 *      actually receive" — lowering either constant, or removing the ceil, breaks it.
 *
 * `scripts/vendor-fee-coupling-guard.ts` asserts 1–3. If you change these values, that guard
 * is where the reasoning lives; read it before assuming a newer rate is simply "more correct".
 */
export const STRIPE_FEE_PCT = 0.029   // US card standard, percentage component
export const STRIPE_FEE_FIXED_CENTS = 30 // US card standard, per-charge component

export function estimateStripeFeeCents(orderTotalCents: number): number {
  if (orderTotalCents <= 0) return 0
  return Math.ceil(orderTotalCents * STRIPE_FEE_PCT) + STRIPE_FEE_FIXED_CENTS
}

export function computeVendorOrderEarnings(order: OrderForEarnings, vendorId: string): VendorOrderEarnings {
  // Per-vendor subtotal slices (cents) — same basis the payout split uses.
  const vendorSubtotalsCents: Record<string, number> = {}
  for (const it of order.orderItems) {
    vendorSubtotalsCents[it.vendorId] = (vendorSubtotalsCents[it.vendorId] ?? 0) + c(it.subtotal)
  }
  const sliceCents = vendorSubtotalsCents[vendorId] ?? 0
  if (sliceCents <= 0) return { cents: 0, status: 'declined' }

  const vos = order.vendorOrderStatuses.find(s => s.vendorId === vendorId)?.status

  // ── FABRICATED PAYOUTS ARE REMOVED BEFORE ANYTHING READS THEM ─────────────────────────
  // A polluted row is not "a payout with a bad id" — it is not a payout. Filtering here rather
  // than at each call site means every vendor surface inherits it from the one helper they all
  // already use, and the `.find` below can no longer pick a fabricated row over a real one.
  const realPayouts = order.payouts.filter(p => !isPollutedTransfer(p.stripeTransferId))
  const hadPollutedForThisVendor = order.payouts.some(p => p.vendorId === vendorId && isPollutedTransfer(p.stripeTransferId))
  const payout = realPayouts.find(p => p.vendorId === vendorId)

  // THE SLICE DOES NOT APPEAR. Falling through to the `estimated` branch would show "~$X
  // pending" for money written off — honest that nothing was sent, wrong that anything is owed.
  // Zero cents + a status callers skip is how it renders as nothing at all.
  if (hadPollutedForThisVendor && !payout) return { cents: 0, status: 'excluded' }
  const refund = order.refunds.find(r => r.vendorId === vendorId && r.status === 'COMPLETED')

  // ── Base take-home: settled (money-truth) or conservative estimate ────────
  let base: number
  let status: EarningsStatus
  if (payout && !payout.reversedAt) {
    base = c(payout.netAmount)        // settled — real transfer
    status = 'settled'
  } else {
    // Estimate: slice − this vendor's share of the estimated Stripe fee, split
    // proportionally with the SAME function the real payout uses.
    const estFeeTotal = estimateStripeFeeCents(c(order.total))
    const feeShare = splitStripeFee(vendorSubtotalsCents, estFeeTotal).find(l => l.vendorId === vendorId)?.feeShareCents ?? 0
    base = Math.max(0, sliceCents - feeShare)
    status = 'estimated'
  }

  // ── Overrides (priority: a clawed-back/declined order is $0, not its stale
  // Payout row). A chargeback sets reversedAt — that must win. ───────────────
  if (vos === 'DECLINED') return { cents: 0, status: 'declined' }
  if (payout?.reversedAt) return { cents: 0, status: 'reversed' }
  if (refund) {
    const remaining = Math.max(0, base - refund.amountCents)
    return { cents: remaining, status: 'refunded' }
  }

  return { cents: base, status }
}

export interface VendorEarningsSummary {
  settledCents: number     // real money transferred (in their Stripe balance)
  estimatedCents: number   // conservative estimate, not yet transferred ("pending")
  refundedCents: number    // amount that was refunded/clawed back (informational)
  settledOrders: number
  pendingOrders: number
}

/**
 * Aggregate across orders — NEVER blends settled + estimated into one number.
 * Surfaces show "$X earned" (settled) and "~$Y pending" (estimated) separately.
 */
export function sumVendorEarnings(orders: OrderForEarnings[], vendorId: string): VendorEarningsSummary {
  const out: VendorEarningsSummary = {
    settledCents: 0, estimatedCents: 0, refundedCents: 0, settledOrders: 0, pendingOrders: 0,
  }
  for (const o of orders) {
    const e = computeVendorOrderEarnings(o, vendorId)
    if (e.status === 'settled') { out.settledCents += e.cents; out.settledOrders++ }
    else if (e.status === 'estimated') { out.estimatedCents += e.cents; out.pendingOrders++ }
    else if (e.status === 'refunded') { out.refundedCents += e.cents } // remaining after refund
    // declined / reversed / EXCLUDED contribute $0 and increment no count — a written-off
    // slice must not appear in a total or a tally any more than it appears on screen.
  }
  return out
}
