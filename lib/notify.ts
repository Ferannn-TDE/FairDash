/**
 * Operational alert notifications.
 *
 * Sends to Slack via incoming webhook when SLACK_WEBHOOK_URL is set.
 * All functions are fire-and-forget — a notification failure never propagates
 * to the caller. Configure SLACK_WEBHOOK_URL in .env.local to enable.
 *
 * BOUNDED (2026-11-18): a Slack call gives up after SLACK_TIMEOUT_MS. Before, a hung webhook
 * hung its caller forever, and the catch never ran (unbounded-call class).
 */

import { logger } from './logger'

interface SlackBlock {
  type: string
  text?: { type: string; text: string }
  fields?: { type: string; text: string }[]
}

export const SLACK_TIMEOUT_MS = 5_000

async function postToSlack(text: string, blocks?: SlackBlock[]): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return

  try {
    await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text, blocks }),
      signal:  AbortSignal.timeout(SLACK_TIMEOUT_MS),
    })
  } catch (err) {
    logger.warn('[Notify] Slack delivery failed', { error: String(err) })
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Alert: BullMQ waiting queue depth exceeded threshold.
 * Fires from GET /api/admin/queues when waiting > QUEUE_DEPTH_THRESHOLD.
 */
export async function notifyQueueDepthAlert(waiting: number, threshold: number): Promise<void> {
  logger.warn('[Queue] Depth alert', { waiting, threshold })

  await postToSlack(`🚨 *Queue depth alert* — ${waiting} jobs waiting (threshold: ${threshold})`, [
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Waiting jobs:*\n${waiting}` },
        { type: 'mrkdwn', text: `*Threshold:*\n${threshold}` },
        { type: 'mrkdwn', text: `*Time:*\n${new Date().toISOString()}` },
        { type: 'mrkdwn', text: `*Action:*\nCheck /api/admin/queues for stuck jobs` },
      ],
    },
  ])
}

/**
 * Alert: process-vendor-payout job dropped — no queue, no fallback.
 * Financial impact: payout may need manual retry.
 */
export async function notifyPayoutDropped(orderId: string, vendorId: string): Promise<void> {
  logger.error('[CRITICAL] Payout dropped — manual intervention required', { orderId, vendorId })

  await postToSlack(`🔴 *CRITICAL: Vendor payout dropped* — manual retry required`, [
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Order ID:*\n${orderId}` },
        { type: 'mrkdwn', text: `*Vendor ID:*\n${vendorId}` },
        { type: 'mrkdwn', text: `*Time:*\n${new Date().toISOString()}` },
        { type: 'mrkdwn', text: `*Action:*\nManually trigger transfer via Stripe Dashboard` },
      ],
    },
  ])
}

/**
 * Vendor status change — fires when organizer approves, rejects, pauses, or suspends a vendor.
 * Informational, not critical.
 */
export async function notifyVendorStatusChange(
  vendorName: string,
  vendorId:   string,
  status:     string,
  fairName:   string,
  reason?:    string,
): Promise<void> {
  const emoji = status === 'ACTIVE' ? '✅' : status === 'REJECTED' ? '❌' : '⚠️'
  logger.info('[Vendor] Status changed', { vendorId, status, fairName })

  await postToSlack(`${emoji} *Vendor ${status.toLowerCase()}* — ${vendorName} @ ${fairName}`, [
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Vendor:*\n${vendorName}` },
        { type: 'mrkdwn', text: `*New status:*\n${status}` },
        { type: 'mrkdwn', text: `*Fair:*\n${fairName}` },
        { type: 'mrkdwn', text: `*Reason:*\n${reason ?? '—'}` },
      ],
    },
  ])
}

/**
 * Alert: process-refund job dropped — customer is charged but refund not issued.
 */
export async function notifyRefundDropped(orderId: string, vendorId: string): Promise<void> {
  logger.error('[CRITICAL] Refund dropped — manual intervention required', { orderId, vendorId })

  await postToSlack(`🔴 *CRITICAL: Customer refund dropped* — manual retry required`, [
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Order ID:*\n${orderId}` },
        { type: 'mrkdwn', text: `*Vendor ID:*\n${vendorId}` },
        { type: 'mrkdwn', text: `*Time:*\n${new Date().toISOString()}` },
        { type: 'mrkdwn', text: `*Action:*\nManually issue refund via Stripe Dashboard` },
      ],
    },
  ])
}

export interface MoneySettingChange {
  key: string
  label: string
  from: string
  to: string
  actorId: string
  actorType: string
  reason: string
}

/**
 * Notice: a money setting changed (item 10 / B1.13 stage 2). Sent after the save has committed,
 * through runAfterResponse; it never blocks or fails the save.
 */
export async function notifyMoneySettingChanged(c: MoneySettingChange): Promise<void> {
  logger.warn('[Settings] money setting changed', { key: c.key, from: c.from, to: c.to, actorId: c.actorId, actorType: c.actorType })
  await postToSlack(`💲 *Fee setting changed* — ${c.label}: ${c.from} → ${c.to}`, [
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Setting:*\n${c.label} (\`${c.key}\`)` },
        { type: 'mrkdwn', text: `*Change:*\n${c.from} → ${c.to}` },
        { type: 'mrkdwn', text: `*By:*\n${c.actorId} (${c.actorType})` },
        { type: 'mrkdwn', text: `*Reason:*\n${c.reason}` },
      ],
    },
  ])
}

/**
 * ALERT: checkout is refusing orders because the money settings can't be read (item 10 stage 3).
 * Rate-limited by lib/ordering-paused.ts (one per 10 minutes); key names go here, never to customers.
 */
export async function notifyOrderingPaused(detail: { missing: string[]; invalid: string[] }): Promise<void> {
  logger.error('[CRITICAL] Ordering paused — money settings unavailable', detail)
  const what = [
    detail.missing.length ? `missing: ${detail.missing.join(', ')}` : '',
    detail.invalid.length ? `invalid: ${detail.invalid.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  await postToSlack(`🚨 *Ordering is paused* — the fee settings can't be read (${what}). Checkout returns 503 until they're fixed in /admin/settings.`)
}
