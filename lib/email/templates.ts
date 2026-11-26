// EMAIL TEMPLATES — every email the app sends is written here (email-look-v1, Nov 25). Moved out
// of lib/notifications.ts so the templates load with NO database (scripts/email-layout-test.ts,
// scripts/email-preview.ts). lib/notifications.ts re-exports renderEmail and the payload types;
// the outbox and the worker call it from there.
//
// Each template gives the words: a subject, the plain text, and the plain-text pieces of the HTML
// (heading, preheader, paragraphs, button). The HTML itself is made ONLY by the shared layout,
// lib/email/layout.ts, which escapes every value. No template writes HTML.
//
// Wording approved by Jordan, Nov 25: headings, preheaders and buttons (plan table + B), and
// C1 one full stop after a reason / no "Reason:" without one, C2 no support sentence in the
// declined HTML (the footer has it), C3 approved subjects, C4 E4–E6 words approved, C5 override
// subject, C6 "(no name given)", C7 "an organizer".

import { SITE_URL } from '@/lib/seo'
import { CONTACT_EMAIL } from '@/lib/contact-info'
import { MENU_ALERT_TEMPLATE } from '@/lib/menu-notify/constants'
import type { MenuAlertEmailPayload } from '@/lib/menu-notify/digest'
import { emailTextWithFooter, renderEmailLayout, type EmailLayoutInput } from '@/lib/email/layout'

export type ApplicationKind = 'vendor' | 'organizer' | 'partner'
const KIND_LABEL: Record<ApplicationKind, string> = { vendor: 'vendor', organizer: 'organizer', partner: 'partner organization' }
/** C7: "a vendor", "an organizer", "a partner organization". */
const KIND_ARTICLE: Record<ApplicationKind, string> = { vendor: 'a', organizer: 'an', partner: 'a' }

// ── Payloads ────────────────────────────────────────────────────────────────────────────────
export interface SignupAlertPayload { kind: ApplicationKind; name: string; contactName: string | null; email: string | null; phone: string | null }
/** `decidedBy` (vendor decisions): who decided, as the VENDOR may see it — "FairSynq" or the
 *  organizer's organization name, never a person (lib/reviewer-label.ts; Jordan, Nov 16). Absent on
 *  rows queued before Nov 16, which read as FairSynq. */
export interface DecisionPayload { kind: ApplicationKind; name: string; contactName: string | null; reason?: string; decidedBy?: string }
/** The organizer's notice that FairSynq decided a vendor on their event (strict-admin override). */
export interface OverridePayload { vendorName: string; fairName: string; decision: 'approved' | 'rejected'; reason: string; link: string }
export const VENDOR_OVERRIDE_TEMPLATE = 'vendor_override_organizer'
const byFairSynq = (p: DecisionPayload) => !p.decidedBy || p.decidedBy === 'FairSynq'

/** Every template name renderEmail knows. scripts/email-layout-test.ts needs a sample for each. */
export const EMAIL_TEMPLATES: readonly string[] = [
  'signup_admin_alert',
  'decision_approved',
  'decision_rejected',
  VENDOR_OVERRIDE_TEMPLATE,
  MENU_ALERT_TEMPLATE.MENU_ITEMS_DELETED,
  MENU_ALERT_TEMPLATE.MENU_PRICE_CHANGE_PENDING,
]

/** What the worker knows about the outbox row besides its payload. */
export interface EmailContext { createdAt?: Date }

export interface RenderedEmail { subject: string; text: string; html: string }

// ── Small wording helpers ───────────────────────────────────────────────────────────────────
/** Admin alerts show "Submitted" in FairSynq's own time (Jordan, Nov 25): Central. */
export const ADMIN_ALERT_TIME_ZONE = 'America/Chicago'
const SUBMITTED_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: ADMIN_ALERT_TIME_ZONE, month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
})
/** "Nov 25, 2026, 12:20 PM CST". Newer ICU puts a narrow no-break space before "PM": made a plain space. */
export function formatSubmitted(at: Date): string {
  return SUBMITTED_FORMAT.format(at).replace(/\p{Zs}/gu, ' ')
}

/** C6: an organizer who gave no name is stored under their email address; say so instead. */
function applicantName(p: SignupAlertPayload): string {
  const sameAsEmail = !!p.email && p.name.trim().toLowerCase() === p.email.trim().toLowerCase()
  return p.kind === 'organizer' && sameAsEmail ? '(no name given)' : p.name
}

/** C1: " Reason: X." — no second full stop when X already ends in . ! or ?, nothing when X is empty. */
function reasonSentence(reason: string | undefined): string {
  const r = (reason ?? '').trim()
  if (!r) return ''
  return ` Reason: ${r}${/[.!?]$/.test(r) ? '' : '.'}`
}

// ── Templates ───────────────────────────────────────────────────────────────────────────────
type Parts = { subject: string; text: string; layout: Omit<EmailLayoutInput, 'title'> }

