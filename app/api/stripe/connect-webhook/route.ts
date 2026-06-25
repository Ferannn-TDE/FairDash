import { db } from '@/lib/db'
import { stripeConnect, getConnectStatus } from '@/lib/stripe-connect'
import { logger } from '@/lib/logger'

// POST /api/stripe/connect-webhook
//
// Receives V2 THIN events for Connect account changes. Thin events carry only an
// id + type; we retrieve the full event to act on it.
//
// stripe-node note: `parseThinEvent` was renamed to `parseEventNotification` in
// v19 (we run 22.x). It verifies the signature against the RAW request body —
// App Router route handlers do NOT pre-parse the body, so req.text() is raw.
//
// Local testing (Stripe CLI):
//   stripe listen --thin-events \
//     'v2.core.account[requirements].updated,v2.core.account[configuration.recipient].capability_status_updated' \
//     --forward-thin-to localhost:3000/api/stripe/connect-webhook
//   → put the printed whsec_… into .env.local as STRIPE_CONNECT_WEBHOOK_SECRET

// V2 account event types we act on (verified against the live event-types reference).
const HANDLED_EVENT_TYPES = new Set([
  'v2.core.account[requirements].updated',
  'v2.core.account[configuration.recipient].capability_status_updated',
  'v2.core.account[configuration.recipient].updated',
])

export async function POST(req: Request) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!secret) {
    logger.error('[ConnectWebhook] STRIPE_CONNECT_WEBHOOK_SECRET not set')
    return new Response('Webhook not configured', { status: 503 })
  }

  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature')
  if (!sig) return new Response('Missing signature', { status: 400 })

  let notification: { id: string; type: string }
  try {
    // Verifies the signature against the raw body and returns the thin notification.
    notification = stripeConnect.parseEventNotification(rawBody, sig, secret) as { id: string; type: string }
  } catch (err) {
    logger.warn('[ConnectWebhook] Signature verification failed', { error: String(err) })
    return new Response('Invalid signature', { status: 400 })
  }

  try {
    if (HANDLED_EVENT_TYPES.has(notification.type)) {
      // Retrieve the full event to read the related account.
      const event = await stripeConnect.v2.core.events.retrieve(notification.id)
      const accountId = (event as any).related_object?.id as string | undefined

      if (accountId) {
        // A connected account belongs to exactly ONE payee. Resolve across all
        // three Connect-bearing payee types (vendor / runner / organizer) by the
        // stored stripeAccountId, then mirror live status onto whichever matches.
        // The same display-cache fields exist on each model, so the update is
        // uniform — only the table differs.
        const [vendor, runner, organizer] = await Promise.all([
          db.vendor.findFirst({ where: { stripeAccountId: accountId }, select: { id: true } }),
          db.runner.findFirst({ where: { stripeAccountId: accountId }, select: { id: true } }),
          db.fairOrganizer.findFirst({ where: { stripeAccountId: accountId }, select: { id: true } }),
        ])

        const match =
          (vendor    && { kind: 'vendor'    as const, id: vendor.id }) ||
          (runner    && { kind: 'runner'    as const, id: runner.id }) ||
          (organizer && { kind: 'organizer' as const, id: organizer.id }) ||
          null

        if (match) {
          // Re-read live status and refresh the DB display cache for the payee.
          const status = await getConnectStatus(accountId)
          const data = {
            stripeVerified: status.readyToReceivePayments,
            ...(status.readyToReceivePayments ? { stripeConnectedAt: new Date() } : {}),
          }
          if (match.kind === 'vendor') {
            await db.vendor.update({ where: { id: match.id }, data })
          } else if (match.kind === 'runner') {
            await db.runner.update({ where: { id: match.id }, data })
          } else {
            await db.fairOrganizer.update({ where: { id: match.id }, data })
          }
          logger.info('[ConnectWebhook] Updated payee Stripe status', {
            payee: match.kind,
            id: match.id,
            type: notification.type,
            readyToReceivePayments: status.readyToReceivePayments,
          })
        } else {
          logger.warn('[ConnectWebhook] No payee for account', { accountId, type: notification.type })
        }
      }
    } else {
      logger.debug('[ConnectWebhook] Ignored event', { type: notification.type })
    }

    return Response.json({ received: true })
  } catch (err) {
    logger.error('[ConnectWebhook] Handler error', { error: String(err) })
    // 200 so Stripe doesn't retry forever on our internal errors; we logged it.
    return Response.json({ received: true, handled: false })
  }
}
