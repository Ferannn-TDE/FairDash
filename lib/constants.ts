// ============================================================================
// FAIRSYNQ PLATFORM CONSTANTS
// Single source of truth for all operational numbers.
// Source: Operations Playbook V4.0 | Updated April 2026
//
// NEVER hardcode these values elsewhere — always import from this file.
// When the playbook changes a number, change it here only.
// ============================================================================

// ── Payments ─────────────────────────────────────────────────────────────────

/** Customer service fee applied to order subtotal only (not delivery fee). */
export const SERVICE_FEE_RATE = 0.10

/**
 * Customer-facing service fee, added ON TOP of the subtotal.
 * Computed in integer cents to avoid float drift. This is the ONLY service-fee
 * calculation — used by the checkout estimate, the payment summary, and the
 * Stripe PaymentIntent so all three quote and charge the identical amount.
 *
 * This 10% is FairSynq's ONLY revenue and it is kept CLEAN — Stripe processing
 * fees do NOT come out of it. Instead, vendors absorb the Stripe fee: each
 * vendor receives their subtotal slice minus their proportional share of the
 * real settled Stripe fee (computed in the payout worker, not here). There is
 * no vendor commission. (Vendor.commissionRate in the schema is a deprecated
 * leftover from an abandoned model and must not be read anywhere.)
 */
export function calculateServiceFee(subtotal: number): number {
  return Math.round(subtotal * 100 * SERVICE_FEE_RATE) / 100
}

/** Flat cancellation fee charged to customer if they cancel after vendor accepts. */
export const ORDER_CANCELLATION_FEE_USD = 5.00

/**
 * Refund window: how long AFTER an order is COMPLETED before the vendor payout
 * actually fires. The order completes immediately, but the payout is enqueued
 * with this delay so a refund WITHIN the window needs no transfer reversal —
 * the money is still in the platform balance, so the pending payout simply skips
 * the refunded vendor (see lib/process-refund.ts CASE 1). Only refunds AFTER the
 * payout has fired (past this window) require a Stripe transfer reversal (CASE 2).
 * The reconciler's COMPLETED-without-payout check (Pattern C) only flags orders
 * past completedAt + this window, so it never fires a payout early.
 */
export const REFUND_WINDOW_MS = 4 * 60 * 60 * 1000 // 4 hours

/** On-site consulting rate, invoiced manually — not enforced in platform logic. */
export const CONSULTING_RATE_USD = 1_500

// ── Order Timeouts (BullMQ job delays) ───────────────────────────────────────

/**
 * How long a vendor has to accept an order before it is auto-cancelled AND THE CUSTOMER IS
 * REFUNDED. Not a display timeout — expiry moves real money (workers/order-worker.ts:113
 * handleMarkUnaccepted → refundVendorPortion, actor 'system:accept-timeout').
 *
 * ── THE TRADE, CHOSEN DELIBERATELY (2026-08-01): 2 minutes → 10 minutes ─────────────────────
 * Playbook S2 originally specified 2 minutes. That is too tight for a vendor mid-rush: a busy
 * booth with a queue of walk-ups cannot reliably look at a tablet inside 120 seconds, and every
 * miss auto-refunds a paying customer who did nothing wrong.
 *
 * THE COST, STATED SO IT IS NOT DISCOVERED LATER: a customer who orders from a genuinely
 * UNATTENDED booth now waits 10 minutes before their refund starts, instead of 2. That is the
 * price of not punishing a busy vendor, and it is the right way round — a slow refund is
 * recoverable, a wrongly-cancelled order is a lost sale and a bad first impression. Revisit if
 * unattended-booth complaints outnumber missed-accept refunds.
 *
 * ⚠️ The delay is baked in AT ENQUEUE TIME (lib/place-order.ts, `delay:`). Changing this value
 * does NOT re-time jobs already sitting in Redis — those keep the fuse they were created with.
 * Only orders placed after deploy get the new window.
 *
 * The reconciler's Pattern E backstop derives its cutoff from this same constant
 * (lib/reconciler.ts:700), so it widens in step automatically — one value, not two.
 */
export const VENDOR_ACCEPT_TIMEOUT_MS = 10 * 60 * 1000

/** Whole minutes, for prose. Derived so copy cannot drift from the timer. */
export const VENDOR_ACCEPT_TIMEOUT_MINUTES = Math.round(VENDOR_ACCEPT_TIMEOUT_MS / 60_000)

/**
 * THE canonical sentence for an accept-timeout cancellation. Written to the Cancellation row,
 * the cancelled OrderEvent, and the customer's Firebase feed — so all three agree, and none of
 * them can outlive a change to the window above.
 */
