// Notification outbox (Batch 1 item 9, B1.12) — every read and write of Notification lives here.
//
// WRITE: enqueue* take the caller's transaction client, so the notification commits (or rolls
//   back) with the application or decision it announces. createMany + skipDuplicates on the unique
//   dedupeKey makes a retried request a no-op.
// DELIVER: deliverDueNotifications runs from the worker every minute. It claims rows atomically
//   (PENDING → SENDING by id), so two workers never send the same row; retries 1/5/15/60 min up to
//   5 attempts, then FAILED. Admin rows resolve recipients from the alerts.email setting at send
//   time; with none set they wait (held: NO_ALERT_EMAIL).
// NO PROVIDER (production until EMAIL_TRANSPORT=resend is set on the worker): nothing is sent,
//   logged or marked SENT; rows are held with NO_EMAIL_PROVIDER. When a provider is connected,
//   held ADMIN alerts older than 48 hours are marked SKIPPED (kept, not deleted), held MENU-ALERT
//   emails older than 48 hours are marked EXPIRED (kept, never sent; audit H5 step 3), and
//   applicant emails go out whatever their age.
// SAFETY SWITCH (resend-email-v1): with EMAIL_SAFE_RECIPIENT_DOMAIN set, an email with any address
//   outside that domain is not sent: it waits (SAFE_RECIPIENT_DOMAIN), is never SENT or deleted,
//   and the log line names the template only.
// PROVIDER ANSWERS (lib/email/transport.ts EmailSendError): a 429 or a problem with OUR settings
//   (401, 403, bad from-address) waits without counting an attempt and stops the run; a provider
//   or network problem uses the retry ladder; an email that can never go out is FAILED at once.
// MENU ALERTS: queued by lib/menu-notify/digest.ts with audience 'user' and a `to` address.

