import { headers } from 'next/headers'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/db'
import { placePaidOrder } from '@/lib/place-order'
import { handleChargebackCreated, handleChargebackClosed } from '@/lib/process-chargeback'
import { handleApiError } from '@/lib/api-error'
import { logger } from '@/lib/logger'
import type Stripe from 'stripe'

// POST /api/webhooks/stripe
// Verifies the Stripe webhook signature and handles payment events.
// Configure in Stripe Dashboard → Webhooks → endpoint: /api/webhooks/stripe
// Events: payment_intent.succeeded, payment_intent.payment_failed, transfer.created
//
// NOTE: Full per-transaction payout logic is implemented in Part 3.
// This handler records the incoming event and updates order payment state.
export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    logger.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not set')
    return Response.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const headerPayload = await headers()
  const signature = headerPayload.get('stripe-signature')

  if (!signature) {
    return Response.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    logger.error('[Stripe Webhook] Signature verification failed', { error: String(err) })
    return Response.json({ error: 'Invalid webhook signature' }, { status: 400 })
  }

  // Idempotency check — Stripe retries webhooks on timeout; skip duplicates
  const existing = await db.processedWebhookEvent.findUnique({
    where: { stripeEventId: event.id },
  })
  if (existing) {
    return Response.json({ received: true, duplicate: true })
  }
  await db.processedWebhookEvent.create({
    data: { stripeEventId: event.id },
  })

  try {
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent
      const order = await db.order.findFirst({
        where: { stripePaymentIntentId: pi.id },
        select: { id: true },
      })
      if (order) {
        // Single, idempotent point of order placement. This is the reliable
        // server-to-server path: it fires even if the customer closed the tab
        // immediately after paying. Creates VendorOrderStatus rows, pushes to
        // Firebase, and schedules the accept-timeout — all the vendor-visible
        // side-effects that were intentionally deferred from order creation.
        const charge = (pi.latest_charge as string | null) ?? undefined
        await placePaidOrder(order.id, charge)
      }
      logger.info('[Stripe Webhook] payment_intent.succeeded', { piId: pi.id })

    } else if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent
      // DO NOT cancel the order here. A failed ATTEMPT is not a failed payment:
      // the PaymentIntent stays retryable (requires_payment_method), and our
      // checkout retries on the SAME PI (one cart → one PI → one Order). Cancelling
      // on payment_failed races the customer's retry — a retry that then SUCCEEDS
      // fires payment_intent.succeeded on the same PI, but placePaidOrder no-ops on
      // a now-CANCELLED order → captured money (automatic capture) stranded on a
      // cancelled order (charged-but-cancelled), on the common decline→retry flow.
      //
      // Leave the order PENDING_PAYMENT. A successful retry → payment_intent.succeeded
      // → placePaidOrder places it (correct). An abandoned-after-decline order is
      // swept by the reconciler's Pattern F, which asks Stripe the real PI state
      // (succeeded → place; canceled/missing → delete phantom; ambiguous → leave) —
      // never guessing from a non-terminal failed-attempt event. If we ever want
      // event-driven cancellation, the correct (terminal) event is
      // payment_intent.canceled, not payment_failed.
      logger.warn('[Stripe Webhook] payment_intent.payment_failed (order left PENDING_PAYMENT for retry)', { piId: pi.id })

    } else if (event.type === 'transfer.created') {
      // Record per-transaction payout in our Payout table
      const transfer = event.data.object as Stripe.Transfer
      const meta = transfer.metadata as Record<string, string>
      if (meta?.vendorId && meta?.eventId) {
        const gross = transfer.amount / 100
        const fee = parseFloat(meta.fairSynqFee ?? meta.fairDashFee ?? '0')
        await db.payout.upsert({
          where: { stripeTransferId: transfer.id },
          create: {
            vendorId: meta.vendorId,
            eventId: meta.eventId,
            grossAmount: gross,
            fairSynqFee: fee,
            netAmount: gross - fee,
            stripeTransferId: transfer.id,
            stripeStatus: 'pending',
          },
          update: {},
        })
      }
      logger.info('[Stripe Webhook] transfer.created', { transferId: transfer.id })

    } else if ((event.type as string) === 'charge.refunded') {
      // Money-truth reconciliation hook for refunds. The refund engine already
      // writes the COMPLETED Refund row; this confirms it from Stripe's side and
      // backstops any refund whose row didn't settle. We key off each refund's
      // metadata (orderId, vendorId) stamped by lib/process-refund.ts.
      const charge = event.data.object as Stripe.Charge
      const refunds = charge.refunds?.data ?? []
      for (const rf of refunds) {
        const meta = (rf.metadata ?? {}) as Record<string, string>
        if (!meta.orderId || !meta.vendorId) continue
        await db.refund.updateMany({
          where: { orderId: meta.orderId, vendorId: meta.vendorId, status: { not: 'COMPLETED' } },
          data: { status: 'COMPLETED', stripeRefundId: rf.id },
        })
      }
      logger.info('[Stripe Webhook] charge.refunded', { chargeId: charge.id, refunds: refunds.length })

    } else if ((event.type as string) === 'charge.dispute.created') {
      // Bank chargeback. Record + proportional vendor clawback + surface to admin.
      // Idempotent (Chargeback @unique + stable reversal keys) so redelivery no-ops.
      const dispute = event.data.object as Stripe.Dispute
      await handleChargebackCreated(dispute)

    } else if ((event.type as string) === 'charge.dispute.closed') {
      // WON/LOST reconciliation. WON surfaces for admin (no auto re-payment).
      const dispute = event.data.object as Stripe.Dispute
      await handleChargebackClosed(dispute)

    } else if (
      (event.type as string) === 'charge.dispute.funds_withdrawn' ||
      (event.type as string) === 'charge.dispute.funds_reinstated'
    ) {
      const dispute = event.data.object as Stripe.Dispute
      const reinstated = (event.type as string) === 'charge.dispute.funds_reinstated'
      await db.chargeback.updateMany({
        where: { stripeDisputeId: dispute.id },
        data: { fundsReinstated: reinstated },
      })
      logger.info(`[Stripe Webhook] ${event.type}`, { disputeId: dispute.id })

    } else {
      // transfer.paid and other non-typed events
      if ((event.type as string) === 'transfer.paid') {
        const obj = event.data.object as { id: string }
        // Guard with reversedAt: null so a transfer.paid arriving AFTER a reversal
        // never resurrects the payout to 'paid' — reversedAt is the source of truth.
        await db.payout.updateMany({
          where: { stripeTransferId: obj.id, reversedAt: null },
          data: { stripeStatus: 'paid', processedAt: new Date() },
        })
      }
      logger.debug('[Stripe Webhook] unhandled event', { type: event.type })
    }

    return Response.json({ received: true })
  } catch (err) {
    return handleApiError(err)
  }
}
