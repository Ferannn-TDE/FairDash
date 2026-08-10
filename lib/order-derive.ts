// ─────────────────────────────────────────────────────────────────────────────
// Order-status derivation — THE PURE CORE (no DB, no queue, no Firebase, no Prisma)
// ─────────────────────────────────────────────────────────────────────────────
//
// This module holds the pure derivation that answers ONE question:
//
//     given { VendorOrderStatus rows } + fulfillmentType + runner overlay,
//     what SHOULD this order's master status be?
//
// It was extracted VERBATIM out of lib/reconcile-order-status.ts (which re-exports
// every symbol below, so no existing importer changed) for exactly one reason:
//
//   THE CUSTOMER TRACKING VIEW HAS TO APPLY THE SAME DELIVERY-ARM CLAMP AS THE SERVER.
//
// lib/order-view.ts runs in the browser. reconcile-order-status.ts reaches ./db,
// ./queues and ./firebase-sync through dynamic imports, so importing it from a
// 'use client' module would drag Prisma, BullMQ and firebase-admin into the client
// bundle. A leaf module with no runtime dependency beyond ./order-status is what
// lets ONE derivation serve both the writer and the reader.
//
// WHY THAT MATTERS AND ISN'T JUST TIDINESS. The delivery arm CLAMPS a vendor's
// COMPLETED to READY (a vendor marking done means "handed to runner", not
// order-complete). The server has always known that; the tracking view did not, and
// re-derived the arm logic by hand. That gap is a live trap: a vendor COMPLETED
// rendering "Order complete! Enjoy your food." while the runner still has the food.
// Sharing this function makes the two AGREE BY CONSTRUCTION rather than merely
// preventing the reader from contradicting the writer.
//
// Fulfillment arms (branch per-ORDER on that order's own fulfillmentType):
//   • BOOTH_PICKUP            → vendor-driven completion (tops out at COMPLETED)
//   • CURBSIDE | HOME_DELIVERY → runner-driven completion (vendor base tops out
//                                at READY; completion is the runner overlay)
//   CURBSIDE IS ON THE DELIVERY ARM — it uses a runner, so it derives like
//   HOME_DELIVERY, never like BOOTH_PICKUP. (Matches the runner-feed filter,
//   which surfaces [HOME_DELIVERY, CURBSIDE].)
// ─────────────────────────────────────────────────────────────────────────────

import { TERMINAL_STATUSES, COMPLETED_STATUSES } from './order-status'

export type MasterStatus =
  | 'PENDING_PAYMENT' | 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY'
  | 'RUNNER_COLLECTED' | 'COMPLETED' | 'DELIVERED'
  | 'CANCELLED' | 'UNCOLLECTED' | 'UNDELIVERABLE'

export type FulfillmentType = 'BOOTH_PICKUP' | 'CURBSIDE' | 'HOME_DELIVERY'

// Per-vendor portion statuses (VendorOrderStatus.status is a free String column).
type VendorStatus =
  | 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COMPLETED'
  | 'DECLINED' | 'REFUNDED' | 'CANCELLED'

// ─── Rank tables ─────────────────────────────────────────────────────────────
// MASTER_RANK drives the monotonicity guard used in the WRITE phase (Phase 1+):
// the aggregator only ADVANCES master (rank must strictly increase), so a late
// vendor write can never regress DELIVERED → READY. Terminal OVERRIDES are
// absorbing — they apply from any non-terminal state and are never re-derived.
// COMPLETED and DELIVERED share rank 6 and are mutually exclusive by arm.

export const MASTER_RANK: Record<MasterStatus, number> = {
  PENDING_PAYMENT:  0,
  PLACED:           1,
  ACCEPTED:         2,
  PREPARING:        3,
  READY:            4,
  RUNNER_COLLECTED: 5,
  COMPLETED:        6, // booth terminal-success
  DELIVERED:        6, // delivery terminal-success (mutually exclusive with COMPLETED)
  // Terminal overrides — absorbing, not part of the forward ladder:
  CANCELLED:        99,
  UNCOLLECTED:      99,
  UNDELIVERABLE:    99,
}

// Terminal SUCCESS states (reachable by derivation).
const TERMINAL_SUCCESS = new Set<MasterStatus>(COMPLETED_STATUSES as readonly string[] as MasterStatus[])