/** The templates themselves. Private: every caller goes through renderEmail, the one exit. */
function renderEmailParts(template: string, payload: unknown, context: EmailContext): Parts {
  if (template === 'signup_admin_alert') {
    const p = payload as SignupAlertPayload
    const label = KIND_LABEL[p.kind]
    const name = applicantName(p)
    const contact = [p.contactName, p.email, p.phone].filter(Boolean).join(', ')
    const reviewUrl = `${SITE_URL}/admin/approvals`
    const applied = `${name} applied to join FairSynq as ${KIND_ARTICLE[p.kind]} ${label}.`
    return {
      subject: `New ${label} application: ${name}`,
      text: `${applied}${contact ? ` Contact: ${contact}.` : ''} Review it at ${reviewUrl}`,
      layout: {
        variant: 'admin', heading: `New ${label} application`, preheader: `${name} applied to join FairSynq.`,
        paragraphs: [applied],
        details: [
          ['Business', name], ['Contact', p.contactName], ['Email', p.email], ['Phone', p.phone],
          ['Submitted', context.createdAt ? formatSubmitted(context.createdAt) : null],
        ],
        button: { label: 'Review application', url: reviewUrl },
      },
    }
  }
  if (template === 'decision_approved') {
    const p = payload as DecisionPayload
    const hi = `Hi ${p.contactName || p.name}`
    if (p.kind === 'vendor') {
      const url = `${SITE_URL}/sign-in/vendor`
      const lead = `${hi}, ${p.name} is approved${byFairSynq(p) ? '' : ` by ${p.decidedBy}`}. Sign in to finish your setup (payouts and menu)`
      return {
        subject: `${p.name} is approved on FairSynq`,
        text: `${lead}: ${url}`,
        layout: { variant: 'standard', heading: "You're approved", preheader: 'Finish your payouts and menu.', paragraphs: [`${lead}.`], button: { label: 'Finish your setup', url } },
      }
    }
    if (p.kind === 'organizer') {
      const url = `${SITE_URL}/organizer/login`
      const lead = `${hi}, your organizer account is approved. Sign in to create your first fair`
      return {
        subject: 'Your FairSynq organizer account is approved',
        text: `${lead}: ${url}`,
        layout: { variant: 'standard', heading: "You're approved", preheader: 'Your organizer account is ready.', paragraphs: [`${lead}.`], button: { label: 'Create your first fair', url } },
      }
    }
    const sentence = `${hi}, ${p.name} is approved as a FairSynq partner organization. We'll be in touch about upcoming events.`
    return {
      subject: `${p.name} is approved on FairSynq`,
      text: sentence,
      layout: { variant: 'standard', heading: "You're approved", preheader: 'Welcome to FairSynq.', paragraphs: [sentence] },
    }
  }
  if (template === 'decision_rejected') {
    const p = payload as DecisionPayload
    const decision = `Hi ${p.contactName || p.name}, ${byFairSynq(p) ? "we're" : `${p.decidedBy} is`} not able to approve ${p.name} right now.${reasonSentence(p.reason)}`
    return {
      subject: 'Your FairSynq application',
      text: `${decision} If you have questions, contact ${CONTACT_EMAIL}.`,
      layout: {
        variant: 'decline', heading: 'About your FairSynq application', preheader: 'An update on your application.',
        paragraphs: [decision], button: { label: 'Email support', url: `mailto:${CONTACT_EMAIL}` },
      },
    }
  }
  if (template === VENDOR_OVERRIDE_TEMPLATE) {
    const p = payload as OverridePayload
    const sentence = `FairSynq ${p.decision} ${p.vendorName}, a vendor at your event ${p.fairName}, instead of waiting for your decision. Reason: ${p.reason}`
    return {
      subject: `FairSynq made a decision on ${p.vendorName} at ${p.fairName}`,
      text: `${sentence}\n\nSee the vendor: ${p.link}`,
      layout: {
        variant: 'standard', heading: 'FairSynq made a decision on a vendor', preheader: `${p.vendorName} at ${p.fairName}.`,
        paragraphs: [sentence], button: { label: 'See the vendor', url: p.link },
      },
    }
  }
  if (template === MENU_ALERT_TEMPLATE.MENU_ITEMS_DELETED) {
    const p = payload as MenuAlertEmailPayload
    const n = p.lines.length
    const intro = `${p.vendorName} removed ${n === 1 ? 'this item' : 'these items'} from their menu at ${p.fairName}:`
    return {
      subject: `${p.vendorName} removed ${n} menu item${n === 1 ? '' : 's'} at ${p.fairName}`,
      text: `${intro}\n` + p.lines.map(l => `- ${l}`).join('\n') + `\n\nSee the vendor's menu requests: ${p.link}`,
      layout: {
        variant: 'standard', heading: 'Menu items removed', preheader: `${p.vendorName} changed their menu at ${p.fairName}.`,
        paragraphs: [intro], lines: p.lines, button: { label: 'See menu requests', url: p.link },
      },
    }
  }
  if (template === MENU_ALERT_TEMPLATE.MENU_PRICE_CHANGE_PENDING) {
    const p = payload as MenuAlertEmailPayload
    const n = p.lines.length
    const intro = `${p.vendorName} at ${p.fairName} asked for ${n === 1 ? 'this price increase' : 'these price increases'}. Nothing changes on the menu until it is approved:`
    return {
      subject: `${n === 1 ? 'A price increase is' : `${n} price increases are`} waiting for your approval: ${p.vendorName}`,
      text: `${intro}\n` + p.lines.map(l => `- ${l}`).join('\n') + `\n\nApprove or reject: ${p.link}`,
      layout: {
        variant: 'standard', heading: 'Price increase waiting', preheader: 'Nothing changes until it is approved.',
        paragraphs: [intro], lines: p.lines, button: { label: 'Approve or reject', url: p.link },
      },
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

/**
 * Renders a template: the one exit. The subject always leaves as one safe line (emailSubjectLine),
 * the plain text gets the footer, and the HTML comes only from the shared layout.
 */
export function renderEmail(template: string, payload: unknown, context: EmailContext = {}): RenderedEmail {
  const { subject, text, layout } = renderEmailParts(template, payload, context)
  const line = emailSubjectLine(subject)
  return { subject: line, text: emailTextWithFooter(text, layout.variant), html: renderEmailLayout({ ...layout, title: line }) }
}
