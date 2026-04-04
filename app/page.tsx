'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { motion, useScroll, useTransform } from 'framer-motion'
import { EnvelopeIcon } from '@heroicons/react/24/outline'
import { EASE, TIMING, Reveal, Stagger, StaggerItem } from '@/components/animations/motion'
import MarketplaceNavbar from './_components/MarketplaceNavbar'
import FairCard from './_components/FairCard'
import HowItWorksSection from './_components/HowItWorksSection'
import { mockFairs, getActiveFairs } from '@/lib/mock'

// ── Facebook icon (heroicons has no social icons) ─────────────────────────────

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

// ── Fix 4: CTA section — equal-width buttons, unified font ───────────────────

function CTASection() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y       = useTransform(scrollYProgress, [0, 1], [60, -60])
  const opacity = useTransform(scrollYProgress, [0, 0.25, 0.75, 1], [0, 1, 1, 0])

  return (
    <section ref={ref} className="relative py-24 sm:py-32 overflow-hidden">
      <motion.div
        style={{ y }}
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <div className="w-[600px] h-[600px] rounded-full bg-neon-pink/10 blur-[120px]" />
      </motion.div>

      <motion.div
        style={{ opacity }}
        className="relative z-10 text-center max-w-2xl mx-auto px-5 sm:px-[6%] lg:px-8"
      >
        <p className="text-text-gray text-sm font-semibold uppercase tracking-widest mb-4">
          For organizers
        </p>
        <h2 className="font-bebas text-4xl sm:text-6xl text-white tracking-wide leading-none">
          Run a Fair?{' '}
          <span className="text-neon-pink">Partner With Us</span>
        </h2>
        <p className="mt-5 text-text-gray text-base sm:text-lg max-w-xl mx-auto">
          We handle online ordering, payments, and logistics. You focus on running an incredible event.
        </p>

        {/* Fix 4: both buttons same width + same font */}
        <div className="mt-10 flex flex-col items-center gap-4">
          <motion.div
            className="w-full max-w-[280px]"
            whileHover={{ scale: 1.04, transition: { duration: 0.2, ease: EASE.smooth } }}
            whileTap={{ scale: 0.97 }}
          >
            <Link
              href="/organizer"
              className="flex items-center justify-center w-full px-8 py-4 rounded-xl bg-neon-pink text-white font-semibold hover:bg-[#e0006b] shadow-[0_4px_24px_rgba(255,0,119,0.4)] transition-colors"
            >
              Get Started
            </Link>
          </motion.div>
          <motion.div
            className="w-full max-w-[280px]"
            whileHover={{ scale: 1.03, transition: { duration: 0.2, ease: EASE.smooth } }}
            whileTap={{ scale: 0.97 }}
          >
            <Link
              href="/become-vendor"
              className="flex items-center justify-center w-full px-8 py-4 rounded-xl bg-white/5 border border-white/10 text-white font-semibold hover:bg-white/10 transition-colors"
            >
              Become a Vendor →
            </Link>
          </motion.div>
        </div>
      </motion.div>
    </section>
  )
}

// ── Fix 5+7: Footer — subtle, horizontal, full content ───────────────────────

const FOOTER_LINKS = {
  company: [
    { label: 'Contact Us',     href: '/contact' },
    { label: 'Refund Policy',  href: '/refund-policy' },
  ],
  join: [
    { label: 'Become a Vendor', href: '/become-vendor' },
    { label: 'Become a Driver', href: '/become-driver' },
  ],
}

