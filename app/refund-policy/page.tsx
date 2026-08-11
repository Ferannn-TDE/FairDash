import Link from 'next/link'
import { EnvelopeIcon } from '@heroicons/react/24/outline'
import MarketplaceNavbar from '../_components/MarketplaceNavbar'
import { CONTACT_EMAIL, RESPONSE_TIME_LONG, contactMailto } from '@/lib/contact-info'

export const metadata = { title: 'Refund Policy — FairSynq' }

const POLICY_SECTIONS = [
  {
    heading: 'All Sales Are Final',
    body: 'Due to the nature of food service at live events, all sales are final once an order is confirmed. If you have an issue with your order, please reach out to us directly — we are happy to work with you.',
  },
  {
    heading: 'FairSynq Is a Pre-Order Platform',
    body: 'FairSynq enables you to order food in advance from vendors at a fair. We are not responsible for how food is prepared, cooked, or presented — that is entirely in the hands of the vendor booth.',
  },
  {
    heading: 'When We Will Issue Refunds',
    body: 'We will consider a refund or credit if: (a) your order was never fulfilled by the vendor, (b) you were charged but the vendor was closed, or (c) there was a confirmed billing error. In these cases please contact us within 48 hours of the event.',
  },
  {
    heading: 'How To Request Help',
    body: `Email us at ${CONTACT_EMAIL} or message us on Facebook with your order number and a description of the issue. We aim to respond ${RESPONSE_TIME_LONG}.`,
  },
]

export default function RefundPolicyPage() {
  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">

        {/* Hero */}
        <section className="py-14 border-b border-white/5 bg-[radial-gradient(circle_at_50%_0%,rgba(255,0,119,0.08),transparent_60%)]">
          <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 text-center">
            <h1 className="font-bebas text-5xl sm:text-6xl text-white tracking-wide">
              Refund <span className="text-neon-pink">Policy</span>
            </h1>
            <p className="mt-3 text-text-gray text-sm">Last updated: January 1, 2026</p>
          </div>
        </section>

        {/* Content */}
        <section className="max-w-[800px] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-14">
          <div className="bg-bg-card border border-white/10 rounded-2xl p-8 sm:p-10 space-y-8">

            {POLICY_SECTIONS.map(({ heading, body }) => (
              <div key={heading}>
                <h2 className="font-bebas text-xl tracking-wide text-white mb-2">{heading}</h2>
                <p className="text-text-gray text-sm leading-relaxed">{body}</p>
              </div>
            ))}

            {/* Contact strip */}
            <div className="pt-6 border-t border-white/10">
              <p className="text-text-gray text-sm mb-4">
                Have a question about your order?
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href={contactMailto()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-neon-pink text-white text-sm font-semibold hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors"
                >
                  <EnvelopeIcon className="w-4 h-4" />
                  Email Us
                </a>
                <Link
                  href="/contact"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-semibold hover:bg-white/10 transition-colors"
                >
                  Contact Form →
                </Link>
              </div>
            </div>
          </div>
        </section>

      </div>
    </>
  )
}