// Terminal OVERRIDE states — externally/time-driven, NOT derivable from
// per-vendor truth. The reader treats a stored override the derivation can't
// reproduce as BENIGN (the write phase preserves it via a terminalOverride input).
const TERMINAL_OVERRIDE = new Set<MasterStatus>(['CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE'])

const ALL_TERMINAL = new Set<string>(TERMINAL_STATUSES as readonly string[])

// Per-vendor progress ladder (failed portions are filtered out before this).
const VENDOR_PROGRESS: Record<string, number> = {
  PLACED: 0, ACCEPTED: 1, PREPARING: 2, READY: 3, COMPLETED: 4,
}
const PROGRESS_TO_STATUS: MasterStatus[] = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED']

// A vendor portion is "out" (doesn't gate the order's progress) once it fails.
const FAILED_VENDOR = new Set<VendorStatus>(['DECLINED', 'REFUNDED', 'CANCELLED'])

/**
 * A vendor lane is FAILED (out of the running) — the same set the derivation filters on,
 * exported so display readers classify a lane exactly the way the aggregator does instead
 * of hand-rolling a fourth copy.
 */
export const isFailedVendorLane = (status: string): boolean =>
  FAILED_VENDOR.has(status as VendorStatus)

/**
 * ── CLOSING THE VENDOR LANE WHEN THE ORDER DIES ──────────────────────────────────────────────
 *
 * A master terminal OVERRIDE (UNDELIVERABLE / UNCOLLECTED / operator CANCELLED) is asserted, not
 * derived — so nothing about it touched the per-vendor rows, and the vendor's lane stayed at
 * whatever it was. That left the order sitting in a vendor's live queue forever (one had been in
 * Randy's "Ready" lane for 52 days) AND quietly earning: the estimator treats any non-failed lane
 * without a payout as "pending", so a dead order kept quoting take-home.
 *
 * WHICH TERMINAL VALUE IS A MONEY DECISION, not bookkeeping. `computeVendorOrderEarnings` zeroes
 * on DECLINED and ONLY on DECLINED; CANCELLED keeps the money. So:
 *     DECLINED  = "$0 — the vendor never touched this"
 *     CANCELLED = "paid — the vendor did the work, the order died for other reasons"
 *
 * THE POLICY: the vendor is made whole whenever THEY DID THE WORK.
 *   • UNDELIVERABLE — food was made, the runner failed to deliver it → CANCELLED (paid).
 *   • UNCOLLECTED   — food was made, the customer never showed      → CANCELLED (paid).
 *   • operator CANCELLED — PER LANE, because a cancel can land at any moment:
 *        PLACED / ACCEPTED  → DECLINED  ($0 — work had not started)
 *        PREPARING / READY  → CANCELLED (paid — work was done)
 *
 * ⚠️ PER-LANE, NEVER PER-ORDER. Order #OMKVUDXZ is the proof: one lane was still PLACED while
 * another had already reached COMPLETED. A blanket flip of "every open lane on a cancelled order"
 * to DECLINED would have zeroed a vendor who had finished the food.
 *
 * COMPLETED IS ABSENT FROM EVERY SET BELOW, deliberately. It is terminal SUCCESS: a vendor who
 * finished keeps that fact and their money however the order later died.
 *
 * ⚠️ NEVER write UNDELIVERABLE / UNCOLLECTED into a VendorOrderStatus row. Those are MASTER-only
 * statuses; VOS has a smaller alphabet, and `deriveMasterStatus` THROWS on an unrecognised active
 * lane (see VENDOR_PROGRESS below) — so a master-only value here would break every future
 * re-derive of that order, permanently.
 */
const OPEN_VENDOR_LANES      = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'] as const
/** Open lanes where the vendor had NOT started — $0 on an operator cancel. */
const UNSTARTED_VENDOR_LANES = ['PLACED', 'ACCEPTED'] as const
/** Open lanes where the vendor HAD done the work — paid, even though the order died. */
const WORKED_VENDOR_LANES    = ['PREPARING', 'READY'] as const

/** The master targets that must close their vendor lanes. */
export type LaneClosingTarget = 'UNDELIVERABLE' | 'UNCOLLECTED' | 'CANCELLED'

