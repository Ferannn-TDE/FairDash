import Link from 'next/link'
import type { Metadata } from 'next'
import MarketplaceNavbar from '../_components/MarketplaceNavbar'
import { CONTACT_CHANNELS, ContactChannelCard } from '../_components/contact-channels'
import { CONTACT_EMAIL, RESPONSE_TIME_LONG, SUPPORT_SUBJECT, contactMailto } from '@/lib/contact-info'

export const metadata: Metadata = { title: 'Contact Us — FairSynq' }

/**
 * ── THIS PAGE NO LONGER PRETENDS TO SEND ─────────────────────────────────────
 *
 * It used to render a contact FORM (name / email / message / "Send Message").
 * The form performed NO network call. On submit it ran a setTimeout, cleared the
 * fields, and toasted "Message sent! We'll get back to you soon." There is no
 * /api/contact route, no message table, and no email provider installed — the
 * message was discarded, every time.
 *
 * That is worse than an obviously-dead channel. A phone number that rings nowhere
 * announces itself the moment you call it; this AFFIRMATIVELY CONFIRMED delivery
 * to someone with a broken order, who then waited for a reply that could not come.
 *
 * The replacement is a `mailto:` — it hands the message to a client that actually
 * delivers, addressed to an inbox that actually receives. Less clever, and true.
 *
 * ⚠️ DO NOT REINSTATE A FORM HERE without a real destination behind it (an API
 * route that persists or forwards, and a provider that sends). A form is a promise
 * of delivery; keep the promise or don't make it.
 *
 * Every fact on this page comes from lib/contact-info + _components/contact-channels,
 * which the landing section renders too — so the two can't drift.
 */
export default function ContactPage() {
  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">

        {/* Hero */}
        <section className="py-14 border-b border-white/5 bg-[radial-gradient(circle_at_50%_0%,rgba(255,0,119,0.08),transparent_60%)]">
          <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 text-center">
            <p className="text-[11px] text-neon-pink font-inter font-semibold uppercase tracking-[0.2em] mb-3">
              Get in touch
            </p>
            <h1 className="font-bebas text-5xl sm:text-6xl text-white tracking-wide">
              Contact <span className="text-neon-pink">Us</span>
            </h1>
            <p className="mt-3 text-text-gray text-base max-w-md mx-auto">
              Have a question or an issue with an order? Reach out and we&apos;ll get back to you.
            </p>
          </div>
        </section>

        {/* Channels */}
        <section className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-14">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5 max-w-5xl mx-auto">
            {CONTACT_CHANNELS.map(channel => (
              <ContactChannelCard key={channel.title} channel={channel} />
            ))}
          </div>

          {/* The primary action — a real mailto, not a form that discards. */}
          <div className="max-w-5xl mx-auto mt-10">
            <div className="bg-bg-card border border-white/10 rounded-2xl p-8 text-center">
              <h2 className="font-bebas text-2xl tracking-wide text-white mb-2">Send Us a Message</h2>
              <p className="text-text-gray text-sm max-w-md mx-auto mb-6">
                Email opens in your mail app, addressed to our team. Include your order number if
                you have one — it gets you a faster answer. We reply {RESPONSE_TIME_LONG}.
              </p>
              <a
                href={contactMailto(SUPPORT_SUBJECT)}
                className="inline-flex items-center justify-center px-7 py-3 rounded-xl bg-neon-pink text-white font-semibold hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors no-underline"
              >
                Email {CONTACT_EMAIL}
              </a>
            </div>
          </div>

          <div className="text-center mt-8">
            <Link
              href="/refund-policy"
              className="text-sm text-text-gray hover:text-white transition-colors underline underline-offset-4"
            >
              View our Refund Policy →
            </Link>
          </div>
        </section>
      </div>
    </>
  )
}
