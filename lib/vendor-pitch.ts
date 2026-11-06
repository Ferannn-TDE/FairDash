// Vendor pitch above vendor sign-in (Batch 1 item 8, B1.9). Approved copy, 2026-11-05.
// Rules: only what works today (the one-menu point is marked "coming in December", Batch 2 / C-14
// option b); no payout timing; consistent with the homepage vendor card. "Standard card processing
// comes out of each payout" stays true only while item 10's card-fee setting is "vendor pays" (C-3).
export const VENDOR_PITCH = {
  heading: 'Sell more at every event. Free.',
  points: [
    { lead: 'Free to use.', text: 'No sign-up cost, no monthly fee, no commission on your sales. Standard card processing comes out of each payout.' },
    { lead: 'More sales.', text: 'Fairgoers order from their phones instead of walking away from your line.' },
    { lead: 'One menu for every event, coming in December.', text: 'Build your menu once and use it at every fair you work.' },
    { lead: 'Fast payouts.', text: 'Customers pay by card before you start cooking, and your earnings go straight to your bank through Stripe.' },
  ],
} as const
