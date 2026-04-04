import { NextRequest } from 'next/server'
import { OrderStatus, FulfillmentType } from '@prisma/client'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { getRealtimeDb } from '@/lib/firebase-admin'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import {
  getOrderQueue,
  JOB_UNCOLLECTED,
  JOB_UNDELIVERABLE,
} from '@/lib/queues'
import { CURBSIDE_WAIT_TIMEOUT_MS, ORDER_CANCELLATION_FEE_USD } from '@/lib/constants'

// PATCH /api/orders/:id/status
// Advance an order through its lifecycle. Caller must be a VendorMember of the order's vendor.
//
// Valid transitions (vendor-initiated):
//   PLACED     → ACCEPTED  | CANCELLED
//   ACCEPTED   → PREPARING | CANCELLED
//   PREPARING  → READY     | CANCELLED
//   READY      → COMPLETED | CANCELLED
//
// Side-effects per transition:
//   → READY:     schedule BullMQ delayed job (UNCOLLECTED / UNDELIVERABLE)
//   → COMPLETED: stripe.transfers.create + write Payout record
//   → CANCELLED: stripe.refunds.create  + write Cancellation record
//   All:         Firebase RTDB write to orders/{vendorId}/{orderId}
//                             and customerOrders/{customerId}/{orderId}

// ─── Transition table ─────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.PLACED]:    [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  [OrderStatus.ACCEPTED]:  [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY, OrderStatus.CANCELLED],
  [OrderStatus.READY]:     [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const clerkId = await requireAuth()

    // ── 1. Load order ──────────────────────────────────────────────────────
    const order = await db.order.findUnique({
      where: { id: params.id },
      include: { vendor: true },
    })

    if (!order) return apiError('Order not found', 404, 'ORDER_NOT_FOUND')

    // ── 2. Verify caller is a VendorMember of this order's vendor ──────────
    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    const isMember = await db.vendorMember.findFirst({
      where: { vendorId: order.vendorId, userId: dbUser.id },
    })
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

    // ── 3. Parse + validate requested transition ───────────────────────────
    const body = await req.json()
    const { status: newStatus, reason } = body as {
      status: OrderStatus
      reason?: string
    }

    if (!newStatus) {
      throw new ApiError('status is required', 400, 'VALIDATION_ERROR')
    }

    const allowed = VALID_TRANSITIONS[order.status]
    if (!allowed) {
      throw new ApiError(
        `Order in ${order.status} state cannot be advanced`,
        409,
        'INVALID_TRANSITION'
      )
    }

    if (!allowed.includes(newStatus)) {
      throw new ApiError(
        `Cannot transition from ${order.status} to ${newStatus}`,
        409,
        'INVALID_TRANSITION'
      )
    }

    // ── 4. Build timestamp patch ───────────────────────────────────────────
    const timestampPatch: Record<string, Date> = {}
    if (newStatus === OrderStatus.ACCEPTED)  timestampPatch.acceptedAt  = new Date()
    if (newStatus === OrderStatus.READY)     timestampPatch.readyAt      = new Date()
    if (newStatus === OrderStatus.COMPLETED) timestampPatch.completedAt  = new Date()
    if (newStatus === OrderStatus.CANCELLED) timestampPatch.cancelledAt  = new Date()

    // ── 5. Apply DB update (status + timestamps) ───────────────────────────
    const updatedOrder = await db.order.update({
      where: { id: order.id },
      data: {
        status: newStatus,
        // ACCEPTED: mark the "Start Order" moment and lock in the cancellation fee.
        // From this point, any customer cancellation retains ORDER_CANCELLATION_FEE_USD.
        ...(newStatus === OrderStatus.ACCEPTED && {
          startedAt: new Date(),
          cancellationFee: ORDER_CANCELLATION_FEE_USD,
        }),
        ...(newStatus === OrderStatus.CANCELLED && {
          cancelledBy: 'vendor',
          cancellationReason: reason ?? null,
        }),
        ...timestampPatch,
      },
    })

    // ── 6. Side-effects per transition ─────────────────────────────────────

    // 6a. READY → schedule delayed BullMQ job ──────────────────────────────
    if (newStatus === OrderStatus.READY) {
      const queue = getOrderQueue()
      if (queue) {
        const jobData = { orderId: order.id, vendorId: order.vendorId, eventId: order.eventId }

        if (order.fulfillmentType === FulfillmentType.HOME_DELIVERY) {
          // HOME_DELIVERY → UNDELIVERABLE after 10 min (playbook: curbside wait time)
          await queue.add(JOB_UNDELIVERABLE, jobData, { delay: CURBSIDE_WAIT_TIMEOUT_MS })
        } else {
          // BOOTH_PICKUP + CURBSIDE → UNCOLLECTED after 10 min
          await queue.add(JOB_UNCOLLECTED, jobData, { delay: CURBSIDE_WAIT_TIMEOUT_MS })
        }
      }
    }

    // 6b. COMPLETED → Stripe transfer + Payout record ─────────────────────
    if (newStatus === OrderStatus.COMPLETED) {
      await handleCompleted(order, updatedOrder)
    }

    // 6c. CANCELLED → Stripe refund + Cancellation record ─────────────────
    if (newStatus === OrderStatus.CANCELLED) {
      await handleCancelled(order, reason)
    }

    // ── 7. Firebase RTDB writes (best-effort) ──────────────────────────────
    const rtdb = getRealtimeDb()
    if (rtdb) {
      const now = Date.now()
      const patch = { status: newStatus, updatedAt: now }

      rtdb
        .ref(`fairs/${order.eventId}/orders/${order.vendorId}/${order.id}`)
        .update(patch)
        .catch(err => console.error('[Status] RTDB vendor write failed:', err))

      rtdb
        .ref(`fairs/${order.eventId}/customerOrders/${order.customerId}/${order.id}`)
        .update(patch)
        .catch(err => console.error('[Status] RTDB customer write failed:', err))
    }

    return success({ orderId: order.id, status: newStatus })
  } catch (err) {
    return handleApiError(err)
  }
}

