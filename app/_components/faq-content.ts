// ---------------------------------------------------------------------------
// FAQ CONTENT — the single source for both renderers.
//
// TWO CONSUMERS, ONE ARRAY:
//   • app/faq/page.tsx        — server component, all four categories stacked,
//                               native <details>. For deep links and SEO.
//   • app/_components/FAQSection.tsx — client component, tabbed + animated,
//                               embedded in the landing page. For discovery.
//
// Deliberately plain data — NO JSX and no icon imports, because a server
// component cannot hold client component nodes. The section maps category id →
// icon on its own side of the boundary.
//
// ⚠️ These answers restate numbers that live in lib/constants.ts (10% service
// fee, 10-min accept timeout, 4-hour payout window, 5-min vendor heartbeat).
// This is a SECOND COPY in prose, and prose has no drift-guard — if a constant
// changes, change it here too. Sharing this file is what keeps it ONE second
// copy rather than two.
//
// ONLY RESTATE ENFORCED CONSTANTS. Two answers here once quoted numbers that
// are defined but wired to nothing, which made them promises the code does not
// keep: a $5 cancellation fee (ORDER_CANCELLATION_FEE_USD — zero call sites,
// never charged) and a 100m delivery-GPS check (HOME_DELIVERY_GPS_RADIUS_M —
// orphaned alongside haversineMetres, see app/api/orders/[id]/status/route.ts:11).
// Before quoting a constant here, confirm something READS it and acts on it.
// ---------------------------------------------------------------------------

export interface FAQItem {
  q: string
  a: string
  cta?: { label: string; href: string }
}

export interface FAQCategory {
  id: string
  label: string
  items: FAQItem[]
}

export const FAQ_CATEGORIES: FAQCategory[] = [
  { id: 'customers', label: 'Customers', items: [
    { q: 'How do I get my food?', a: "Three ways: pick it up at the vendor's booth, have it brought to your car curbside, or get it delivered to an address off-site." },
    { q: 'What fees will I pay?', a: 'A 10% service fee on your food subtotal (not on delivery), plus a delivery fee if you choose curbside or home delivery.' },
    { q: "What happens if the vendor doesn't accept my order?", a: "If a vendor doesn't accept within 10 minutes, your order is automatically cancelled and fully refunded." },
    { q: 'Can I cancel an order?', a: "Before a vendor accepts, you can cancel and we'll refund your food — the 10% service fee isn't refunded. Once a vendor has accepted, you'll need to request a refund, and our team will review it." },
  ]},
  { id: 'vendors', label: 'Vendors', items: [
    { q: 'When do I get paid?', a: 'Your payout is released 4 hours after an order is completed — a short window that covers any refunds before money moves.' },
    { q: 'What does FairSynq take?', a: "No commission. Our only revenue is the customer's 10% service fee. You do cover your share of Stripe's processing fee, the same as any card payment." },
    { q: 'What do I need before customers can order from me?', a: 'Three things: your booth set to active, a verified Stripe payout account connected, and at least one item available on your menu.' },
    { q: 'Why did I disappear from the customer menu?', a: "Your dashboard sends a heartbeat while it's open. If it stops for 5 minutes, you're automatically hidden until it reconnects — just reopen your dashboard." },
  ]},
  { id: 'runners', label: 'Runners', items: [
    { q: 'How do I get deliveries?', a: "You claim them. Available deliveries are first-come, and once you claim one it's locked to you." },
    { q: 'What do I earn?', a: 'A share of the delivery fee (set by the event organizer) plus 100% of any tip. Tips are never split and carry no service fee.' },
    { q: 'How is a home delivery confirmed?', a: 'Runners confirm the drop-off in the app, with a delivery photo as proof.' },
  ]},
  { id: 'organizers', label: 'Organizers', items: [
    { q: 'Can I start running fairs as soon as I sign up?', a: "Not quite. New organizer accounts are reviewed by the FairSynq team first. You can sign in and see your status, but creating fairs and managing vendors open up once you're approved." },
    { q: 'Do I need a Stripe account?', a: "Yes. Payouts go to your own Stripe account, which you connect yourself from the organizer portal. Until it's connected and verified, your earnings are held safely — never lost." },
    { q: 'How and when do I get paid?', a: "In one batched payout per fair, not per order: FairSynq sums everything you've earned at that event and transfers it to your Stripe account. Each portion becomes payable 4 hours after its order completes." },
    { q: 'What does it cost, and what do I earn?', a: 'Commercial terms — including your share of any delivery or curbside fees — are agreed per event with the FairSynq team.', cta: { label: 'Get in touch', href: '/contact' } },
  ]},
]
