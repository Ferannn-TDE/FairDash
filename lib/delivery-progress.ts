import { FAILED_STATUSES } from './order-status'

/**
 * THE single derivation of a runner-fulfilled order's customer-facing progress — one function,
 * one bar, one message. Kills the two-readers split where StatusBanner returned null once the
 * runner collected (the banner vanished in transit) while the pill/bar mapped
 * READY and RUNNER_COLLECTED both to "Ready / 80%" — two readers, two different lies about the
 * same order. Every element on the tracking view renders from THIS result.
 *
 * The custody columns are the truth source for the runner half, same as the escape path:
 * master RUNNER_COLLECTED means CLAIMED (runner heading to the booth — the customer's food is
 * still on the counter, so "Picked up" is NOT reached); collectedAt set means the bag is in the
 * runner's hand (Picked up done, Delivering active); DELIVERED completes the bar.
 */

export const DELIVERY_SEGMENTS = [
  'Placed', 'Accepted', 'Preparing', 'Ready', 'Picked up', 'Delivering', 'Delivered',
] as const

export interface DeliveryProgressInput {
  /** The displayed status: this vendor's VOS row ?? master (same fallback the readers use). */
  vendorStatus: string
  masterStatus: string
  runnerId?: string | null
  collectedAt?: string | Date | null
  estimatedReadyAt?: string | null
}

export interface DeliveryProgress {
  /** Index into DELIVERY_SEGMENTS: segments 0..activeIndex are reached. */
  activeIndex: number
  state: 'active' | 'complete' | 'failed'
  /** The ONE status line. No other component words the order's state. */
  message: string
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function deriveDeliveryProgress(i: DeliveryProgressInput): DeliveryProgress {
  const failed = (s: string) => (FAILED_STATUSES as readonly string[]).includes(s)
  if (failed(i.vendorStatus) || failed(i.masterStatus)) {
    const s = failed(i.vendorStatus) ? i.vendorStatus : i.masterStatus
    const message =
      s === 'REFUNDED' ? 'This order was refunded.' :
      s === 'UNDELIVERABLE' ? 'This delivery could not be completed — you will be refunded.' :
      'This order was cancelled.'
    return { activeIndex: -1, state: 'failed', message }
  }

  if (i.masterStatus === 'DELIVERED' || i.vendorStatus === 'DELIVERED') {
    return { activeIndex: 6, state: 'complete', message: 'Delivered! We hope you enjoy your food.' }
  }
  // Vendor-completed close (customer-walks curbside): no runner leg, but the order is done.
  if (i.vendorStatus === 'COMPLETED' || i.masterStatus === 'COMPLETED') {
    return { activeIndex: 6, state: 'complete', message: 'Order complete! Enjoy your food.' }
  }
  if (i.collectedAt) {
    return { activeIndex: 5, state: 'active', message: 'Your runner has your order and is on the way.' }
  }
  if (i.masterStatus === 'RUNNER_COLLECTED') {
    // Claimed, bag not in hand yet — "Picked up" is honestly NOT reached.
    return { activeIndex: 3, state: 'active', message: 'A runner claimed your order and is heading to the booth.' }
  }

  switch (i.vendorStatus) {
    case 'READY':
      return { activeIndex: 3, state: 'active', message: 'Your order is ready — waiting for a runner to pick it up.' }
    case 'PREPARING':
    case 'ACCEPTED': {
      const eta = i.estimatedReadyAt ? ` Estimated ready at ${fmtTime(i.estimatedReadyAt)}.` : ''
      return { activeIndex: i.vendorStatus === 'PREPARING' ? 2 : 1, state: 'active', message: `The vendor is preparing your order.${eta}` }
    }
    default: // PLACED / PENDING_PAYMENT / unknown → the honest floor
      return { activeIndex: 0, state: 'active', message: 'Waiting for the vendor to accept your order (up to 2 minutes)…' }
  }
}
