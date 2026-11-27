/**
 * SAMPLE EMAILS (email-look-v1) — one entry per email variant the app can send, with made-up
 * data. Shared by scripts/email-layout-test.ts (snapshots and checks) and scripts/email-preview.ts
 * (the .html files Jordan opens on his PC and phone). No database, no network, no real people.
 *
 * `expect` is what each email must say: the plain text word for word (before the footer), and the
 * approved HTML heading, preheader and button (plan, table + Jordan's changes B and C, Nov 25).
 */

export const HOSTILE = `Tom & Jerry's <script>alert(1)</script> "Tacos"`

const SITE = 'https://www.fairsynq.com'
const SUPPORT = 'support@fairsynq.com'
/** A fixed "submitted" time so snapshots never change: Nov 25 2026, 18:20 UTC. */
export const SAMPLE_CREATED_AT = new Date('2026-11-25T18:20:00Z')

export interface EmailSample {
  id: string
  template: string
  payload: Record<string, unknown>
  variant: 'standard' | 'decline' | 'admin'
  expect: {
    subject: string
    /** The plain text before the footer, word for word. */
    text: string
    heading: string
    preheader: string
    button: { label: string; url: string } | null
  }
}

const OVERRIDE_LINK = `${SITE}/organizer/fairs/italian-fest/vendors/taco-stand`
const MENU_LINK = `${SITE}/organizer/fairs/italian-fest/menu-requests`
const ADMIN_MENU_LINK = `${SITE}/admin/italian-fest/vendors`

const admin = (id: string, kind: 'vendor' | 'organizer' | 'partner', label: string, p: { name: string; contactName: string | null; email: string | null; phone: string | null }, shownName: string, contact: string): EmailSample => ({
  id, template: 'signup_admin_alert', variant: 'admin',
  payload: { kind, ...p },
  expect: {
    subject: `New ${label} application: ${shownName}`,
    // C7: "an organizer"; "a vendor", "a partner organization" unchanged.
    text: `${shownName} applied to join FairSynq as ${kind === 'organizer' ? 'an' : 'a'} ${label}.${contact ? ` Contact: ${contact}.` : ''} Review it at ${SITE}/admin/approvals`,
    heading: `New ${label} application`,
    preheader: `${shownName} applied to join FairSynq.`,
    button: { label: 'Review application', url: `${SITE}/admin/approvals` },
  },
})

const declined = (id: string, payload: Record<string, unknown>, text: string): EmailSample => ({
  id, template: 'decision_rejected', variant: 'decline', payload,
  expect: {
    subject: 'Your FairSynq application', text,
    heading: 'About your FairSynq application',
    preheader: 'An update on your application.',
    button: { label: 'Email support', url: `mailto:${SUPPORT}` },
  },
})

const received = (id: string, kind: 'vendor' | 'partner' | 'organizer' | 'runner', name: string, subject: string, text: string): EmailSample => ({
  id, template: 'application_received', variant: 'standard',
  payload: { kind, name },
  expect: { subject, text, heading: 'We got your application', preheader: 'FairSynq is reviewing it now.', button: null },
})

