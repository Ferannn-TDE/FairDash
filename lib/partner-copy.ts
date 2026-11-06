// The client's exact partner copy (Platform Changes doc, p.3: 1.8 card + top link). Word for word;
// used by the homepage card and the top of /partners. Change only with the client.
//
// NOTE: "Your group keeps the curbside fee plus 100% of tips" depends on partner payouts, which are
// Batch 4 (docs/BATCH-1.md). Until then, no money moves to partners.
// The client's 1.8 top link. NOT SHOWN: removed from the site on 2026-11-05 pending the client's OK,
// and the client approved the removal (docs/BATCH-1.md §12). Kept so the exact wording is on record.
export const PARTNER_TOP_LINK = { lead: 'Organizations:', action: 'Partner with us' } as const

export const PARTNER_CARD = {
  heading: 'For Partner Organizations',
  text: 'Raise money for your group by running curbside pickup at fairs and festivals.',
  points: [
    'Volunteers walk orders from booths to the curb',
    'Your group keeps the curbside fee plus 100% of tips',
    "Orders go straight to volunteers' phones, first come, first served",
    "Pick the hours you can staff, and your group's name goes on the curbside signs",
  ],
  button: 'Partner with us',
} as const

export const PARTNERS_PATH = '/partners'
