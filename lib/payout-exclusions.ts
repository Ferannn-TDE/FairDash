// The ONE protected-event check for the payout gap fix (BATCH-1 §19, payout gap Q2): used by BOTH the new
// UNDELIVERABLE / UNCOLLECTED payout trigger (lib/reconcile-order-status.ts) and the reconciler catch-up for those two
// states (Patterns C and S), so the two can never disagree about which orders are left alone.
//
// Protected events are the prod-write guard's list (Italian Fest 2026 is protected test data; its one UNDELIVERABLE
// order, $8, must never be auto-paid). Scope: ONLY the two new states. COMPLETED / DELIVERED behaviour is unchanged.
// Relative imports only: the worker loads this.
import { PROTECTED_EVENT_IDS } from './prod-write-guard'

export function isExcludedFromPayoutGapFix(eventId: string): boolean {
  return PROTECTED_EVENT_IDS.has(eventId)
}

/** The same exclusion as a Prisma where fragment, for the catch-up queries. */
export function payoutGapEventScope() {
  return { eventId: { notIn: [...PROTECTED_EVENT_IDS] } }
}
