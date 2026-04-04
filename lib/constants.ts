// ============================================================================
// FAIRSYNQ PLATFORM CONSTANTS
// Single source of truth for all operational numbers.
// Source: Operations Playbook V4.0 | Updated April 2026
//
// NEVER hardcode these values elsewhere — always import from this file.
// When the playbook changes a number, change it here only.
// ============================================================================

// ── Payments ─────────────────────────────────────────────────────────────────

/** FairSynq platform fee applied to order subtotal only (not delivery fee). */
export const PLATFORM_FEE_RATE = 0.10

/** Flat cancellation fee charged to customer if they cancel after vendor accepts. */
export const ORDER_CANCELLATION_FEE_USD = 5.00

/** On-site consulting rate, invoiced manually — not enforced in platform logic. */
export const CONSULTING_RATE_USD = 1_500

// ── Order Timeouts (BullMQ job delays) ───────────────────────────────────────

/**
 * How long a vendor has to accept an order before it is auto-cancelled.
 * Playbook S2: "Vendor order acceptance window: 2 minutes"
 */
export const VENDOR_ACCEPT_TIMEOUT_MS = 2 * 60 * 1000 // 2 minutes

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
