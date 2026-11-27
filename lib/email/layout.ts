// FAIRSYNQ EMAIL LOOK v1 (email-look-v1, Jordan, Nov 25) — the ONE HTML layout every email uses.
//
// Built for Outlook desktop: tables and inline styles, 600px wide, centered, no images anywhere
// (the header "FairSynq" is text). One small <style> block adds only two things inline styles
// cannot: a full-width button on phones and readable dark-mode colors (Jordan's choice, Nov 25).
// Outlook desktop ignores that block and shows the inline light look.
//
// EVERY value that reaches the HTML is escaped here (escapeHtml): business names, reasons, item
// names, links. Templates pass plain text in; they never write HTML themselves.
// The plain-text part of each email is built by the template (lib/email/templates.ts); this file
// only adds the footer lines to it (emailTextWithFooter), so both parts end the same way.
//
// No database, no network, no environment variables: tests and the preview script call it directly.

import { CONTACT_EMAIL } from '@/lib/contact-info'

export type EmailVariant = 'standard' | 'decline' | 'admin'

export interface EmailButton { label: string; url: string }

export interface EmailLayoutInput {
  variant: EmailVariant
  /** The <title> of the page (the subject). */
  title: string
  /** The hidden line inboxes show after the subject. */
  preheader: string
  heading: string
  paragraphs: string[]
  /** A bulleted list after the paragraphs (menu items, price changes). */
  lines?: string[]
  /** Pink button (black outline when variant is 'decline'), then "Copy this link". */
  button?: EmailButton
  /** Admin alerts: the two-column details table. Empty or null values show as "—". */
  details?: [string, string | null | undefined][]
}

/** Written once into every email this layout makes; tests count it to prove one layout per email. */
export const EMAIL_LAYOUT_MARKER = 'fairsynq-email-look-v1'

// ── Colors and type (the approved design) ───────────────────────────────────────────────────
const PINK = '#FF0077'
const BLACK = '#0A0A0A'
const PAGE_BG = '#F2F2F4'
const CARD_BG = '#FFFFFF'
const HEADING = '#111111'
const TEXT = '#333333'
const MUTED = '#6B6B73'
const RULE = '#E4E4E8'
const FONT = 'Arial, Helvetica, sans-serif'

export const FOOTER_QUESTIONS = `Questions? Just reply to this email, or write to ${CONTACT_EMAIL}.`
export const FOOTER_TAGLINE = 'FairSynq · Order ahead and skip the line at fairs and festivals.'
export const FOOTER_ADMIN = 'FairSynq admin alert · sent to the alerts address in Platform settings.'
export const BUTTON_FALLBACK = 'Button not working? Copy this link:'
/** Under a mailto: button the "link" is an email address, so it says so (sign-up-fixes commit 3). */
export const BUTTON_FALLBACK_EMAIL = 'Button not working? Email us at:'

/** The footer lines for a variant. Admin alerts get only the admin line. */
export function footerLines(variant: EmailVariant): string[] {
  return variant === 'admin' ? [FOOTER_ADMIN] : [FOOTER_QUESTIONS, FOOTER_TAGLINE]
}

/** The template's plain text, a blank line, then the same footer the HTML shows. */
export function emailTextWithFooter(text: string, variant: EmailVariant): string {
  return `${text}\n\n${footerLines(variant).join('\n')}`
}

// ── Escaping ────────────────────────────────────────────────────────────────────────────────
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Text made safe for HTML text and for a quoted attribute: & < > " ' become entities. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch])
}

/** Escaped text with its line breaks kept as <br>. */
function escapeLines(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>')
}

/**
 * Only these links become a button: https, mailto, and http on localhost (local previews). Anything
 * else (javascript:, data:, a relative path) gets no button and no link; the plain text still has it.
 */
