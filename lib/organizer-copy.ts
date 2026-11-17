// The /organizers "For Fairs & Festivals" page (C-15), approved by Feran 2026-11-14 (BATCH-1 §21,
// Q5). Word for word; locked by scripts/organizers-page-test.ts. Change only with Feran's OK.
// PARKED 2026-11-17: /organizers redirects to /organizer/login (next.config.mjs). The organizer
// sign-in page still uses this copy (lib/signin-copy.ts); the page code is kept.
//
// Deliberately absent (false today or waiting on the client): free / fees, payout timing, reach
// numbers, messaging vendors, booth signs, and a contact line (waits for C-20).

export const ORGANIZERS_PATH = '/organizers'
export const ORGANIZER_LOGIN_PATH = '/organizer/login'
export const ORGANIZER_APPLY_PATH = '/organizer/login?mode=apply'

export const ORGANIZERS_PAGE = {
  title: 'For Fairs & Festivals — FairSynq',
  eyebrow: 'FOR FAIRS & FESTIVALS',
  heading: 'Shorter lines. Busier booths.',
  intro:
    "FairSynq lets fairgoers order from your food vendors on their own phones, then pick up at the booth when it's ready. You run your fair from one dashboard.",
  primaryButton: { label: 'Get started', href: ORGANIZER_APPLY_PATH },
  secondaryButton: { label: 'Already hosting? Sign in', href: ORGANIZER_LOGIN_PATH },
  canDo: {
    heading: 'What you can do',
    points: [
      "Set up your fair. Name, dates, venue, hours and accent color. Save it as a draft, then publish when it's ready.",
      'See and manage your vendors. Booth details, menu and required documents. Pause or reactivate a vendor.',
      'Review menu changes before they go live.',
      'Watch orders as they come in, booth by booth, with sales for the day.',
      "Handle customer issues, including refunding an order or one vendor's part.",
      'Run several fairs from one account.',
    ],
  },
  noInstall: {
    heading: 'Nothing to install',
    points: [
      "Fairgoers order on your fair's page. No app to download.",
      'Vendors use their own phone or tablet.',
      'Booth pickup at every fair, and we can set up curbside for yours.',
    ],
  },
  steps: {
    heading: 'How to get started',
    points: [
      'Create your organizer account.',
      'FairSynq reviews and approves it.',
      'Create your fair and publish it.',
      'We give you a sign-up link for your vendors, and FairSynq reviews each vendor.',
    ],
  },
} as const

