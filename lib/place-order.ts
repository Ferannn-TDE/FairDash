/**
 * Single point at which an order becomes "real" and visible to vendors.
 *
 * An order row is created up-front as PENDING_PAYMENT (so we can attach the
 * Stripe PaymentIntent and re-priced cart), but it carries NO vendor-visible
 * side-effects until payment actually succeeds. This function performs those
 * side-effects — and only those:
 *   1. flips the order to PLACED
 *   2. creates the per-vendor VendorOrderStatus rows (what the vendor kitchen
 *      queue actually queries)
 *   3. pushes the order to each vendor's Firebase RTDB path
 *   4. schedules the vendor accept-timeout job
 *
 * It is idempotent: it is called from BOTH the Stripe webhook
 * (payment_intent.succeeded — the reliable server-to-server backstop) and the
 * client confirm path. Whichever runs first wins; the second is a no-op.
 */

import { OrderStatus } from '@prisma/client'
import { db } from './db'
import { fireAndForgetFirebaseSet } from './firebase-sync'
import { getOrderQueue, JOB_UNACCEPTED } from './queues'
import { enqueueJobSafely } from './queue-safe'
import { VENDOR_ACCEPT_TIMEOUT_MS } from './constants'
import { logger } from './logger'

export interface PlaceOrderResult {
  placed: boolean   // true if THIS call performed the placement, false if it was already placed
}

/**
 * Promotes a paid order from PENDING_PAYMENT to PLACED and runs all
 * vendor-visible side-effects exactly once.
 *
 * @param orderId    The order to place.
 * @param chargeId   Optional Stripe charge id (from the PaymentIntent) to persist.
 */
export async function placePaidOrder(
  orderId: string,
  chargeId?: string | null,
): Promise<PlaceOrderResult> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      orderItems: { include: { menuItem: { select: { name: true } } } },
      vendorOrderStatuses: { select: { vendorId: true, status: true } },
    },
  })

  if (!order) {
    logger.error('[PlaceOrder] Order not found', { orderId })
    return { placed: false }
  }

  // Converge placement ONLY around the placement step. If the order has already
  // advanced past PLACED (ACCEPTED+) or is terminal (CANCELLED/DECLINED/…), there
  // is nothing to (re)place — never resurrect a dead or in-progress order.
  if (order.status !== OrderStatus.PENDING_PAYMENT && order.status !== OrderStatus.PLACED) {
    return { placed: false }
  }

  const flippedNow = order.status === OrderStatus.PENDING_PAYMENT
  const uniqueVendorIds = [...new Set(order.orderItems.map(oi => oi.vendorId))]

  // ── Atomic core: status flip (if needed) + per-vendor rows commit together ──
  // CRITICAL: the side-effects below are NOT gated on "did THIS caller flip the
  // status". They run on every call until the order is fully placed, so the
  // webhook backstop REPAIRS an order the client left half-done. The flip itself
  // is one-time (status-filtered updateMany); the row/Firebase/timeout
  // convergence is many-time-safe (skipDuplicates / idempotent set / jobId dedup).
  await db.$transaction(async tx => {
    if (flippedNow) {
      await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.PENDING_PAYMENT },
        data: { status: OrderStatus.PLACED, ...(chargeId ? { stripeChargeId: chargeId } : {}) },
      })
    } else if (chargeId) {
      // Backfill a missing charge id on an already-PLACED order (needed for payout).
      await tx.order.updateMany({
        where: { id: orderId, stripeChargeId: null },
        data: { stripeChargeId: chargeId },
      })
    }
    await tx.vendorOrderStatus.createMany({
      data: uniqueVendorIds.map(vid => ({ orderId, vendorId: vid, status: 'PLACED' as const })),
      skipDuplicates: true,
    })
  })

  // Re-read rows so we only push/animate vendors still at PLACED — never regress
  // a vendor who has already ACCEPTED while we converge a multi-vendor order.
  const rows = await db.vendorOrderStatus.findMany({
    where: { orderId },
    select: { vendorId: true, status: true },
  })
  const placedVendorIds = new Set(rows.filter(r => r.status === 'PLACED').map(r => r.vendorId))

  // Firebase push (idempotent set) for each still-PLACED vendor's node.
  const itemsByVendor: Record<string, { lines: string[]; subtotal: number; count: number }> = {}
  for (const oi of order.orderItems) {
    const bucket = (itemsByVendor[oi.vendorId] ??= { lines: [], subtotal: 0, count: 0 })
    bucket.lines.push(`${oi.itemName || oi.menuItem.name} ×${oi.quantity}`)
    bucket.subtotal += oi.subtotal
    bucket.count += oi.quantity
  }

  for (const [vid, bucket] of Object.entries(itemsByVendor)) {
    if (!placedVendorIds.has(vid)) continue
    fireAndForgetFirebaseSet(
      `fairs/${order.eventId}/orders/${vid}/${order.id}`,
      {
        orderId: order.id,
        status: 'PLACED',
        fulfillmentType: order.fulfillmentType,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        subtotal: parseFloat(bucket.subtotal.toFixed(2)),
        total: parseFloat(bucket.subtotal.toFixed(2)),
        itemCount: bucket.count,
        itemSummary: bucket.lines.join(', '),
        placedAt: Date.now(),
      },
      { orderId: order.id },
    )
  }

  // Mirror to the customer's RTDB feed so the order page flips to PLACED live.
  fireAndForgetFirebaseSet(
    `fairs/${order.eventId}/customerOrders/${order.customerId}/${order.id}`,
    { status: 'PLACED', updatedAt: Date.now() },
    { orderId: order.id },
  )

  // Schedule the accept-timeout (jobId dedupes — safe to call on convergence).
  const ordersQueue = getOrderQueue()
  if (ordersQueue) {
    const result = await enqueueJobSafely({
      queue: ordersQueue,
      name: JOB_UNACCEPTED,
      data: { orderId: order.id, vendorId: order.vendorId, eventId: order.eventId },
      jobId: `unaccepted-${order.id}`,
      delay: VENDOR_ACCEPT_TIMEOUT_MS,
      priority: 'normal',
    })
    if (result === 'dropped') {
      logger.error('[CRITICAL] Accept-timeout job dropped', { jobName: JOB_UNACCEPTED, orderId: order.id })
    }
  }

  logger.info('[PlaceOrder] Order placed/converged', { orderId: order.id, flippedNow })
  return { placed: true }
}