// ─── COMPLETED side-effect ────────────────────────────────────────────────────

async function handleCompleted(
  order: { id: string; vendorId: string; eventId: string; stripePaymentIntentId: string | null; stripeChargeId: string | null; subtotal: number; fairSynqFee: number; vendorPayout: number; vendor: { stripeAccountId: string | null; stripeVerified: boolean } },
  _updatedOrder: unknown
) {
  const vendor = order.vendor

  // Only trigger Stripe transfer for verified Connect vendors (OPTION_A)
  if (!vendor.stripeAccountId || !vendor.stripeVerified) {
    console.log(`[Status] Vendor ${order.vendorId} not on Stripe Connect — skipping transfer (manual settlement)`)
    return
  }

  // Retrieve the charge ID from the PaymentIntent if not already stored
  let chargeId = order.stripeChargeId
  if (!chargeId && order.stripePaymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId, {
        expand: ['latest_charge'],
      })
      const charge = pi.latest_charge
      if (charge && typeof charge === 'object' && 'id' in charge) {
        chargeId = charge.id as string
        // Persist it for idempotency
        await db.order.update({
          where: { id: order.id },
          data: { stripeChargeId: chargeId },
        })
      }
    } catch (err) {
      console.error('[Status] Failed to retrieve charge from PI:', err)
    }
  }

  // Create the transfer with idempotency key to prevent double-payout
  const idempotencyKey = `transfer-completed-${order.id}`
  const transferAmountCents = Math.round(order.vendorPayout * 100)

  try {
    const transfer = await stripe.transfers.create(
      {
        amount: transferAmountCents,
        currency: 'usd',
        destination: vendor.stripeAccountId,
        ...(chargeId && { source_transaction: chargeId }),
        metadata: { orderId: order.id, vendorId: order.vendorId },
      },
      { idempotencyKey }
    )

    // Write Payout record and stripeTransferId to order atomically
    await db.$transaction([
      db.order.update({
        where: { id: order.id },
        data: { stripeTransferId: transfer.id },
      }),
      db.payout.create({
        data: {
          eventId: order.eventId,
          vendorId: order.vendorId,
          grossAmount: order.subtotal,
          fairSynqFee: order.fairSynqFee,
          netAmount: order.vendorPayout,
          stripeTransferId: transfer.id,
          stripeStatus: 'pending',
          processedAt: new Date(),
        },
      }),
    ])

    console.log(`[Status] Transfer ${transfer.id} created for order ${order.id}`)
  } catch (err) {
    // Log but don't fail the status update — payout can be retried separately
    console.error(`[Status] Stripe transfer failed for order ${order.id}:`, err)
  }
}

// ─── CANCELLED side-effect ────────────────────────────────────────────────────

async function handleCancelled(
  order: { id: string; vendorId: string; stripePaymentIntentId: string | null; stripeChargeId: string | null; total: number },
  reason?: string
) {
  let refundAmount: number | null = null
  let refundIssued = false

  // Issue Stripe refund if a PaymentIntent exists
  if (order.stripePaymentIntentId) {
    try {
      // Try to refund via charge; fall back to PI-level refund
      const chargeId = order.stripeChargeId
      const refund = chargeId
        ? await stripe.refunds.create({
            charge: chargeId,
            metadata: { orderId: order.id, reason: reason ?? 'vendor_cancelled' },
          })
        : await stripe.refunds.create({
            payment_intent: order.stripePaymentIntentId,
            metadata: { orderId: order.id, reason: reason ?? 'vendor_cancelled' },
          })

      refundAmount = refund.amount / 100
      refundIssued = true
      console.log(`[Status] Refund ${refund.id} issued for order ${order.id} — $${refundAmount}`)
    } catch (err) {
      console.error(`[Status] Stripe refund failed for order ${order.id}:`, err)
    }
  }

  // Write Cancellation record (upsert — idempotent if worker also cancels)
  await db.cancellation.upsert({
    where: { orderId: order.id },
    create: {
      orderId: order.id,
      vendorId: order.vendorId,
      reason: reason ?? null,
      refundIssued,
      refundAmount,
    },
    update: {
      refundIssued,
      refundAmount,
    },
  })
}
