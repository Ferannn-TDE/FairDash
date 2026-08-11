/**
 * CONTACT FACTS — one source for what FairSynq tells people about reaching us.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * These strings were hand-written per surface, and they drifted into three
 * DIFFERENT published promises about the same thing:
 *
 *   app/contact/page.tsx        "We typically respond within 24 hours"
 *   app/refund-policy/page.tsx  "We aim to respond within one business day"
 *   SupportModal                "Our team typically responds within a few hours"
 *
 * All three were live at once. The worst of them ("a few hours") is shown to a
 * customer whose ACTIVE ORDER has gone wrong — the single place over-promising
 * costs the most. Same class as the FAQ/cancel-copy drift: two copies, one lies.
 *
 * A contact detail is a PROMISE. Publishing one the system can't keep is the bug
 * this module exists to make unexpressible — so the response time, the address we
 * hand out, and the social channel each have exactly one definition.
 *
 * ── WHAT IS DELIBERATELY *NOT* HERE ──────────────────────────────────────────
 * There is NO phone number and NO postal address, because FairSynq has neither.
 * Do not add one to "fill out" a contact card. A support line that rings nowhere
 * and an office that doesn't exist are the same false promise as the fake contact
 * form this replaced — a card with three real facts beats a card with five where
 * two are fiction.
 *
 * ── SCOPE NOTE: `support@` IS NOT ROUTED THROUGH HERE (yet) ──────────────────
 * The in-app support surfaces (OrganizerGateScreen, VendorOperatorGateScreen,
 * vendor/page, SupportModal) send to `support@fairsynq.com`, a DIFFERENT mailbox
 * from the customer/marketing `contact@` below. That split looks deliberate —
 * operator support tickets routed apart from general inquiries — so it has NOT
 * been collapsed. Consolidate only after confirming `support@` is not separately
 * monitored; rewriting it blind would reroute real support mail.
 */

/** The customer/marketing inbox. NOT the in-app operator `support@` (see above). */
export const CONTACT_EMAIL = 'contact@fairsynq.com'

/** The public Facebook page — a real, already-published support channel. */
export const FACEBOOK_URL = 'https://facebook.com/fairsynq'

/**
 * The ONE response-time promise. Kept as the least aggressive of the three that
 * were live, so consolidating could not newly over-promise on any surface.
 */
export const RESPONSE_TIME = 'within 24 hours'

/** Sentence-ready variant for body copy that needs the business-days qualifier. */
export const RESPONSE_TIME_LONG = 'within 24 hours on business days'

/**
 * Build a `mailto:` to the contact inbox.
 *
 * This is the honest replacement for a contact FORM. The form that lived here
 * ran a setTimeout, cleared its fields and toasted "Message sent! We'll get back
 * to you soon" — while performing no network call at all: there is no
 * /api/contact route, no message table, and no email provider installed. It told
 * people their support request had been delivered and then dropped it.
 *
 * A mailto hands the message to a client that will actually deliver it, to an
 * address that actually receives. Less clever, and true.
 */
export function contactMailto(subject?: string, body?: string): string {
  const params = new URLSearchParams()
  if (subject) params.set('subject', subject)
  if (body) params.set('body', body)
  const qs = params.toString()
  return `mailto:${CONTACT_EMAIL}${qs ? `?${qs}` : ''}`
}

/** Default subject so an inbound mail is identifiable at a glance. */
export const SUPPORT_SUBJECT = 'FairSynq support request'