import { Prisma, type PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'
import { getSetting } from '@/lib/settings'
import { SITE_URL } from '@/lib/seo'
import { CONTACT_EMAIL } from '@/lib/contact-info'
import {
  EmailSendError, getEmailTransport, outsideSafeDomain, resolveEmailTransport, safeRecipientDomain,
  type EmailTransport, type OutgoingEmail,
} from '@/lib/email/transport'
import { MENU_ALERT_TEMPLATE, MENU_ALERT_TEMPLATES, MENU_ALERT_EMAIL_EXPIRY_MS } from '@/lib/menu-notify/constants'
import type { MenuAlertEmailPayload } from '@/lib/menu-notify/digest'

type Tx = Pick<PrismaClient, 'notification'> | Prisma.TransactionClient

export type ApplicationKind = 'vendor' | 'organizer' | 'partner'
const KIND_LABEL: Record<ApplicationKind, string> = { vendor: 'vendor', organizer: 'organizer', partner: 'partner organization' }

export const BACKOFF_MINUTES = [1, 5, 15, 60] as const
export const MAX_ATTEMPTS = 5
export const STALE_ADMIN_ALERT_MS = 48 * 3600e3
export const NO_ALERT_EMAIL_RECHECK_MS = 5 * 60e3
/** An email held by the safety switch is looked at again after this long. */
export const SAFE_DOMAIN_RECHECK_MS = 15 * 60e3
/** Wait after a problem with our provider settings (401, 403, bad from-address). */
export const SETTINGS_HOLD_MS = 15 * 60e3
/** Wait after a 429 when Resend gives no Retry-After; a given one is kept within the bounds below. */
export const RATE_LIMIT_WAIT_MS = 15 * 60e3
export const RATE_LIMIT_WAIT_MIN_MS = 60e3
export const RATE_LIMIT_WAIT_MAX_MS = 24 * 3600e3
const SENDING_RECLAIM_MS = 10 * 60e3

// ── Templates ───────────────────────────────────────────────────────────────────────────────
export interface SignupAlertPayload { kind: ApplicationKind; name: string; contactName: string | null; email: string | null; phone: string | null }
/** `decidedBy` (vendor decisions): who decided, as the VENDOR may see it — "FairSynq" or the
 *  organizer's organization name, never a person (lib/reviewer-label.ts; Jordan, Nov 16). Absent on
 *  rows queued before Nov 16, which read as FairSynq. */
export interface DecisionPayload { kind: ApplicationKind; name: string; contactName: string | null; reason?: string; decidedBy?: string }
/** The organizer's notice that FairSynq decided a vendor on their event (strict-admin override). */
export interface OverridePayload { vendorName: string; fairName: string; decision: 'approved' | 'rejected'; reason: string; link: string }
export const VENDOR_OVERRIDE_TEMPLATE = 'vendor_override_organizer'
const byFairSynq = (p: DecisionPayload) => !p.decidedBy || p.decidedBy === 'FairSynq'

/** The templates themselves. Private: every caller goes through renderEmail, which makes the subject one safe line. */
function renderEmailParts(template: string, payload: unknown): { subject: string; text: string } {
  if (template === 'signup_admin_alert') {
    const p = payload as SignupAlertPayload
    const label = KIND_LABEL[p.kind]
    const contact = [p.contactName, p.email, p.phone].filter(Boolean).join(', ')
    return {
      subject: `New ${label} application: ${p.name}`,
      text: `${p.name} applied to join FairSynq as a ${label}.${contact ? ` Contact: ${contact}.` : ''} Review it at ${SITE_URL}/admin/approvals`,
    }
  }
  if (template === 'decision_approved') {
    const p = payload as DecisionPayload
    const hi = `Hi ${p.contactName || p.name}`
    const text =
      p.kind === 'vendor' ? `${hi}, ${p.name} is approved${byFairSynq(p) ? '' : ` by ${p.decidedBy}`}. Sign in to finish your setup (payouts and menu): ${SITE_URL}/sign-in/vendor`
      : p.kind === 'organizer' ? `${hi}, your organizer account is approved. Sign in to create your first fair: ${SITE_URL}/organizer/login`
      : `${hi}, ${p.name} is approved as a FairSynq partner organization. We'll be in touch about upcoming events.`
    return { subject: "You're approved on FairSynq", text }
  }
  if (template === 'decision_rejected') {
    const p = payload as DecisionPayload
    return {
      subject: 'Your FairSynq application',
      text: `Hi ${p.contactName || p.name}, ${byFairSynq(p) ? "we're" : `${p.decidedBy} is`} not able to approve ${p.name} right now. Reason: ${p.reason ?? ''}. If you have questions, contact ${CONTACT_EMAIL}.`,
    }
  }
  // DRAFT – not approved by Jordan; move to branded FairSynq template when built.
  if (template === VENDOR_OVERRIDE_TEMPLATE) {
    const p = payload as OverridePayload
    return {
      subject: `FairSynq ${p.decision} ${p.vendorName} at ${p.fairName}`,
      text: `FairSynq ${p.decision} ${p.vendorName}, a vendor at your event ${p.fairName}, instead of waiting for your decision. Reason: ${p.reason}\n\nSee the vendor: ${p.link}`,
    }
  }
  // DRAFT – not approved by Jordan; move to branded FairSynq template when built.
  if (template === MENU_ALERT_TEMPLATE.MENU_ITEMS_DELETED) {
    const p = payload as MenuAlertEmailPayload
    const n = p.lines.length
    return {
      subject: `${p.vendorName} removed ${n} menu item${n === 1 ? '' : 's'} at ${p.fairName}`,
      text: `${p.vendorName} removed ${n === 1 ? 'this item' : 'these items'} from their menu at ${p.fairName}:\n`
        + p.lines.map(l => `- ${l}`).join('\n')
        + `\n\nSee the vendor's menu requests: ${p.link}`,
    }
  }
  // DRAFT – not approved by Jordan; move to branded FairSynq template when built.
  if (template === MENU_ALERT_TEMPLATE.MENU_PRICE_CHANGE_PENDING) {
    const p = payload as MenuAlertEmailPayload
    const n = p.lines.length
    return {
      subject: `${n === 1 ? 'A price increase is' : `${n} price increases are`} waiting for your approval: ${p.vendorName}`,
      text: `${p.vendorName} at ${p.fairName} asked for ${n === 1 ? 'this price increase' : 'these price increases'}. Nothing changes on the menu until it is approved:\n`
        + p.lines.map(l => `- ${l}`).join('\n')
        + `\n\nApprove or reject: ${p.link}`,
    }
  }
  throw new Error(`Unknown email template: ${template}`)
}

// ── Subject line (independent review F17; Jordan, Nov 17) ─────────────────────────────────────
// Vendor, fair and applicant names go into subjects. A line break in a name could start a new
// email header, so every subject is made ONE line here, at the single exit of renderEmail, for
// every template now and later. The email body keeps its line breaks: they are not headers.
// The Resend transport ALSO refuses CR/LF and other control characters in the subject and in every
// address (audit progress note, "Before any email provider is connected"; lib/email/transport.ts).

/** At most this many characters in an email subject (whole characters, after flattening). */
export const EMAIL_SUBJECT_MAX = 200

/** Control characters (C0, DEL, C1 — CR, LF and tab among them) and the Unicode line/paragraph separators. */
const SUBJECT_LINE_BREAKS_AND_CONTROLS = /[\p{Cc}\p{Zl}\p{Zp}]/gu

/**
 * One safe subject line: line breaks and other control characters become spaces, repeated spaces
 * become one, the ends are trimmed. Over EMAIL_SUBJECT_MAX characters it keeps the first
 * EMAIL_SUBJECT_MAX − 1 and adds "…". Counted and cut by WHOLE characters (Array.from, code points),
 * so an emoji or other 2-unit character is never split in half.
 */
export function emailSubjectLine(subject: string): string {
  const flat = subject.replace(SUBJECT_LINE_BREAKS_AND_CONTROLS, ' ').replace(/ {2,}/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > EMAIL_SUBJECT_MAX ? `${chars.slice(0, EMAIL_SUBJECT_MAX - 1).join('')}…` : flat
}

/** Renders a template. The subject always leaves as one safe line (emailSubjectLine). */
export function renderEmail(template: string, payload: unknown): { subject: string; text: string } {
  const { subject, text } = renderEmailParts(template, payload)
  return { subject: emailSubjectLine(subject), text }
}

// ── Enqueue (inside the caller's transaction) ───────────────────────────────────────────────
export async function enqueueSignupAlert(tx: Tx, applicationId: string, payload: SignupAlertPayload) {
  await tx.notification.createMany({
    data: [{ audience: 'admin', template: 'signup_admin_alert', payload: payload as unknown as Prisma.InputJsonValue, dedupeKey: `signup:${payload.kind}:${applicationId}` }],
    skipDuplicates: true,
  })
}

/** `decisionId`: set for a LATER decision on the same application (a rejected booth re-approved, a
 *  live booth rejected), so its email isn't swallowed by the first decision's dedupe key. */
export async function enqueueDecisionEmail(tx: Tx, applicationId: string, decision: 'approved' | 'rejected', to: string | null, payload: DecisionPayload, decisionId?: string) {
  if (!to) return // no address on file: nothing to send to (the decision itself still stands)
  await tx.notification.createMany({
    data: [{
      audience: 'applicant', to, template: decision === 'approved' ? 'decision_approved' : 'decision_rejected',
      payload: payload as unknown as Prisma.InputJsonValue,
      dedupeKey: `decision:${payload.kind}:${applicationId}:${decision}${decisionId ? `:${decisionId}` : ''}`,
    }],
    skipDuplicates: true,
  })
}

/** Tells the event's organizer that FairSynq decided one of their vendors (strict-admin override).
 *  Same transaction as the decision; one email per decision (keyed by its ApprovalAction id). */
export async function enqueueOverrideNotice(tx: Tx, vendorId: string, decisionId: string, to: string | null, payload: OverridePayload) {
  if (!to) return // no organizer address on file: the decision and its audit row still stand
  await tx.notification.createMany({
    data: [{
      audience: 'user', to, template: VENDOR_OVERRIDE_TEMPLATE,
      payload: payload as unknown as Prisma.InputJsonValue, dedupeKey: `vendor-override:${vendorId}:${decisionId}`,
    }],
    skipDuplicates: true,
  })
}

// ── Deliver (worker) ────────────────────────────────────────────────────────────────────────
export interface DeliverDeps {
  now?: Date
  transport?: EmailTransport
  /** alerts.email resolver; defaults to the setting. */
  alertEmails?: () => Promise<string[]>
  limit?: number
  /** EMAIL_SAFE_RECIPIENT_DOMAIN; defaults to the env var. null = no limit. */
  safeDomain?: string | null
  /** Where held and settings lines go. Default console.warn / console.error (console.log is stripped in production). */
  log?: (level: 'warn' | 'error', line: string) => void
}
export interface DeliverResult { sent: number; retried: number; failed: number; held: number; skipped: number; expired: number; rateLimited: number }

function defaultLog(level: 'warn' | 'error', line: string) {
  if (level === 'error') console.error(line)
  else console.warn(line)
}

async function defaultAlertEmails(): Promise<string[]> {
  return ((await getSetting('alerts.email')) as string[] | null) ?? []
}

export async function deliverDueNotifications(deps: DeliverDeps = {}): Promise<DeliverResult> {
  const now = deps.now ?? new Date()
  const transport = deps.transport ?? getEmailTransport()
  const alertEmails = deps.alertEmails ?? defaultAlertEmails
  const safeDomain = deps.safeDomain !== undefined ? deps.safeDomain : safeRecipientDomain()
  const log = deps.log ?? defaultLog
  const res: DeliverResult = { sent: 0, retried: 0, failed: 0, held: 0, skipped: 0, expired: 0, rateLimited: 0 }

  // A worker that died mid-send leaves SENDING rows; give them back after 10 minutes.
  await db.notification.updateMany({
    where: { status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - SENDING_RECLAIM_MS) } },
    data: { status: 'PENDING' },
  })

  if (!transport.canSend) {
    // No provider: hold everything that's waiting. Silent on purpose (no production log lines).
    const held = await db.notification.updateMany({
      // OR with null on purpose: NOT (heldReason = X) is NULL, not true, for a NULL heldReason in SQL,
      // so a plain NOT would skip every fresh row (caught by scripts/notifications-test.ts [6]).
      where: { status: 'PENDING', OR: [{ heldReason: null }, { heldReason: { not: 'NO_EMAIL_PROVIDER' } }] },
      data: { heldReason: 'NO_EMAIL_PROVIDER' },
    })
    res.held = held.count
    return res
  }

  // A provider is connected: admin alerts held for no-provider and older than 48h are stale.
  const skipped = await db.notification.updateMany({
    where: { status: 'PENDING', audience: 'admin', heldReason: 'NO_EMAIL_PROVIDER', createdAt: { lt: new Date(now.getTime() - STALE_ADMIN_ALERT_MS) } },
    data: { status: 'SKIPPED', lastError: 'Older than 48 hours when email was connected' },
  })
  res.skipped = skipped.count
  // Menu alerts held for no provider and older than 48 hours are out of date: EXPIRED, kept, never
  // sent (Jordan, Nov 15). Must run before the release below, or they would go out.
  const expired = await db.notification.updateMany({
    where: {
      status: 'PENDING', heldReason: 'NO_EMAIL_PROVIDER', template: { in: [...MENU_ALERT_TEMPLATES] },
      createdAt: { lt: new Date(now.getTime() - MENU_ALERT_EMAIL_EXPIRY_MS) },
    },
    data: { status: 'EXPIRED', lastError: 'Expired: older than 48 hours when email was connected' },
  })
  res.expired = expired.count
  await db.notification.updateMany({ where: { status: 'PENDING', heldReason: 'NO_EMAIL_PROVIDER' }, data: { heldReason: null } })

  const due = await db.notification.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { createdAt: 'asc' },
    take: deps.limit ?? 25,
  })

  let admins: string[] | null = null
  for (const n of due) {
    const claim = await db.notification.updateMany({ where: { id: n.id, status: 'PENDING' }, data: { status: 'SENDING' } })
    if (claim.count === 0) continue // another worker has it

    let to: string[]
    if (n.audience === 'admin') {
      admins ??= await alertEmails()
      if (admins.length === 0) {
        await db.notification.update({ where: { id: n.id }, data: { status: 'PENDING', heldReason: 'NO_ALERT_EMAIL', nextAttemptAt: new Date(now.getTime() + NO_ALERT_EMAIL_RECHECK_MS) } })
        res.held++
        continue
      }
      to = admins
    } else {
      to = n.to ? [n.to] : []
    }

    // Safety switch: any address outside the test domain → this email waits, untouched otherwise.
    if (outsideSafeDomain(to, safeDomain)) {
      await db.notification.update({ where: { id: n.id }, data: { status: 'PENDING', heldReason: 'SAFE_RECIPIENT_DOMAIN', nextAttemptAt: new Date(now.getTime() + SAFE_DOMAIN_RECHECK_MS) } })
      log('warn', `[email] held: outside safe domain template=${n.template}`)
      res.held++
      continue
    }

    try {
      const { subject, text } = renderEmail(n.template, n.payload)
      // One key per outbox row, the same on every retry: Resend never sends the row twice.
      const email: OutgoingEmail = { to, subject, text, idempotencyKey: `notification-${n.id}` }
      await transport.send(email)
      await db.notification.update({ where: { id: n.id }, data: { status: 'SENT', sentAt: now, heldReason: null, lastError: null } })
      res.sent++
    } catch (err) {
      // 429 or our own settings wrong: wait, attempts not counted, and stop this run — every other
      // row would get the same answer.
      if (err instanceof EmailSendError && (err.failure === 'rate_limited' || err.failure === 'config')) {
        const wait = err.failure === 'config'
          ? SETTINGS_HOLD_MS
          : Math.min(RATE_LIMIT_WAIT_MAX_MS, Math.max(RATE_LIMIT_WAIT_MIN_MS, err.retryAfterMs ?? RATE_LIMIT_WAIT_MS))
        await db.notification.update({ where: { id: n.id }, data: { status: 'PENDING', lastError: err.message.slice(0, 500), nextAttemptAt: new Date(now.getTime() + wait) } })
        if (err.failure === 'config') {
          log('error', `[email] ${err.message}: check the Resend settings on the worker; emails stay waiting`)
          res.held++
        } else {
          log('warn', `[email] ${err.message}: waiting ${Math.round(wait / 60e3)} min`)
          res.rateLimited++
        }
        break
      }
      const attempts = n.attempts + 1
      const lastError = (err instanceof Error ? err.message : String(err)).slice(0, 500)
      if (err instanceof EmailSendError && err.failure === 'permanent') {
        await db.notification.update({ where: { id: n.id }, data: { status: 'FAILED', attempts, lastError } })
        res.failed++
      } else if (attempts >= MAX_ATTEMPTS) {
        await db.notification.update({ where: { id: n.id }, data: { status: 'FAILED', attempts, lastError } })
        res.failed++
      } else {
        const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] * 60e3
        await db.notification.update({ where: { id: n.id }, data: { status: 'PENDING', attempts, lastError, nextAttemptAt: new Date(now.getTime() + wait) } })
        res.retried++
      }
    }
  }
  return res
}