export function isSafeEmailLink(url: string): boolean {
  return /^https:\/\/[^\s<>"']+$/i.test(url)
    || /^mailto:[^\s<>"']+$/i.test(url)
    || /^http:\/\/localhost(:\d+)?(\/[^\s<>"']*)?$/i.test(url)
}

// ── Pieces ──────────────────────────────────────────────────────────────────────────────────
const PREHEADER_FILLER = '&#847;&zwnj;&nbsp;'.repeat(40)

function preheaderHtml(text: string): string {
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${PAGE_BG};">${escapeHtml(text)}${PREHEADER_FILLER}</div>`
}

function headerHtml(variant: EmailVariant): string {
  const tag = variant === 'admin'
    ? `<td align="right" valign="middle" style="padding:0 32px 0 0;" class="fs-pad-r"><span style="display:inline-block;padding:3px 8px;border:1px solid ${PINK};border-radius:4px;font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:1px;color:#FFFFFF;">ADMIN</span></td>`
    : ''
  return `<tr><td bgcolor="${BLACK}" style="background-color:${BLACK};padding:0;">`
    + `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>`
    + `<td valign="middle" style="padding:20px 32px;font-family:${FONT};font-size:24px;line-height:28px;font-weight:bold;" class="fs-pad">`
    + `<span style="color:#FFFFFF;">Fair</span><span style="color:${PINK};">Synq</span></td>`
    + tag
    + `</tr></table></td></tr>`
    + `<tr><td height="4" bgcolor="${PINK}" style="background-color:${PINK};height:4px;line-height:4px;font-size:4px;">&nbsp;</td></tr>`
}

function paragraphHtml(text: string): string {
  return `<p class="fs-text" style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:1.55;color:${TEXT};">${escapeLines(text)}</p>`
}

function linesHtml(lines: string[]): string {
  const rows = lines.map(l =>
    `<tr><td valign="top" class="fs-text" style="padding:0 8px 8px 0;font-family:${FONT};font-size:16px;line-height:1.55;color:${TEXT};">&bull;</td>`
    + `<td valign="top" class="fs-text" style="padding:0 0 8px 0;font-family:${FONT};font-size:16px;line-height:1.55;color:${TEXT};">${escapeLines(l)}</td></tr>`).join('')
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;">${rows}</table>`
}

function detailsHtml(details: [string, string | null | undefined][]): string {
  const rows = details.map(([label, value]) => {
    const v = value && value.trim() ? escapeLines(value) : '&mdash;'
    return `<tr>`
      + `<td valign="top" width="35%" class="fs-muted fs-rule" style="padding:10px 12px 10px 0;border-bottom:1px solid ${RULE};font-family:${FONT};font-size:14px;line-height:1.4;font-weight:bold;color:${MUTED};">${escapeHtml(label)}</td>`
      + `<td valign="top" class="fs-text fs-rule" style="padding:10px 0;border-bottom:1px solid ${RULE};font-family:${FONT};font-size:16px;line-height:1.4;color:${TEXT};word-break:break-word;">${v}</td>`
      + `</tr>`
  }).join('')
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" class="fs-details" style="margin:0 0 24px 0;border-top:1px solid ${RULE};">${rows}</table>`
}

/** A "bulletproof" button: a table cell with a link, no image. Outlook shows square corners. */
function buttonHtml(button: EmailButton, decline: boolean): string {
  const url = escapeHtml(button.url)
  const label = escapeHtml(button.label)
  const bg = decline ? CARD_BG : PINK
  const fg = decline ? BLACK : '#FFFFFF'
  const border = decline ? `2px solid ${BLACK}` : `2px solid ${PINK}`
  const cls = decline ? 'fs-btn-cell fs-btn-outline' : 'fs-btn-cell'
  const isMailto = button.url.toLowerCase().startsWith('mailto:')
  const shown = isMailto ? button.url.slice('mailto:'.length) : button.url
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" class="fs-btn-table" style="border-collapse:separate;margin:8px 0 16px 0;"><tr>`
    + `<td align="center" bgcolor="${bg}" class="${cls}" style="border-radius:8px;background-color:${bg};border:${border};mso-padding-alt:14px 28px;">`
    + `<a href="${url}" target="_blank" class="fs-btn-link" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:19px;line-height:24px;font-weight:bold;color:${fg};text-decoration:none;border-radius:8px;">${label}</a>`
    + `</td></tr></table>`
    + `<p class="fs-muted" style="margin:0 0 4px 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${MUTED};">${escapeHtml(isMailto ? BUTTON_FALLBACK_EMAIL : BUTTON_FALLBACK)}</p>`
    + `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:14px;line-height:1.5;word-break:break-all;"><a href="${url}" target="_blank" class="fs-text" style="color:${TEXT};text-decoration:underline;">${escapeHtml(shown)}</a></p>`
}

function footerHtml(variant: EmailVariant): string {
  const lines = footerLines(variant).map(l =>
    `<p class="fs-muted" style="margin:0 0 6px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};">${escapeHtml(l)}</p>`).join('')
  return `<tr><td class="fs-pad" style="padding:20px 32px 32px 32px;">${lines}</td></tr>`
}

// The one <style> block: phones, then dark mode (Apple Mail, iOS Mail, Outlook.com via [data-ogsc]).
const STYLE_BLOCK = `<style type="text/css">
@media only screen and (max-width:620px){
  .fs-container{width:100% !important;}
  .fs-pad{padding-left:16px !important;padding-right:16px !important;}
  .fs-pad-r{padding-right:16px !important;}
  .fs-btn-table{width:100% !important;}
  .fs-btn-link{display:block !important;}
}
@media (prefers-color-scheme: dark){
  .fs-page{background-color:#1A1A1E !important;}
  .fs-card{background-color:#26262B !important;}
  .fs-heading{color:#F4F4F6 !important;}
  .fs-text{color:#E2E2E6 !important;}
  .fs-muted{color:#B4B4BC !important;}
  .fs-rule{border-color:#3C3C44 !important;}
  .fs-btn-outline{background-color:#26262B !important;border-color:#F4F4F6 !important;}
  .fs-btn-outline a{color:#F4F4F6 !important;}
}
[data-ogsc] .fs-heading{color:#F4F4F6 !important;}
[data-ogsc] .fs-text{color:#E2E2E6 !important;}
[data-ogsc] .fs-muted{color:#B4B4BC !important;}
[data-ogsc] .fs-btn-outline a{color:#F4F4F6 !important;}
</style>`

// ── The layout ──────────────────────────────────────────────────────────────────────────────
/** The whole HTML email. Every value in `input` is plain text; it is escaped here. */
export function renderEmailLayout(input: EmailLayoutInput): string {
  const decline = input.variant === 'decline'
  const body = [
    `<h1 class="fs-heading" style="margin:0 0 16px 0;font-family:${FONT};font-size:24px;line-height:1.3;font-weight:bold;color:${HEADING};">${escapeHtml(input.heading)}</h1>`,
    ...input.paragraphs.map(paragraphHtml),
    input.lines?.length ? linesHtml(input.lines) : '',
    input.details?.length ? detailsHtml(input.details) : '',
    input.button && isSafeEmailLink(input.button.url) ? buttonHtml(input.button, decline) : '',
  ].join('')

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en" dir="ltr">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.title)}</title>
${STYLE_BLOCK}
</head>
<body class="fs-page" style="margin:0;padding:0;background-color:${PAGE_BG};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<!-- ${EMAIL_LAYOUT_MARKER} -->
${preheaderHtml(input.preheader)}
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${PAGE_BG}" class="fs-page" style="background-color:${PAGE_BG};">
<tr><td align="center" style="padding:24px 0;">
<table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" class="fs-container" style="width:600px;max-width:600px;">
${headerHtml(input.variant)}
<tr><td bgcolor="${CARD_BG}" class="fs-card fs-pad" style="background-color:${CARD_BG};padding:32px 32px 16px 32px;">${body}</td></tr>
${footerHtml(input.variant)}
</table>
</td></tr>
</table>
</body>
</html>
`
}