export const EMAIL_SAMPLES: EmailSample[] = [
  // E1 — admin alerts
  admin('admin-vendor', 'vendor', 'vendor', { name: 'Taco Stand', contactName: 'Ana Ruiz', email: 'ana@example.com', phone: '555-0101' }, 'Taco Stand', 'Ana Ruiz, ana@example.com, 555-0101'),
  admin('admin-organizer', 'organizer', 'organizer', { name: 'County Fair Board', contactName: 'Lee Park', email: 'lee@example.com', phone: null }, 'County Fair Board', 'Lee Park, lee@example.com'),
  // C6: an organizer with no name is stored under their email; the email shows "(no name given)".
  admin('admin-organizer-no-name', 'organizer', 'organizer', { name: 'lee@example.com', contactName: null, email: 'lee@example.com', phone: null }, '(no name given)', 'lee@example.com'),
  admin('admin-partner', 'partner', 'partner organization', { name: 'Rotary Club', contactName: 'Sam Lee', email: 'sam@example.com', phone: '555-0102' }, 'Rotary Club', 'Sam Lee, sam@example.com, 555-0102'),
  // sign-up-fixes commit 4: an organizer who applied with their event — Event, Where and Dates rows.
  {
    id: 'admin-organizer-with-event', template: 'signup_admin_alert', variant: 'admin',
    payload: {
      kind: 'organizer', name: 'County Fair Board', contactName: 'Lee Park', email: 'lee@example.com', phone: '+12175550134',
      event: { name: 'County Fair', city: 'Alton', state: 'IL', startDate: '2027-06-05', endDate: '2027-06-07' },
    },
    expect: {
      subject: 'New organizer application: County Fair Board',
      text: `County Fair Board applied to join FairSynq as an organizer. Contact: Lee Park, lee@example.com, +12175550134. Event: County Fair, Alton, IL, Jun 5 – Jun 7, 2027. Review it at ${SITE}/admin/approvals`,
      heading: 'New organizer application',
      preheader: 'County Fair Board applied to join FairSynq.',
      button: { label: 'Review application', url: `${SITE}/admin/approvals` },
    },
  },

  // E2 — approved (C3: new subjects)
  {
    id: 'approved-vendor', template: 'decision_approved', variant: 'standard',
    payload: { kind: 'vendor', name: 'Taco Stand', contactName: 'Ana', decidedBy: 'FairSynq' },
    expect: {
      subject: 'Taco Stand is approved on FairSynq',
      text: `Hi Ana, Taco Stand is approved. Sign in to finish your setup (payouts and menu): ${SITE}/sign-in/vendor`,
      heading: "You're approved", preheader: 'Finish your payouts and menu.',
      button: { label: 'Finish your setup', url: `${SITE}/sign-in/vendor` },
    },
  },
  {
    id: 'approved-vendor-by-organizer', template: 'decision_approved', variant: 'standard',
    payload: { kind: 'vendor', name: 'Taco Stand', contactName: null, decidedBy: 'Italian Fest Committee' },
    expect: {
      subject: 'Taco Stand is approved on FairSynq',
      text: `Hi Taco Stand, Taco Stand is approved by Italian Fest Committee. Sign in to finish your setup (payouts and menu): ${SITE}/sign-in/vendor`,
      heading: "You're approved", preheader: 'Finish your payouts and menu.',
      button: { label: 'Finish your setup', url: `${SITE}/sign-in/vendor` },
    },
  },
  {
    id: 'approved-organizer', template: 'decision_approved', variant: 'standard',
    payload: { kind: 'organizer', name: 'County Fair Board', contactName: null },
    expect: {
      subject: 'Your FairSynq organizer account is approved',
      text: `Hi County Fair Board, your organizer account is approved. Sign in to create your first fair: ${SITE}/organizer/login`,
      heading: "You're approved", preheader: 'Your organizer account is ready.',
      button: { label: 'Create your first fair', url: `${SITE}/organizer/login` },
    },
  },
  // sign-up-fixes commit 4: approved with the draft saved at sign-up — the button finishes it.
  {
    id: 'approved-organizer-with-draft', template: 'decision_approved', variant: 'standard',
    payload: { kind: 'organizer', name: 'County Fair Board', contactName: null, draft: { name: 'County Fair', slug: 'county-fair' } },
    expect: {
      subject: 'Your FairSynq organizer account is approved',
      text: `Hi County Fair Board, your organizer account is approved. Sign in to finish setting up County Fair: ${SITE}/organizer/login?redirect=%2Forganizer%2Ffairs%2Fnew%3Fdraft%3Dcounty-fair`,
      heading: "You're approved", preheader: 'Your organizer account is ready.',
      button: { label: 'Finish setting up County Fair', url: `${SITE}/organizer/login?redirect=%2Forganizer%2Ffairs%2Fnew%3Fdraft%3Dcounty-fair` },
    },
  },
  {
    id: 'approved-partner', template: 'decision_approved', variant: 'standard',
    payload: { kind: 'partner', name: 'Rotary Club', contactName: 'Sam' },
    expect: {
      subject: 'Rotary Club is approved on FairSynq',
      text: `Hi Sam, Rotary Club is approved as a FairSynq partner organization. We'll be in touch about upcoming events.`,
      heading: "You're approved", preheader: 'Welcome to FairSynq.',
      button: null,
    },
  },

  // E3 — declined (C1: one full stop; no "Reason:" when there is none)
  declined('declined-vendor', { kind: 'vendor', name: 'Taco Stand', contactName: 'Ana', reason: 'Missing insurance', decidedBy: 'FairSynq' },
    `Hi Ana, we're not able to approve Taco Stand right now. Reason: Missing insurance. If you have questions, contact ${SUPPORT}.`),
  declined('declined-vendor-by-organizer', { kind: 'vendor', name: 'Taco Stand', contactName: 'Ana', reason: 'The fair is full.', decidedBy: 'Italian Fest Committee' },
    `Hi Ana, Italian Fest Committee is not able to approve Taco Stand right now. Reason: The fair is full. If you have questions, contact ${SUPPORT}.`),
  declined('declined-organizer', { kind: 'organizer', name: 'County Fair Board', contactName: null, reason: 'We could not verify the event!' },
    `Hi County Fair Board, we're not able to approve County Fair Board right now. Reason: We could not verify the event! If you have questions, contact ${SUPPORT}.`),
  declined('declined-partner-no-reason', { kind: 'partner', name: 'Rotary Club', contactName: 'Sam' },
    `Hi Sam, we're not able to approve Rotary Club right now. If you have questions, contact ${SUPPORT}.`),

  // E7 — the applicant's "we got your application" (sign-up-fixes commit 2; wording Jordan, Nov 26)
  received('received-vendor', 'vendor', 'Taco Stand', 'We got your FairSynq application',
    "Thanks, Taco Stand. We got your vendor application and FairSynq is reviewing it now. We'll email you here when there's a decision."),
  received('received-partner', 'partner', 'Rotary Club', 'We got your FairSynq partner application',
    "Thanks, Rotary Club. We got your partner application and FairSynq is reviewing it now. We'll email you here when there's a decision."),
  received('received-organizer', 'organizer', 'County Fair Board', 'We got your FairSynq organizer application',
    "Thanks, County Fair Board. We got your organizer application and FairSynq is reviewing it now. We'll email you here when there's a decision."),
  // Runners get no decision email yet, so no decision sentence.
  received('received-runner', 'runner', 'Dee', 'We got your FairSynq runner application',
    'Thanks, Dee. We got your runner application and FairSynq is reviewing it now.'),

  // E4 — FairSynq decided a vendor at the organizer's event (C5: new subject)
  {
    id: 'override-approved', template: 'vendor_override_organizer', variant: 'standard',
    payload: { vendorName: 'Taco Stand', fairName: 'Italian Fest', decision: 'approved', reason: 'Organizer did not answer in 7 days', link: OVERRIDE_LINK },
    expect: {
      subject: 'FairSynq made a decision on Taco Stand at Italian Fest',
      text: `FairSynq approved Taco Stand, a vendor at your event Italian Fest, instead of waiting for your decision. Reason: Organizer did not answer in 7 days\n\nSee the vendor: ${OVERRIDE_LINK}`,
      heading: 'FairSynq made a decision on a vendor', preheader: 'Taco Stand at Italian Fest.',
      button: { label: 'See the vendor', url: OVERRIDE_LINK },
    },
  },
  {
    id: 'override-rejected', template: 'vendor_override_organizer', variant: 'standard',
    payload: { vendorName: 'Taco Stand', fairName: 'Italian Fest', decision: 'rejected', reason: 'Health permit expired', link: OVERRIDE_LINK },
    expect: {
      subject: 'FairSynq made a decision on Taco Stand at Italian Fest',
      text: `FairSynq rejected Taco Stand, a vendor at your event Italian Fest, instead of waiting for your decision. Reason: Health permit expired\n\nSee the vendor: ${OVERRIDE_LINK}`,
      heading: 'FairSynq made a decision on a vendor', preheader: 'Taco Stand at Italian Fest.',
      button: { label: 'See the vendor', url: OVERRIDE_LINK },
    },
  },

  // E5 — menu items removed
  {
    id: 'menu-deleted-one', template: 'menu_items_deleted', variant: 'standard',
    payload: { alertType: 'MENU_ITEMS_DELETED', fairName: 'Italian Fest', vendorName: 'Taco Stand', lines: ['Cannoli ($8.00)'], link: MENU_LINK },
    expect: {
      subject: 'Taco Stand removed 1 menu item at Italian Fest',
      text: `Taco Stand removed this item from their menu at Italian Fest:\n- Cannoli ($8.00)\n\nSee the vendor's menu requests: ${MENU_LINK}`,
      heading: 'Menu items removed', preheader: 'Taco Stand changed their menu at Italian Fest.',
      button: { label: 'See menu requests', url: MENU_LINK },
    },
  },
  {
    id: 'menu-deleted-many-admin', template: 'menu_items_deleted', variant: 'standard',
    payload: { alertType: 'MENU_ITEMS_DELETED', fairName: 'Italian Fest', vendorName: 'Taco Stand', lines: ['Cannoli ($8.00)', 'Lemonade ($4.50)'], link: ADMIN_MENU_LINK },
    expect: {
      subject: 'Taco Stand removed 2 menu items at Italian Fest',
      text: `Taco Stand removed these items from their menu at Italian Fest:\n- Cannoli ($8.00)\n- Lemonade ($4.50)\n\nSee the vendor's menu requests: ${ADMIN_MENU_LINK}`,
      heading: 'Menu items removed', preheader: 'Taco Stand changed their menu at Italian Fest.',
      button: { label: 'See menu requests', url: ADMIN_MENU_LINK },
    },
  },

  // E6 — price increase waiting
  {
    id: 'price-pending-one', template: 'menu_price_change_pending', variant: 'standard',
    payload: { alertType: 'MENU_PRICE_CHANGE_PENDING', fairName: 'Italian Fest', vendorName: 'Taco Stand', lines: ['Cannoli (price increase): $8.00 → $9.50 (+$1.50, +18.8%)'], link: MENU_LINK },
    expect: {
      subject: 'A price increase is waiting for your approval: Taco Stand',
      text: `Taco Stand at Italian Fest asked for this price increase. Nothing changes on the menu until it is approved:\n- Cannoli (price increase): $8.00 → $9.50 (+$1.50, +18.8%)\n\nApprove or reject: ${MENU_LINK}`,
      heading: 'Price increase waiting', preheader: 'Nothing changes until it is approved.',
      button: { label: 'Approve or reject', url: MENU_LINK },
    },
  },
  {
    id: 'price-pending-many', template: 'menu_price_change_pending', variant: 'standard',
    payload: { alertType: 'MENU_PRICE_CHANGE_PENDING', fairName: 'Italian Fest', vendorName: 'Taco Stand', lines: ['Cannoli (price increase): $8.00 → $9.50 (+$1.50, +18.8%)', 'Lemonade (new size): $6.00'], link: MENU_LINK },
    expect: {
      subject: '2 price increases are waiting for your approval: Taco Stand',
      text: `Taco Stand at Italian Fest asked for these price increases. Nothing changes on the menu until it is approved:\n- Cannoli (price increase): $8.00 → $9.50 (+$1.50, +18.8%)\n- Lemonade (new size): $6.00\n\nApprove or reject: ${MENU_LINK}`,
      heading: 'Price increase waiting', preheader: 'Nothing changes until it is approved.',
      button: { label: 'Approve or reject', url: MENU_LINK },
    },
  },
]

