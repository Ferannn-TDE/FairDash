// Homepage v2 copy (design approved by Jordan 2026-11-22: homepage-v2-design.html). Word for word;
// locked by scripts/homepage-stats-guard.ts. Every homepage string and link lives here.
//
// Deliberately absent: fee percentages, sold-out promises, delivery wording, stats and
// competitor names.

import { ORGANIZER_APPLY_PATH, ORGANIZER_LOGIN_PATH } from './organizer-copy'
import { PARTNERS_PATH } from './partner-copy'

// ── Until ordering opens (2027) ──────────────────────────────────────────────────────────────
// The "Get notified when ordering opens" sign-up is a later task (it needs storage and the
// Privacy Policy live first). Until then the fairgoer paths go to Find a Fair, read "Find a Fair",
// and the How it works / FAQ tabs open on Vendors. The later task changes these three together.
export const FOOD_PATH = '/fairs'
export const FOOD_PATH_LABEL = 'Find a Fair'
export const DEFAULT_TAB: AudienceKey = 'vendor'

// Vendor sign-up. /onboarding?role=vendor sends a signed-OUT visitor to the fairgoer sign-in
// (app/onboarding/page.tsx), losing the vendor role, so a signed-out visitor starts on the vendor
// sign-up tab instead; after sign-up it continues to /onboarding?role=vendor → /become-vendor
// (lib/auth-destinations.ts).
export const VENDOR_SIGNUP_SIGNED_OUT = '/sign-in/vendor?mode=apply'
export const VENDOR_SIGNUP_SIGNED_IN = '/onboarding?role=vendor'

export const ORGANIZER_SIGNUP_PATH = ORGANIZER_APPLY_PATH
export const GROUP_PATH = PARTNERS_PATH

export type AudienceKey = 'food' | 'vendor' | 'organizer' | 'group'

export const HOME_HEADER = {
  signIn: 'Sign in',
  signInChoices: [
    { label: 'Vendor sign-in', href: '/sign-in/vendor' },
    { label: 'Organizer sign-in', href: ORGANIZER_LOGIN_PATH },
    { label: 'Fairgoer sign-in', href: '/sign-in/customer' },
  ],
  account: { label: 'My account', href: '/account' },
  menuLabel: 'Open menu',
  menu: [
    { label: 'How it works', href: '#how' },
    { label: 'Questions', href: '#faq' },
    { label: 'Pick your path', href: '#paths' },
    { label: 'Contact', href: '/contact' },
  ],
} as const

export const HOME_HERO = {
  eyebrow: 'LAUNCHING AT FAIRS & FESTIVALS IN 2027',
  headingLine1: 'LONG LINES ARE',
  headingLine2: 'LOST SALES.',
  subhead: 'Fairgoers order ahead and skip the line. Vendors sell more. Organizers run it all from one dashboard.',
  // Kept but not shown: the hero sign-up banner is hidden until the legal pages are live (Jordan,
  // 2026-11-23). The tile, How it works and Pick your path still lead to vendor sign-up.
  vendorButton: 'Vendors: sign-up is open now →',
} as const

export const WHO_ARE_YOU = 'WHO ARE YOU?'

// Tile order follows the design. hrefs: food → FOOD_PATH, vendor → vendor sign-up (signed-in
// aware, see VendorSignupLink), organizer → organizer sign-up, group → Partner with us.
export const HOME_TILES = [
  { key: 'food', title: 'I want food', line: 'Ordering opens in 2027' },
  { key: 'vendor', title: "I'm a vendor", line: 'Sell more. Free to join.' },
  { key: 'organizer', title: 'I run an event', line: 'Run it from one dashboard' },
  { key: 'group', title: "We're a group", line: 'Raise money running curbside' },
] as const satisfies readonly { key: AudienceKey; title: string; line: string }[]

export const HOME_STRIP = [
  { title: 'No app to download', line: 'Customers order from their browser' },
  { title: 'No new equipment', line: 'Runs on the phone or tablet you have' },
  { title: 'No monthly fees', line: 'Free to join' },
] as const

export const HOW_IT_WORKS = {
  eyebrow: 'HOW IT WORKS',
  heading: 'THREE STEPS.',
  headingAccent: "THAT'S IT.",
  tabsLabel: 'Choose who you are',
} as const

export const FAQ_HEADER = {
  eyebrow: 'NEED HELP?',
  heading: 'QUESTIONS,',
  headingAccent: 'ANSWERED',
  showingFor: 'Showing answers for',
  pickAnother: 'Pick another above.',
} as const