// ── What the approvals page shows ───────────────────────────────────────────────────────────
export interface OutboxStatus {
  connected: boolean
  waitingAdmin: number
  waitingApplicant: number
  heldNoAlertEmail: number
  heldSafeDomain: number
  failed: number
}

/**
 * The approvals page line. With no transport given (the web app), "connected" comes from the mode
 * alone: Vercel has EMAIL_TRANSPORT but not the Resend key, which only the worker needs.
 */
export async function outboxStatus(transport?: EmailTransport): Promise<OutboxStatus> {
  const [waitingAdmin, waitingApplicant, heldNoAlertEmail, heldSafeDomain, failed] = await Promise.all([
    db.notification.count({ where: { status: 'PENDING', audience: 'admin' } }),
    db.notification.count({ where: { status: 'PENDING', audience: 'applicant' } }),
    db.notification.count({ where: { status: 'PENDING', heldReason: 'NO_ALERT_EMAIL' } }),
    db.notification.count({ where: { status: 'PENDING', heldReason: 'SAFE_RECIPIENT_DOMAIN' } }),
    db.notification.count({ where: { status: 'FAILED' } }),
  ])
  const connected = transport ? transport.canSend : resolveEmailTransport() !== 'none'
  return { connected, waitingAdmin, waitingApplicant, heldNoAlertEmail, heldSafeDomain, failed }
}