function SiteFooter() {
  return (
    <footer className="border-t border-white/5">
      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-12 sm:py-16">

        {/* Top: branding left, link groups right */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-10">

          {/* Branding */}
          <div className="max-w-xs">
            <Link href="/" className="group inline-flex items-center">
              <span className="font-bebas text-xl text-white transition-colors duration-200 group-hover:text-neon-pink leading-none">
                FAIR
              </span>
              <span className="font-bebas text-xl text-neon-pink transition-colors duration-200 group-hover:text-white leading-none">
                SYNQ
              </span>
            </Link>
            <p className="mt-3 text-sm text-text-gray leading-relaxed">
              The fair comes to your door. Fresh. Fast. Fair.
            </p>
          </div>

          {/* Link groups */}
          <div className="flex flex-wrap gap-x-12 sm:gap-x-16 gap-y-8">

            <div>
              <p className="text-xs text-text-gray uppercase tracking-wider mb-3 font-medium">Company</p>
              <div className="flex flex-col gap-2">
                {FOOTER_LINKS.company.map(({ label, href }) => (
                  <Link key={href} href={href} className="text-sm text-text-gray hover:text-white transition-colors">
                    {label}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs text-text-gray uppercase tracking-wider mb-3 font-medium">Join Us</p>
              <div className="flex flex-col gap-2">
                {FOOTER_LINKS.join.map(({ label, href }) => (
                  <Link key={href} href={href} className="text-sm text-text-gray hover:text-white transition-colors">
                    {label}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs text-text-gray uppercase tracking-wider mb-3 font-medium">Connect</p>
              <div className="flex items-center gap-2.5">
                <a
                  href="mailto:contact@fairsynq.com"
                  aria-label="Email us"
                  className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-neon-pink/20 transition-colors group"
                >
                  <EnvelopeIcon className="w-4 h-4 text-text-gray group-hover:text-neon-pink transition-colors" />
                </a>
                <a
                  href="https://facebook.com/fairsynq"
                  aria-label="Facebook"
                  className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-neon-pink/20 transition-colors group"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FacebookIcon className="w-4 h-4 text-text-gray group-hover:text-neon-pink transition-colors" />
                </a>
              </div>
            </div>

          </div>
        </div>

        {/* Copyright */}
        <div className="mt-12 pt-6 border-t border-white/5 text-center">
          <p className="text-xs text-white/25">
            © {new Date().getFullYear()} FairSynq. All rights reserved.
          </p>
        </div>

      </div>
    </footer>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MarketplaceLanding() {
  const activeFairs = getActiveFairs()
  const allFairs    = mockFairs

  return (
    <>
      <MarketplaceNavbar />
      <div className="bg-bg-dark text-white">

        {/* ── Hero ── */}
        <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden px-5 sm:px-[6%] lg:px-8 pt-16">
          <div className="hero-glow" />

          <div className="relative z-10 text-center max-w-4xl mx-auto w-full">
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: TIMING.fast, ease: EASE.decelerate, delay: 0.1 }}
              className="text-text-gray text-xs sm:text-sm font-semibold uppercase tracking-widest mb-5"
            >
              The multi-fair food marketplace
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE.decelerate, delay: 0.2 }}
              className="font-bebas text-5xl sm:text-6xl md:text-7xl lg:text-[7rem] text-white tracking-wide leading-none mb-6"
            >
              Skip the line.
              <br />
              <span className="text-neon-pink">Order ahead.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE.decelerate, delay: 0.5 }}
              className="text-text-gray text-base sm:text-lg md:text-xl max-w-2xl mx-auto mb-10"
            >
              Browse vendors, order your food in advance, and pick it up at the
              booth — no waiting around.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: TIMING.normal, ease: EASE.bounce, delay: 0.8 }}
              className="flex items-center justify-center gap-3 sm:gap-4 flex-wrap"
            >
              <motion.div
                whileHover={{ scale: 1.05, transition: { duration: 0.2, ease: EASE.smooth } }}
                whileTap={{ scale: 0.97 }}
              >
                <Link
                  href="/fairs"
                  className="inline-flex items-center px-7 sm:px-8 py-3.5 rounded-xl bg-neon-pink text-white font-semibold hover:bg-[#e0006b] shadow-[0_4px_20px_rgba(255,0,119,0.35)] transition-colors"
                >
                  Find a Fair
                </Link>
              </motion.div>
              <motion.div
                whileHover={{ scale: 1.03, transition: { duration: 0.2, ease: EASE.smooth } }}
                whileTap={{ scale: 0.97 }}
              >
                <Link
                  href="/organizer"
                  className="inline-flex items-center px-7 sm:px-8 py-3.5 rounded-xl bg-white/5 border border-white/10 text-white font-semibold hover:bg-white/10 transition-colors"
                >
                  I&apos;m an Organizer
                </Link>
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.4, duration: 0.6 }}
              className="mt-20 flex justify-center"
            >
              <motion.div
                animate={{ y: [0, 8, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                className="w-5 h-8 rounded-full border border-white/20 flex items-start justify-center pt-1.5"
              >
                <div className="w-1 h-2 rounded-full bg-white/40" />
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* ── Active / upcoming fairs ── */}
        <section className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-12 sm:py-20">
          <Reveal className="flex items-center justify-between mb-8 sm:mb-10">
            <h2 className="font-bebas text-3xl sm:text-4xl md:text-5xl text-white tracking-wide">
              {activeFairs.length > 0 ? (
                <>Happening <span className="text-neon-pink">Now</span> &amp; Soon</>
              ) : (
                'Upcoming Fairs'
              )}
            </h2>
            <Link href="/fairs" className="text-neon-pink text-sm font-semibold hover:underline shrink-0 ml-4">
              View all →
            </Link>
          </Reveal>

          <Stagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
            {activeFairs.map((fair) => (
              <StaggerItem key={fair.id}>
                <FairCard fair={fair} />
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* ── Fix 1+6: How It Works — extracted to client component ── */}
        <HowItWorksSection />

        {/* ── Stats — subtle rounded card, no hard divider ── */}
        <section className="py-12 sm:py-16 px-5 sm:px-[6%] lg:px-8">
          <div className="max-w-5xl mx-auto bg-white/[0.03] rounded-2xl">
            <Stagger slow className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-4 py-10 sm:py-12 px-6 sm:px-8">
              {[
                { value: `${allFairs.length}`,                                          label: 'Fairs on platform' },
                { value: `${allFairs.reduce((s, f) => s + f.vendorCount, 0)}+`,        label: 'Vendors served' },
                { value: '~15 min',                                                      label: 'Avg. wait saved' },
                { value: 'Free',                                                          label: 'To join as a vendor' },
              ].map(({ value, label }) => (
                <StaggerItem key={label} className="text-center">
                  <div className="font-bebas text-3xl sm:text-4xl text-neon-pink">{value}</div>
                  <div className="text-text-gray text-xs sm:text-sm mt-1">{label}</div>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        {/* ── CTA with parallax + Fix 4 equal buttons ── */}
        <CTASection />

        {/* ── Fix 5+7: Full footer ── */}
        <SiteFooter />

      </div>
    </>
  )
}