export const VENDOR_DID_NOT_ACCEPT_REASON =
  `Vendor did not accept within ${VENDOR_ACCEPT_TIMEOUT_MINUTES} minutes`

/**
 * How long a Runner waits at curbside before the order is forfeited (no refund).
 * Also used for booth pickup uncollected timeout.
 * Playbook Quick Ref: "Curbside Runner wait time: 10 minutes then order forfeited"
 */
export const CURBSIDE_WAIT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

// ── Vendor Availability ───────────────────────────────────────────────────────

/**
 * If a vendor's heartbeat has not been received within this window,
 * they are automatically hidden from the customer menu.
 * Playbook Quick Ref: "Vendor offline auto-hide from menu: 5 minutes"
 */
export const VENDOR_OFFLINE_HEARTBEAT_MS = 5 * 60 * 1000 // 5 minutes

// ── Heartbeat ─────────────────────────────────────────────────────────────────

/**
 * How often connected devices (vendor dashboard, runner app, admin portal)
 * write a heartbeat to Firebase RTDB.
 * Playbook Quick Ref: "Admin heartbeat ping frequency: Every 30 seconds"
 */
export const ADMIN_HEARTBEAT_INTERVAL_MS = 30_000 // 30 seconds

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Minimum order completion rate required for a Runner to remain active.
 * Playbook Quick Ref: "Runner minimum completion rate: 90%"
 */
export const RUNNER_MIN_COMPLETION_RATE = 0.90

/**
 * Maximum GPS distance (in metres) between a Runner's location and the
 * delivery address before the platform will accept a HOME_DELIVERY completion.
 * Playbook Quick Ref: "Home delivery GPS radius: Within 100 meters of address"
 */
export const HOME_DELIVERY_GPS_RADIUS_M = 100

// ── Incidents & Disputes ──────────────────────────────────────────────────────

/**
 * How long the event operator has to respond to an IncidentReport before
 * an automatic refund is triggered.
 * Playbook S7: "Operator has 5 minutes to decide — if no response automatic refund triggers"
 */
export const INCIDENT_AUTO_REFUND_MS = 5 * 60 * 1000 // 5 minutes

/**
 * How long before an unresolved Dispute is automatically escalated.
 * Plan V4 Phase 3.6: 24-hour SLA.
 */
export const DISPUTE_ESCALATION_MS = 24 * 60 * 60 * 1000 // 24 hours

// ── Reports ───────────────────────────────────────────────────────────────────

/**
 * Maximum hours after event close before the post-event report must be delivered.
 * Playbook S11: "Post event report delivery: Within 48 hours of close"
 */
export const POST_EVENT_REPORT_HOURS = 48

// ── Cart ──────────────────────────────────────────────────────────────────────

/**
 * Maximum number of distinct vendors allowed in a single order.
 * Playbook Quick Ref: "Max vendors per order: 5"
 */
export const MAX_VENDORS_PER_ORDER = 5

/**
 * Delivery-custody strand clocks (Commit 2, U4). Time thresholds after which an order stuck
 * in a runner-custody state is FLAGGED for a human (reconciler Pattern V — flag only, never
 * auto-acts). One named home for all three, so no timing literals live scattered in the
 * reconciler; the per-runner concurrency cap will join these later.
 *   - claimedNotCollected  — PRE-collection, aged from dispatchedAt. Generous: the food is
 *     safe on the vendor's counter, and collectedAt-null is ambiguous (could be "collected but
 *     forgot to tap"), so this only ever flags — never auto-releases.
 *   - runnerUnreachable     — POST-collection, aged from collectedAt. Tighter: the food is in
 *     a runner's car, undelivered.
 *   - awaitingVendorConfirm — a return was requested, aged from returnRequestedAt. The vendor
 *     is a tap away from resolving it.
 */
export const STRAND_THRESHOLDS_MS = {
  claimedNotCollected:   15 * 60 * 1000, // 15 minutes
  runnerUnreachable:     10 * 60 * 1000, // 10 minutes
  awaitingVendorConfirm: 10 * 60 * 1000, // 10 minutes
} as const

/**
 * Minimum collected-order denominator before a runner's completion RATE is shown or judged
 * (decided 2026-07-23). Below this, the admin surface shows the raw delivered/collected counts
 * with "not enough deliveries" — no percentage, no bar, no <90% warning banner. A ratio over
 * N=1–4 turns one bad order into a 25–100-point swing, and the runners screen is where an admin
 * decides whether to keep someone on the roster — a percent sign over that little data is the
 * render-something-untrue class pointed at a human. Five is roughly where the banner becomes
 * actionable during a real fair day rather than during warm-up. One named home so retuning
 * after the first real event is a one-line change, like the strand thresholds above.
 */
export const RUNNER_COMPLETION_MIN_DENOMINATOR = 5