/**
 * Idempotent by construction: every update is status-conditional, so a re-run matches nothing.
 * Exported for the guard, which asserts the mapping rather than re-describing it.
 */
export function vendorLaneClosePlan(
  target: LaneClosingTarget,
): { from: readonly string[]; to: VendorStatus }[] {
  if (target === 'CANCELLED') {
    return [
      { from: UNSTARTED_VENDOR_LANES, to: 'DECLINED' },
      { from: WORKED_VENDOR_LANES,    to: 'CANCELLED' },
    ]
  }
  // Undeliverable / uncollected: the food was made in both cases.
  return [{ from: OPEN_VENDOR_LANES, to: 'CANCELLED' }]
}

const DELIVERY_ARM = new Set<FulfillmentType>(['HOME_DELIVERY', 'CURBSIDE'])

/** Is this order fulfilled by a runner (delivery arm), not by the vendor at the booth? */
export const isDeliveryArm = (fulfillmentType: string): boolean =>
  DELIVERY_ARM.has(fulfillmentType as FulfillmentType)

// ─── Derivation inputs ───────────────────────────────────────────────────────

export interface DeriveInput {
  fulfillmentType: FulfillmentType
  vendorStatuses: { status: string }[]
  // Runner overlay (delivery arm only): set by the runner's claim / deliver
  // transitions. The derivation reads them but never writes them.
  runnerId?: string | null
  deliveryProofPath?: string | null // present once the runner confirms delivery
  voided?: boolean                 // voidedAt set → excluded from the model
}

export interface DeriveResult {
  derived: MasterStatus | 'SKIP'
  arm: 'booth' | 'delivery' | 'none'
  reason: string
}

// ─── The pure derivation ─────────────────────────────────────────────────────

export function deriveMasterStatus(input: DeriveInput): DeriveResult {
  if (input.voided) {
    return { derived: 'SKIP', arm: 'none', reason: 'order is voided (out of model)' }
  }

  const rows = input.vendorStatuses.map(v => v.status as VendorStatus)

  // No per-vendor truth exists → the aggregator has NO JURISDICTION and abstains.
  // (Genuinely pre-placement PENDING_PAYMENT is owned by placement/W2, not here;
  // legacy/pre-migration rowless orders must never be re-derived. Live sweep
  // proved deriving PENDING_PAYMENT here mis-flags real PLACED/terminal orders.)
  if (rows.length === 0) {
    return { derived: 'SKIP', arm: 'none', reason: 'no VendorOrderStatus rows — abstain (no jurisdiction)' }
  }

  const active = rows.filter(s => !FAILED_VENDOR.has(s))

  // No active portions remain — every portion is declined / refunded / cancelled.
  if (active.length === 0) {
    // CANCELLED is only safe when every portion was DECLINED (genuinely never
    // fulfilled). A REFUNDED portion is a MONEY event, NOT a fulfillment-failure:
    // it may have been COMPLETED/DELIVERED first (post-fulfillment refund,
    // chargeback, incident). REFUNDED overwrote the prior fulfillment state, so
    // it's lossy — we cannot tell cancelled-refund from completed-then-refund.
    // Money-truth lives in Refund rows; the fulfillment aggregator must NOT
    // fabricate CANCELLED from refund state. Abstain. (Live sweep caught this:
    // a COMPLETED order with all portions refunded was deriving CANCELLED, and
    // the write guard WOULD have advanced two PLACED ones to CANCELLED.)
    const anyRefunded = rows.some(s => s === 'REFUNDED')
    if (anyRefunded) {
      return { derived: 'SKIP', arm: 'none', reason: 'all portions terminal incl. REFUNDED — abstain (lossy money state)' }
    }
    return { derived: 'CANCELLED', arm: 'none', reason: 'all vendor portions DECLINED — never fulfilled' }
  }

  const isDelivery = DELIVERY_ARM.has(input.fulfillmentType)
  const arm = isDelivery ? 'delivery' : 'booth'

  // Vendor-derived base = the MINIMUM progress across active portions. "All ready
  // → READY"; "one still preparing → PREPARING" falls out of the min.
  // An unrecognized ACTIVE status must fail LOUD, never silently rank 0 → PLACED. `?? 0`
  // here was the exact silent-default trap the codebase sweeps for: an unknown input
  // producing an answer instead of admitting it doesn't have one — and in this money-adjacent
  // aggregator it's worse than a flicker (it would derive PLACED on, e.g., a delivered order
  // if someone wrote VOS='DELIVERED', which is NOT a VendorStatus). Throw so it can't hide.
  const minProgress = Math.min(...active.map(s => {
    const p = VENDOR_PROGRESS[s]
    if (p === undefined) {
      throw new Error(`[deriveMasterStatus] unrecognized active VendorOrderStatus "${s}" — not in VENDOR_PROGRESS. A money-adjacent derivation must fail loud, not silently rank it 0 (PLACED).`)
    }
    return p
  }))
  const base = PROGRESS_TO_STATUS[minProgress]

  if (!isDelivery) {
    // BOOTH_PICKUP — vendor-driven completion; base may reach COMPLETED.
    return { derived: base, arm, reason: `booth: min vendor progress = ${base}` }
  }

  // DELIVERY arm — vendor base tops out at READY. A vendor portion marked
  // COMPLETED on a delivery order means "handed to runner", NOT order-complete;
  // it clamps to READY and the runner overlay decides the rest.
  const clampedRank = Math.min(MASTER_RANK[base], MASTER_RANK.READY)

  if (clampedRank < MASTER_RANK.READY) {
    const status = (MASTER_RANK.ACCEPTED === clampedRank ? 'ACCEPTED'
      : MASTER_RANK.PREPARING === clampedRank ? 'PREPARING'
      : 'PLACED') as MasterStatus
    return { derived: status, arm, reason: `delivery: not all ready (min = ${status})` }
  }

  // All active portions are READY (or COMPLETED→clamped). Runner overlay decides.
  if (input.deliveryProofPath) {
    return { derived: 'DELIVERED', arm, reason: 'delivery: runner confirmed (photo present)' }
  }
  if (input.runnerId) {
    return { derived: 'RUNNER_COLLECTED', arm, reason: 'delivery: claimed by runner, not yet delivered' }
  }
  return { derived: 'READY', arm, reason: 'delivery: all vendors ready, awaiting runner claim' }
}

