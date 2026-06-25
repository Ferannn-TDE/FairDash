/**
 * Operational alert notifications.
 *
 * Sends to Slack via incoming webhook when SLACK_WEBHOOK_URL is set.
 * All functions are fire-and-forget — a notification failure never propagates
 * to the caller. Configure SLACK_WEBHOOK_URL in .env.local to enable.
 */

import { logger } from './logger'

interface SlackBlock {
  type: string
  text?: { type: string; text: string }
  fields?: { type: string; text: string }[]
}

async function postToSlack(text: string, blocks?: SlackBlock[]): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return

  try {
    await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text, blocks }),
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
