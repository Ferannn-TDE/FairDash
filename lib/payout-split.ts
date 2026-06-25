/**
 * Proportional Stripe-fee split for separate charges & transfers.
 *
 * One Stripe processing fee is charged on the whole order. Vendors absorb it,
 * split proportionally by each vendor's share of the subtotal. FairSynq's 10%
 * service fee is untouched (it falls out as the platform-balance remainder).
 *
 * All math is in INTEGER CENTS. The split is exact: the sum of per-vendor fee
 * shares ALWAYS equals the total Stripe fee to the cent — any rounding remainder
 * is assigned to the largest-subtotal vendor(s) first.
 */

export interface VendorPayoutLine {
  vendorId: string
  subtotalCents: number
  /** This vendor's share of the Stripe fee (cents). */
  feeShareCents: number
  /** What this vendor is owed: subtotalCents - feeShareCents (cents). */
  transferCents: number
}

/**
 * @param vendorSubtotalsCents  vendorId → subtotal in integer cents
 * @param stripeFeeCents        the real settled Stripe fee in integer cents
 * @returns one line per vendor; Σ feeShareCents === stripeFeeCents exactly
 */
export function splitStripeFee(
  vendorSubtotalsCents: Record<string, number>,
  stripeFeeCents: number,
): VendorPayoutLine[] {
  const vendorIds = Object.keys(vendorSubtotalsCents)
  if (vendorIds.length === 0) return []

  const totalSubtotal = vendorIds.reduce((s, id) => s + vendorSubtotalsCents[id], 0)
  if (totalSubtotal <= 0) {
    throw new Error('splitStripeFee: total subtotal must be > 0')
  }

  // Floor each share, track how many cents remain to distribute.
  const shares: Record<string, number> = {}
  let allocated = 0
  for (const id of vendorIds) {
    const share = Math.floor((stripeFeeCents * vendorSubtotalsCents[id]) / totalSubtotal)
    shares[id] = share
    allocated += share
  }

  // Distribute the leftover cents (0..vendorIds.length-1) to the largest
  // subtotals first, so the sum reconciles to the cent exactly.
  let remainder = stripeFeeCents - allocated
  const byLargest = [...vendorIds].sort(
    (a, b) => vendorSubtotalsCents[b] - vendorSubtotalsCents[a],
  )
  for (let i = 0; remainder > 0; i = (i + 1) % byLargest.length) {
    shares[byLargest[i]] += 1
    remainder -= 1
  }

  return vendorIds.map(id => ({
    vendorId: id,
    subtotalCents: vendorSubtotalsCents[id],
    feeShareCents: shares[id],
    transferCents: vendorSubtotalsCents[id] - shares[id],
  }))
}

export interface RunnerFeeSplit {
  runnerShareCents: number
  organizerShareCents: number
}

/**
 * Split the applicable runner-fulfilled fee (delivery OR curbside) between the
 * runner and the organizer by runnerFeePercent. Reuses splitStripeFee's
 * largest-remainder discipline so the two shares sum to the fee EXACTLY (integer
 * cents). runnerShare = runner% of fee; organizerShare = the leftover.
 *
 * @param applicableFeeCents integer cents (0 → both shares 0)
 * @param runnerPercent      0–100 (clamped); the runner's share of the fee
 */
export function splitRunnerFee(applicableFeeCents: number, runnerPercent: number): RunnerFeeSplit {
  if (applicableFeeCents <= 0) return { runnerShareCents: 0, organizerShareCents: 0 }
  const pct = Math.max(0, Math.min(100, Math.round(runnerPercent)))
  // weights sum to 100 (> 0), so splitStripeFee is always valid — even at 0/100.
  const lines = splitStripeFee({ runner: pct, organizer: 100 - pct }, applicableFeeCents)
  const runnerShareCents = lines.find(l => l.vendorId === 'runner')?.feeShareCents ?? 0
  const organizerShareCents = lines.find(l => l.vendorId === 'organizer')?.feeShareCents ?? 0
  return { runnerShareCents, organizerShareCents }
}