/** The same emails with HOSTILE in every name, reason and line a person can type. */
export function hostileSamples(): { id: string; template: string; payload: Record<string, unknown> }[] {
  return [
    { id: 'hostile-admin', template: 'signup_admin_alert', payload: { kind: 'vendor', name: HOSTILE, contactName: HOSTILE, email: 'a@example.com', phone: HOSTILE } },
    { id: 'hostile-approved', template: 'decision_approved', payload: { kind: 'vendor', name: HOSTILE, contactName: HOSTILE, decidedBy: HOSTILE } },
    { id: 'hostile-declined', template: 'decision_rejected', payload: { kind: 'vendor', name: HOSTILE, contactName: HOSTILE, reason: HOSTILE, decidedBy: HOSTILE } },
    { id: 'hostile-received', template: 'application_received', payload: { kind: 'vendor', name: HOSTILE } },
    { id: 'hostile-admin-event', template: 'signup_admin_alert', payload: { kind: 'organizer', name: HOSTILE, contactName: HOSTILE, email: 'a@example.com', phone: null, event: { name: HOSTILE, city: HOSTILE, state: 'IL', startDate: '2027-06-05', endDate: '2027-06-07' } } },
    { id: 'hostile-approved-draft', template: 'decision_approved', payload: { kind: 'organizer', name: HOSTILE, contactName: null, draft: { name: HOSTILE, slug: 'x"><script>' } } },
    { id: 'hostile-override', template: 'vendor_override_organizer', payload: { vendorName: HOSTILE, fairName: HOSTILE, decision: 'rejected', reason: HOSTILE, link: OVERRIDE_LINK } },
    { id: 'hostile-deleted', template: 'menu_items_deleted', payload: { alertType: 'MENU_ITEMS_DELETED', fairName: HOSTILE, vendorName: HOSTILE, lines: [HOSTILE], link: MENU_LINK } },
    { id: 'hostile-price', template: 'menu_price_change_pending', payload: { alertType: 'MENU_PRICE_CHANGE_PENDING', fairName: HOSTILE, vendorName: HOSTILE, lines: [HOSTILE], link: MENU_LINK } },
  ]
}
