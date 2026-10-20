import { stripeConnect, getConnectStatus } from '@/lib/stripe-connect'
import { handleConnectWebhook } from '@/lib/connect-status'
import { logger } from '@/lib/logger'

// POST /api/stripe/connect-webhook
//
// Receives V2 THIN events for Connect account changes (id + type only); the handler retrieves
// the event, re-reads the account's live status and hands it to lib/connect-status, the one
// writer of the payout gate. Status codes are chosen for Stripe's retry behaviour:
//   400 — missing/invalid signature (a retry can't fix it)
//   200 — handled, or an event type we don't act on
//   500 — anything that failed after a valid signature, so Stripe RETRIES; the writer is
//         idempotent (conditional updates), so a retry can only finish the job, never double it.
//
// stripe-node note: `parseThinEvent` was renamed to `parseEventNotification` in v19 (we run
// 22.x). It verifies the signature against the RAW body — App Router handlers don't pre-parse.
//
// Local testing (Stripe CLI):
//   stripe listen --thin-events \
//     'v2.core.account[requirements].updated,v2.core.account[configuration.recipient].capability_status_updated' \
//     --forward-thin-to localhost:3000/api/stripe/connect-webhook
//   → put the printed whsec_… into .env.local as STRIPE_CONNECT_WEBHOOK_SECRET
export async function POST(req: Request) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!secret) {
    logger.error('[ConnectWebhook] STRIPE_CONNECT_WEBHOOK_SECRET not set')
    return new Response('Webhook not configured', { status: 503 })
  }

  const result = await handleConnectWebhook(await req.text(), req.headers.get('stripe-signature'), secret, {
    parse: (body, sig, sec) => stripeConnect.parseEventNotification(body, sig, sec) as { id: string; type: string },
    retrieveAccountId: async id => ((await stripeConnect.v2.core.events.retrieve(id)) as any).related_object?.id as string | undefined,
    live: getConnectStatus,
  })
  return typeof result.body === 'string'
    ? new Response(result.body, { status: result.status })
    : Response.json(result.body, { status: result.status })
}