// ─── Monotonicity guard (spec for the WRITE phase; shown now for review) ──────
// In Phase 1+ the aggregator applies the derived status ONLY when this allows it,
// as a status-conditional update. Never regress; never touch a terminal order;
// terminal overrides may absorb a non-terminal order.

export function canAdvance(stored: MasterStatus, derived: MasterStatus): boolean {
  if (stored === derived) return false                 // no-op
  if (ALL_TERMINAL.has(stored)) return false           // terminal is absorbing — never leave it
  if (TERMINAL_OVERRIDE.has(derived)) return true      // override may apply from any non-terminal
  return MASTER_RANK[derived] > MASTER_RANK[stored]    // otherwise: strictly forward only
}

// ─── Divergence classification (the Phase 0 report) ──────────────────────────

export type Divergence =
  | 'MATCH'
  | 'UNDER_ADVANCED'   // stored lags behind truth — the BUG class (handoff etc.)
  | 'BENIGN_OVERRIDE'  // stored is a terminal override derivation can't see — expected
  | 'REGRESSION_RISK'  // derivation wants to move backward — MUST be empty
  | 'UNEXPECTED'       // anything else — investigate

export function classifyDivergence(stored: MasterStatus, derived: MasterStatus | 'SKIP'): Divergence {
  if (derived === 'SKIP') return 'MATCH' // voided orders are excluded
  if (stored === derived) return 'MATCH'

  // Stored is an externally-set terminal the derivation legitimately cannot
  // reproduce from per-vendor truth (payment-fail cancel, no-show timeout, …).
  if (TERMINAL_OVERRIDE.has(stored) && !TERMINAL_OVERRIDE.has(derived)) return 'BENIGN_OVERRIDE'

  const rs = MASTER_RANK[stored]
  const rd = MASTER_RANK[derived]

  // Both on the forward ladder (ranks < 99): compare position.
  if (rs < 99 && rd < 99) {
    if (rd > rs) return 'UNDER_ADVANCED'
    if (rd < rs) return 'REGRESSION_RISK'
  }
  return 'UNEXPECTED'
}