export type Audience = {
  name: string
  cta: string
  steps: readonly (readonly [string, string])[]
  faqs: readonly (readonly [string, string])[]
}

export const AUDIENCE_ORDER: readonly AudienceKey[] = ['food', 'vendor', 'organizer', 'group']

export const AUDIENCES: Record<AudienceKey, Audience> = {
  food: {
    name: 'Fairgoers',
    cta: FOOD_PATH_LABEL,
    steps: [
      ['Find your fair', 'See which fairs and festivals near you are on FairSynq.'],
      ['Order on your phone', "Browse every vendor's menu and pay ahead. No app needed."],
      ['Pick it up', "We text you when it's ready. Grab it at the booth, or curbside at select events."],
    ],
    faqs: [
      ['How do I get my food?', 'Order and pay on your phone. When the vendor marks it ready, you get a text. Pick it up at their booth, or curbside at events that offer it.'],
      ['What fees will I pay?', 'A small service fee per order. You see the full total before you pay, with no surprises.'],
      ['Can I cancel an order?', 'Yes, before the vendor accepts it, and you get a full refund.'],
    ],
  },
  vendor: {
    name: 'Vendors',
    cta: 'Sign up free',
    steps: [
      ['Sign up free', 'Create your account and add your menu with photos and prices.'],
      ['Join your events', 'Request to join a fair, or set up booth pickup at any event you work.'],
      ['Take orders ahead', 'Orders hit your phone or tablet. Mark them ready and the customer comes to you.'],
    ],
    faqs: [
      ['What does it cost me?', 'Free to join. No commission and no monthly fees. You only pay standard card processing on your own sales.'],
      ['How do orders reach me?', 'On your phone or tablet at the booth, with an alert for every new order.'],
      ['When do I get paid?', 'After each event, and weekly at longer fairs.'],
    ],
  },
  organizer: {
    name: 'Organizers',
    cta: 'Bring FairSynq to your event',
    steps: [
      ['Create your event', "Save it as a draft and publish when you're ready."],
      ['Bring in your vendors', 'Invite them, or approve the ones who request to join.'],
      ['Watch it run', 'See orders come in booth by booth, all from one dashboard.'],
    ],
    faqs: [
      ['How do vendors join my event?', 'Send them your invite link, or approve vendors who request to join.'],
      ['Can I run more than one event?', 'Yes. Run several events from one account.'],
      ['Who runs curbside pickup?', "A local partner group brings its own volunteers, so you don't need extra staff."],
    ],
  },
  group: {
    name: 'Groups',
    cta: 'Partner with us',
    steps: [
      ['Sign up your group', 'Tap Partner with us. We approve every group.'],
      ['Run curbside', 'Your volunteers walk orders from the booths to the curb.'],
      ['Raise money', 'Your group keeps the curbside fee plus 100% of tips.'],
    ],
    faqs: [
      ['How does our group earn?', 'You keep the curbside fee on every curbside order, plus 100% of tips.'],
      ['Who are the runners?', 'Your own volunteers. Orders go straight to their phones, first come, first served.'],
      ['What kind of groups can join?', 'Clubs, teams, service groups and other local organizations.'],
    ],
  },
}

export const PICK_YOUR_PATH = {
  heading: 'READY?',
  headingAccent: 'PICK YOUR PATH.',
  links: [
    { key: 'food', label: FOOD_PATH_LABEL },
    { key: 'vendor', label: 'Vendor sign-up, free' },
    { key: 'organizer', label: 'Bring FairSynq to your event' },
    { key: 'group', label: 'Partner with us' },
  ],
} as const satisfies { heading: string; headingAccent: string; links: readonly { key: AudienceKey; label: string }[] }

// Legal links (Vendor Agreement, Privacy, Terms, Refund policy) are left out until the legal pages
// are rewritten (Jordan, 2026-11-23): the live Vendor Agreement and Refund Policy still carry old
// wording, and Privacy and Terms pages don't exist yet.
export const HOME_FOOTER = {
  supportEmail: 'support@fairsynq.com',
  questionsLead: 'Questions? Email',
  copyright: '© 2026 FairSynq, formerly Fair Dash',
} as const

// Fixed destinations for every audience except the vendor (whose link depends on sign-in).
export const AUDIENCE_HREF: Record<Exclude<AudienceKey, 'vendor'>, string> = {
  food: FOOD_PATH,
  organizer: ORGANIZER_SIGNUP_PATH,
  group: GROUP_PATH,
}
