// ─────────────────────────────────────────────────────────────────────────────
// deriveOrderView — THE single derivation of what a customer's order LOOKS LIKE
// ─────────────────────────────────────────────────────────────────────────────
//
// Every customer-facing tracking surface renders from this one result. Nothing
// downstream reads `order.status`, a VendorOrderStatus row, or a live-pushed
// status directly — they ask this function and render the answer.
//
// ── WHY IT EXISTS ────────────────────────────────────────────────────────────
//
// Order state had fragmented into four representations that kept drifting:
// master Order.status, per-vendor vendorOrderStatuses[].status, a client
// `liveStatus` variable, and the RTDB push feeding it. The tracking views each
// picked a different one, with five different spellings of "this vendor's status"
// and three different fallbacks. Three real defects came out of that:
//
//   B1 (was LIVE) — `liveStatus` was a PER-VENDOR value wearing a master name.
//       api/orders/[id]/vendor-status pushes { status, vendorId } — one vendor's
//       status — to the CUSTOMER RTDB node, and the page did setLiveStatus(...)
//       unconditionally. MultiOrderTracking then asked TERMINAL_STATUSES.includes(
//       liveStatus). So on a two-vendor order, vendor A declining rendered the
//       customer's ENTIRE order as cancelled — cancel and support buttons gone —
//       while vendor B was still cooking. Master status was fine; only the client
//       lied, and a refresh fixed it, which is exactly why it survived unnoticed.
//       Killed structurally: `liveStatus` no longer exists, and the RTDB handler
//       is typed so a push carrying a vendorId can ONLY patch that vendor's lane.
//
//   B2 (was armed, unreachable) — the client wrote a per-vendor status into the
//       master field and did NOT apply the server's delivery-arm clamp, so a
//       vendor COMPLETED could render "Order complete! Enjoy your food." while the
//       runner still had the food. Killed BY CONSTRUCTION rather than by
//       prevention: displayStatus below comes from the SAME deriveMasterStatus the
//       writer uses (lib/order-derive.ts), which clamps a delivery-arm vendor
//       COMPLETED to READY. The reader cannot disagree with the writer because it
//       is not doing its own arithmetic.
//
//   B3 — `vendorOrderStatuses?.[0]` with no vendorId filter. Every lane is now
//       keyed by vendorId in `perVendor`; there is no positional read left.
//
// ── THE INVARIANT ────────────────────────────────────────────────────────────
//
// displayStatus advances exactly when reconcileMasterStatus would advance, because
// it runs the same derivation behind the same `canAdvance` monotonic guard. The
// display can therefore never be ahead of, nor behind, the state the server will
// converge to — it is a preview of the writer's own next move, not a second
// opinion about it.
//
// scripts/order-view-guard.ts pins all of the above.
// ─────────────────────────────────────────────────────────────────────────────

import {
  deriveMasterStatus,
  canAdvance,
  isFailedVendorLane,
  isDeliveryArm,
  MASTER_RANK,
  type MasterStatus,
  type FulfillmentType,
} from './order-derive'
import { isCompleted as isCompletedStatus, isFailed as isFailedStatus } from './order-status'
import { getStatusConfig } from './order-status-config'
import { deriveDeliveryProgress, type DeliveryProgress } from './delivery-progress'

/**
 * Per-vendor lane progress, 0-based, for the segmented bars. -1 = the lane failed
 * (rendered as a flat red rule rather than a partial bar).
 *
 * Moved here from components/order/helpers.ts: it is a derivation over status, not a
 * label map, so it belongs beside the other status derivations where the guard can see it.
 */
const VENDOR_LANE_STEP: Record<string, number> = {
  PLACED:    0,
  ACCEPTED:  1,
  PREPARING: 2,
  READY:     3,
  COMPLETED: 4,
  DECLINED:  -1,
  REFUNDED:  -1,
  CANCELLED: -1,
}

/** How many forward steps a vendor lane can show (Placed → Accepted → Preparing → Ready). */
export const VENDOR_LANE_STEP_COUNT = 4

export interface VendorLaneView {
  /** The raw VendorOrderStatus value for this vendor. */
  status: string
  /** Human label from the ONE shared status config. */
  label: string
  /** Tailwind class for the lane's status dot. */
  dotColor: string
  /** 0-based lane progress; -1 when the lane failed. */
  step: number
  /** True when this vendor's portion is out of the running (declined/refunded/cancelled). */
  failed: boolean
}

/**
 * The milestone flags the timeline used to get from RAW status reads.
 *
 * Deliberately narrow: the timeline's per-vendor rows are driven by TIMESTAMPS
 * (acceptedAt, readyAt, …), which were never part of the status fragmentation and are
 * left alone. The only thing it read from a status was "is this delivered", which is
 * exactly the read that has to come through the derivation — so that is what lives here.
 */
export interface OrderTimelineView {
  delivered: boolean
}

export interface OrderView {
  /** The ONE headline status. Master-vocabulary, clamped, monotonic. */
  displayStatus: string
  isCancelled: boolean
  isCompleted: boolean
  canCancel: boolean
  /** Per-vendor lanes, keyed by vendorId — never positional. */
  perVendor: Map<string, VendorLaneView>
  /** Runner-fulfilled orders only (delivery arm); null for booth pickup. */
  delivery: DeliveryProgress | null
  /** True when this order is fulfilled by a runner (HOME_DELIVERY or CURBSIDE). */
  isRunnerOrder: boolean
  timeline: OrderTimelineView
}

