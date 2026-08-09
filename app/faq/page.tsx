import Link from 'next/link'
import { PlusIcon, MinusIcon } from '@heroicons/react/24/outline'
import MarketplaceNavbar from '../_components/MarketplaceNavbar'

export const metadata = {
  title: 'FAQ — FairSynq',
  description: 'Answers for customers, vendors, runners, and organizers.',
}

// ---------------------------------------------------------------------------
// The accordion is a native <details>/<summary> — no state, no Radix, no
// client boundary, so this page stays a server component like /refund-policy.
// The +/− swap is pure CSS: `group-open:` keys off the <details open> attribute.
//
// ⚠️ These answers restate numbers that live in lib/constants.ts (10% service
// fee, 10-min accept timeout, $5 cancellation, 4-hour payout window, 5-min
// vendor heartbeat, 100m delivery radius). This is a SECOND COPY in prose, and
// prose has no drift-guard — if a constant changes, change it here too.
// ---------------------------------------------------------------------------

const FAQ_SECTIONS = [
  {
    audience: 'For customers',
    items: [
      { q: 'How do I get my food?',
        a: "Three ways: pick it up at the vendor's booth, have it brought to your car curbside, or get it delivered to an address off-site." },
      { q: 'What fees will I pay?',
        a: 'A 10% service fee on your food subtotal (not on delivery), plus a delivery fee if you choose curbside or home delivery.' },
      { q: "What happens if the vendor doesn't accept my order?",
        a: "If a vendor doesn't accept within 10 minutes, your order is automatically cancelled and fully refunded." },
      { q: 'Can I cancel an order?',
        a: "Yes, for free before the vendor accepts it. Once they've accepted, a $5 cancellation fee applies." },
    ],
  },
  {
    audience: 'For vendors',
    items: [
      { q: 'When do I get paid?',
        a: 'Your payout is released 4 hours after an order is completed — a short window that covers any refunds before money moves.' },
      { q: 'What does FairSynq take?',
        a: "No commission. Our only revenue is the customer's 10% service fee. You do cover your share of Stripe's processing fee, the same as any card payment." },
      { q: 'What do I need before customers can order from me?',
        a: 'Three things: your booth set to active, a verified Stripe payout account connected, and at least one item available on your menu.' },
      { q: 'Why did I disappear from the customer menu?',
        a: "Your dashboard sends a heartbeat while it's open. If it stops for 5 minutes, you're automatically hidden until it reconnects — just reopen your dashboard." },
    ],
  },
  {
    audience: 'For runners',
    items: [
      { q: 'How do I get deliveries?',
        a: "You claim them. Available deliveries are first-come, and once you claim one it's locked to you." },
      { q: 'What do I earn?',
        a: 'A share of the delivery fee (set by the event organizer) plus 100% of any tip. Tips are never split and carry no service fee.' },
      { q: 'How is a home delivery confirmed?',
        a: 'By GPS. You confirm the drop-off within 100 metres of the delivery address.' },
    ],
  },
  {
    audience: 'For organizers',
    items: [
      { q: 'Can I start running fairs as soon as I sign up?',
        a: 'Not quite. New organizer accounts are reviewed by the FairSynq team first. You can sign in and see your status, but creating fairs and managing vendors open up once you\'re approved.' },
      { q: 'Do I need a Stripe account?',
        a: 'Yes. Payouts go to your own Stripe account, which you connect yourself from the organizer portal. Until it\'s connected and verified, your earnings are held safely — never lost.' },
      { q: 'How and when do I get paid?',
        a: 'In one batched payout per fair, not per order: FairSynq sums everything you\'ve earned at that event and transfers it to your Stripe account. Each portion becomes payable 4 hours after its order completes.' },
      { q: 'What does it cost, and what do I earn?',
        a: 'Commercial terms — including your share of any delivery or curbside fees — are agreed per event with the FairSynq team.',
        cta: { label: 'Get in touch', href: '/contact' } },
    ],
  },
]

export default function FAQPage() {
  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">

        {/* Hero */}
        <section className="py-14 border-b border-white/5 bg-[radial-gradient(circle_at_50%_0%,rgba(255,0,119,0.08),transparent_60%)]">
          <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 text-center">
            <h1 className="font-bebas text-5xl sm:text-6xl text-white tracking-wide">
              Frequently asked <span className="text-neon-pink">questions</span>
            </h1>
            <p className="mt-3 text-text-gray text-sm">
              Answers for customers, vendors, runners, and organizers.
            </p>
          </div>
        </section>

        {/* Content */}
        <section className="max-w-[800px] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-14 space-y-10">

          {FAQ_SECTIONS.map(({ audience, items }) => (
            <div key={audience}>
              <h2 className="font-bebas text-2xl tracking-wide text-white mb-4">{audience}</h2>

              <div className="flex flex-col gap-3">
                {items.map(({ q, a, cta }) => (
                  <details
                    key={q}
                    className="group bg-bg-card border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
                  >
                    <summary className="flex items-center justify-between gap-4 cursor-pointer list-none p-5 [&::-webkit-details-marker]:hidden">
                      <span className="text-white text-sm font-medium">{q}</span>
                      <span className="shrink-0 w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                        <PlusIcon className="w-4 h-4 text-text-gray group-open:hidden" />
                        <MinusIcon className="w-4 h-4 text-neon-pink hidden group-open:block" />
                      </span>
                    </summary>

                    <div className="px-5 pb-5">
                      <p className="text-text-gray text-sm leading-relaxed">{a}</p>
                      {cta && (
                        <Link
                          href={cta.href}
                          className="inline-block mt-3 text-sm font-semibold text-neon-pink hover:text-white transition-colors"
                        >
                          {cta.label} →
                        </Link>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ))}

        </section>

      </div>
    </>
  )
}
