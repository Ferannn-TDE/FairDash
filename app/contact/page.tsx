import Link from 'next/link'
import { EnvelopeIcon } from '@heroicons/react/24/outline'
import type { Metadata } from 'next'
import MarketplaceNavbar from '../_components/MarketplaceNavbar'
import ContactForm from './ContactForm'

export const metadata: Metadata = { title: 'Contact Us — FairSynq' }

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

export default function ContactPage() {
  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">

        {/* Hero */}
        <section className="py-14 border-b border-white/5 bg-[radial-gradient(circle_at_50%_0%,rgba(255,0,119,0.08),transparent_60%)]">
          <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 text-center">
            <h1 className="font-bebas text-5xl sm:text-6xl text-white tracking-wide">
              Contact <span className="text-neon-pink">Us</span>
            </h1>
            <p className="mt-3 text-text-gray text-base max-w-md mx-auto">
              Have a question or issue? Reach out and we&apos;ll get back to you quickly.
            </p>
          </div>
        </section>

        {/* Content */}
        <section className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-14">
          <div className="grid lg:grid-cols-2 gap-10 max-w-4xl mx-auto">

            {/* Form */}
            <div className="bg-bg-card border border-white/10 rounded-2xl p-8">
              <h2 className="font-bebas text-2xl tracking-wide text-white mb-6">Send a Message</h2>
              <ContactForm />
            </div>

            {/* Contact info */}
            <div className="flex flex-col gap-5">
              <div className="bg-bg-card border border-white/10 rounded-2xl p-6">
                <h3 className="font-bebas text-xl tracking-wide text-white mb-4">Get In Touch</h3>
                <div className="space-y-4">
                  <a
                    href="mailto:contact@fairsynq.com"
                    className="flex items-center gap-3 text-text-gray hover:text-white transition-colors group"
                  >
                    <span className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:border-neon-pink/40 transition-colors shrink-0">
                      <EnvelopeIcon className="w-4 h-4 text-neon-pink" />
                    </span>
                    <div>
                      <div className="text-[0.6875rem] uppercase tracking-wide font-semibold mb-0.5">Email</div>
                      <div className="text-sm">contact@fairsynq.com</div>
                    </div>
                  </a>
                  <a
                    href="https://facebook.com/fairsynq"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 text-text-gray hover:text-white transition-colors group"
                  >
                    <span className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:border-neon-pink/40 transition-colors shrink-0">
                      <FacebookIcon className="w-4 h-4 text-neon-pink" />
                    </span>
                    <div>
                      <div className="text-[0.6875rem] uppercase tracking-wide font-semibold mb-0.5">Facebook</div>
                      <div className="text-sm">Message us on Facebook</div>
                    </div>
                  </a>
                </div>
              </div>

              <div className="bg-bg-card border border-white/10 rounded-2xl p-6">
                <h3 className="font-bebas text-xl tracking-wide text-white mb-2">Response Time</h3>
                <p className="text-text-gray text-sm leading-relaxed">
                  We typically respond within{' '}
                  <span className="text-white font-medium">24 hours</span> on business days.
                  For urgent issues with an active order, email us directly for the fastest response.
                </p>
              </div>

              <div className="text-center">
                <Link
                  href="/refund-policy"
                  className="text-sm text-text-gray hover:text-white transition-colors underline underline-offset-4"
                >
                  View our Refund Policy →
                </Link>
              </div>
            </div>

          </div>
        </section>
      </div>
    </>
  )
}