export interface OrderViewInput {
  /** Master Order.status — SERVER-AUTHORITATIVE. Never a per-vendor value. */
  masterStatus: string
  /** Every vendor lane on the order, keyed by vendorId. */
  vendorStatuses: { vendorId: string; status: string }[]
  fulfillmentType: string
  runnerId?: string | null
  collectedAt?: string | Date | null
  deliveryProofPath?: string | null
  estimatedReadyAt?: string | null
}

export function deriveOrderView(input: OrderViewInput): OrderView {
  const { masterStatus, vendorStatuses, fulfillmentType } = input

  // ── displayStatus: the writer's derivation, behind the writer's guard ──────
  // deriveMasterStatus applies the delivery-arm clamp (vendor COMPLETED → READY)
  // and the runner overlay; canAdvance refuses anything that isn't a forward move
  // and treats a stored terminal as absorbing. Running BOTH is what makes the view
  // agree with the server by construction — see the B2 note in the header.
  const { derived } = deriveMasterStatus({
    fulfillmentType: fulfillmentType as FulfillmentType,
    vendorStatuses,
    runnerId: input.runnerId,
    deliveryProofPath: input.deliveryProofPath,
  })

  let displayStatus = masterStatus
  if (derived !== 'SKIP') {
    // An unranked master (empty string mid-load, or a value outside the ladder) has no
    // position to compare against, so canAdvance can't answer. Prefer the derivation
    // rather than rendering a status the derivation says is impossible.
    const storedIsRanked = MASTER_RANK[masterStatus as MasterStatus] !== undefined
    if (!storedIsRanked || canAdvance(masterStatus as MasterStatus, derived)) {
      displayStatus = derived
    }
  }

  const isCompleted = isCompletedStatus(displayStatus)
  const isCancelled = isFailedStatus(displayStatus)

  // ── canCancel: no ACTIVE lane has moved past PLACED ────────────────────────
  // Scoped to active lanes on purpose. A two-vendor order where one vendor declined
  // and the other hasn't accepted yet is still cancellable — the declined lane is out
  // of the running and must not veto the live one. (This preserves the old
  // multi-vendor `!anyVendorAccepted` behaviour while giving the single-vendor case
  // the same rule instead of its own.)
  const activeLanes = vendorStatuses.filter(v => !isFailedVendorLane(v.status))
  const cancellableLanes = vendorStatuses.length === 0
    // No lanes at all (legacy/rowless order): fall back to the master status, which is
    // what the single-vendor view used to do via its liveStatus fallback.
    ? masterStatus === 'PLACED'
    : activeLanes.length > 0 && activeLanes.every(v => v.status === 'PLACED')
  const canCancel = !isCancelled && !isCompleted && cancellableLanes

  // ── Per-vendor lanes ───────────────────────────────────────────────────────
  const perVendor = new Map<string, VendorLaneView>()
  for (const vs of vendorStatuses) {
    const config = getStatusConfig(vs.status)
    perVendor.set(vs.vendorId, {
      status:   vs.status,
      label:    config.label,
      dotColor: config.dotColor,
      step:     VENDOR_LANE_STEP[vs.status] ?? 0,
      failed:   isFailedVendorLane(vs.status),
    })
  }

  // ── Delivery progress (runner arm only) ────────────────────────────────────
  // BOTH inputs are displayStatus, deliberately. deriveDeliveryProgress takes a vendor
  // status and a master status because it predates this collapse and had to reconcile two
  // readers itself; now there is only one status, so it gets the same value twice.
  //
  // ⚠️ FEEDING THE RAW VENDOR LANE HERE WOULD LEAVE B2 HALF-ALIVE. deriveDeliveryProgress
  // treats `vendorStatus === 'COMPLETED'` as order-complete (delivery-progress.ts:56 — the
  // customer-walks-curbside close). On a HOME_DELIVERY order a vendor COMPLETED means
  // "handed to runner", so the raw lane renders "Order complete! Enjoy your food." at
  // segment 6 while the runner still has the food — verified, not assumed. displayStatus
  // has already been through the arm clamp, so it reads READY/segment 3 instead.
  //
  // The customer-walks-curbside close still works: it arrives via the MASTER reaching
  // COMPLETED, which displayStatus carries, rather than via a lane that the delivery arm
  // says means something else.
  const isRunnerOrder = isDeliveryArm(fulfillmentType)
  const delivery = isRunnerOrder
    ? deriveDeliveryProgress({
        vendorStatus:     displayStatus,
        masterStatus:     displayStatus,
        runnerId:         input.runnerId,
        collectedAt:      input.collectedAt,
        estimatedReadyAt: input.estimatedReadyAt ?? null,
      })
    : null

  return {
    displayStatus,
    isCancelled,
    isCompleted,
    canCancel,
    perVendor,
    delivery,
    isRunnerOrder,
    timeline: { delivered: displayStatus === 'DELIVERED' },
  }
}
