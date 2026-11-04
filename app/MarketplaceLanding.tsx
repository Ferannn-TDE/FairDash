'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { EnvelopeIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import { Store, CalendarDays, Truck } from 'lucide-react'
import { EASE, TIMING, Reveal, Stagger, StaggerItem } from '@/components/animations/motion'
import MarketplaceNavbar from './_components/MarketplaceNavbar'
import FairCard from './_components/FairCard'
import HowItWorksSection from './_components/HowItWorksSection'
import FAQSection from './_components/FAQSection'
import ContactSection from './_components/ContactSection'
import { FacebookIcon } from '@/components/icons/FacebookIcon'
import { FACEBOOK_URL, contactMailto } from '@/lib/contact-info'
import { partitionFairCards, type PublicFairCard } from '@/lib/fair-view'
import { useUser } from '@clerk/clerk-react'
import { useRole } from './_contexts/RoleContext'

// ── Role cards section ────────────────────────────────────────────────────────

// Operator paths only — the customer is the hero above (browse free, no login
// wall). Mono-pink across the board; each routes to its dedicated login page.
const OPERATOR_CARDS = [
  {
    icon: Store,
    title: 'Become a Vendor',
    desc: 'List your booth, manage your menu, and reach thousands of hungry fairgoers. Free to join.',
    href: '/sign-in/vendor',
    cta: 'Vendor sign-in',
  },
  {
    icon: CalendarDays,
    title: 'Host an Event',
    desc: 'Create fairs, approve vendors, and monitor orders live — run your event end to end.',
    href: '/organizer/login',
    cta: 'Organizer sign-in',
  },
  {
    icon: Truck,
    title: 'Deliver with FairSynq',
    desc: 'Claim deliveries, run orders across the fairgrounds, and earn per drop.',
    href: '/sign-in/runner',
    cta: 'Runner sign-in',
  },
]

function RoleSection() {
  const { isLoaded, isSignedIn } = useUser()
  if (isLoaded && isSignedIn) return null

  // Auth unknown until Clerk loads (and always on the server). Don't guess "signed out" and
  // show the cards to someone who is signed in: render the section invisible so it holds its
  // exact footprint at every width, then reveal it once Clerk says signed out
  // (flicker-class-guard [J]).
  return (
    <section
      aria-hidden={!isLoaded}
      className={`max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-12 sm:py-20${isLoaded ? '' : ' invisible'}`}
    >
      <Reveal className="text-center mb-10">
        <p className="text-[11px] text-neon-pink font-inter font-semibold uppercase tracking-[0.2em] mb-3">
          Work with FairSynq
        </p>
        <h2 className="font-bebas text-3xl sm:text-4xl md:text-5xl text-white tracking-wide">
          Run the <span className="text-neon-pink">other side</span> of the fair
        </h2>
        <p className="mt-3 text-text-gray text-sm sm:text-base max-w-xl mx-auto">
          Vendors, organizers, and runners power FairSynq. Pick your path to sign in.
        </p>
      </Reveal>

      <Stagger className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5 max-w-5xl mx-auto">
        {OPERATOR_CARDS.map(({ icon: Icon, title, desc, href, cta }) => (
          <StaggerItem key={href}>
            <Link
              href={href}
              className="group flex flex-col h-full p-6 bg-white/[0.03] border border-white/[0.08] rounded-2xl hover:border-neon-pink/30 hover:bg-white/[0.05] hover:shadow-[0_8px_32px_rgba(255,0,119,0.12)] motion-safe:hover:-translate-y-0.5 transition-all duration-300 no-underline"
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 shrink-0 bg-neon-pink/10 border border-neon-pink/20">
                <Icon className="w-5 h-5 text-neon-pink" />
              </div>
              <p className="font-bebas text-2xl tracking-wide text-white mb-1.5">{title}</p>
              <p className="text-text-gray text-xs leading-relaxed flex-1">{desc}</p>
              <div className="flex items-center gap-1.5 mt-5 text-xs font-semibold text-neon-pink">
                {cta}
                <ArrowRightIcon className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
              </div>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  )
}

// ── Quick actions for authenticated users ─────────────────────────────────────

const FAIR_SLUG = 'springfield-state-fair-2026'

const QUICK_ACTIONS_BY_ROLE = {
  vendor: [
    { label: 'My Dashboard', href: `/vendor/${FAIR_SLUG}/dashboard` },
    { label: 'Menu Manager', href: `/vendor/${FAIR_SLUG}/menu` },
    { label: 'Analytics',    href: `/vendor/${FAIR_SLUG}/analytics` },
  ],
  organizer: [
    { label: 'My Events',  href: '/organizer' },
    { label: 'All Fairs',  href: '/organizer/fairs' },
    { label: 'Settings',   href: '/organizer/settings' },
  ],
  runner: [
    { label: 'Go Online', href: `/runner/${FAIR_SLUG}/dashboard` },
    { label: 'Earnings',  href: `/runner/${FAIR_SLUG}/earnings` },
    { label: 'Settings',  href: `/runner/${FAIR_SLUG}/settings` },
  ],
  customer: [
    { label: 'Find a Fair', href: '/fairs' },
    { label: 'My Orders',   href: '/account/orders' },
    { label: 'Favorites',   href: '/account/favorites' },
  ],
} as const

function QuickActionsSection() {
  const { isSignedIn, user } = useUser()
  const { isVendor, isOrganizer, isRunner } = useRole()

  if (!isSignedIn) return null

  const firstName = user?.firstName ?? 'there'
  const actions =
    isVendor    ? QUICK_ACTIONS_BY_ROLE.vendor :
    isOrganizer ? QUICK_ACTIONS_BY_ROLE.organizer :
    isRunner    ? QUICK_ACTIONS_BY_ROLE.runner :
    QUICK_ACTIONS_BY_ROLE.customer

  return (
    <section className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 pb-4">
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl px-5 sm:px-7 py-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm">Welcome back, {firstName}</p>
          <p className="text-text-gray text-xs mt-0.5">Jump back in</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              className="inline-flex items-center px-3.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-medium hover:bg-neon-pink/10 hover:border-neon-pink/30 hover:text-neon-pink transition-colors no-underline"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Stats ─────────────────────────────────────────────────────────────────────

// Real results, client-supplied copy (Batch 1 task 1.7). Hard-coded until the Batch 3
// content editor makes it editable. "Nearly" keeps the sales claim exact.
function ProofSection() {
  return (
    <section className="py-16 sm:py-20 px-5">
      <div className="max-w-5xl mx-auto">
        <StatsTiles />
      </div>
    </section>
  )
}

// Three equal tiles and one caption.
const STAT_TILES = [
  { value: '288',  label: 'orders',      prefix: null },
  { value: '$16K', label: 'in sales',    prefix: 'nearly' },
  { value: 'FREE', label: 'for vendors', prefix: null },
]

function StatsTiles() {
  return (
    <div className="bg-white/[0.02] rounded-2xl border border-white/[0.04] px-4 py-8 sm:p-10">
      <Stagger slow className="grid grid-cols-3 divide-x divide-white/[0.08]">
        {STAT_TILES.map(({ value, label, prefix }) => (
          <StaggerItem key={label} className="text-center px-2">
            {/* "nearly" sits above the figure on phones (a 375px tile can't hold both on one
                line) and inline from sm up. The other tiles reserve the same line on phones so
                the three figures stay level. */}
            <p className="sm:hidden h-4 font-inter text-[10px] font-semibold uppercase tracking-wider text-text-gray leading-4">
              {prefix ?? '\u00a0'}
            </p>
            <p className="font-bebas text-4xl sm:text-5xl text-neon-pink tracking-wide leading-none whitespace-nowrap">
              {prefix && (
                <span className="hidden sm:inline font-inter text-xs font-semibold uppercase tracking-wider text-text-gray align-middle mr-1">
                  {prefix}
                </span>
              )}
              {value}
            </p>
            <p className="mt-2 text-xs sm:text-sm text-text-gray font-inter">{label}</p>
          </StaggerItem>
        ))}
      </Stagger>
      <p className="mt-6 text-center text-[11px] sm:text-xs text-text-gray/80 font-inter">
        Over our first two seasons
      </p>
    </div>
  )
}

// ── Final CTA Banner ──────────────────────────────────────────────────────────

function FinalCTABanner() {
  return (
    <section className="relative py-20 sm:py-28 px-5 overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-[#FF0077]/8 blur-[120px] pointer-events-none" />

      {/* Grid texture */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                             linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}
      />

      <Reveal className="relative z-10 max-w-2xl mx-auto text-center">
        <h2 className="font-bebas text-4xl sm:text-5xl lg:text-6xl text-white uppercase leading-tight tracking-wide">
          Ready to Skip<br />
          <span className="text-neon-pink">the Line?</span>
        </h2>
        <p className="mt-4 text-text-gray font-inter text-sm sm:text-base max-w-md mx-auto leading-relaxed">
          Join thousands of fair-goers ordering ahead. No waiting, no hassle — just great food.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <motion.div
            whileHover={{ scale: 1.04, transition: { duration: 0.2, ease: EASE.smooth } }}
            whileTap={{ scale: 0.97 }}
            className="w-full sm:w-auto"
          >
            <Link
              href="/fairs"
              className="flex items-center justify-center w-full px-8 py-3.5 text-sm font-inter font-semibold rounded-xl shadow-[0_4px_20px_rgba(255,0,119,0.3)] btn-primary"
            >
              Browse Fairs Near You
            </Link>
          </motion.div>
        </div>
      </Reveal>
    </section>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────

function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.04] bg-[#0a0a0a]">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-16">

        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-10">

          {/* Left: Brand */}
          <div className="max-w-sm">
            <Link href="/" className="group inline-flex items-center">
              <span className="font-bebas text-2xl tracking-widest text-white transition-colors duration-200 group-hover:text-neon-pink leading-none">FAIR</span>
              <span className="font-bebas text-2xl tracking-widest text-neon-pink transition-colors duration-200 group-hover:text-white leading-none">SYNQ</span>
            </Link>
            <p className="mt-3 text-sm text-text-gray font-inter leading-relaxed">
              The multi-fair food marketplace. Order ahead, skip the line, enjoy the fair.
            </p>
            <div className="mt-5 flex items-center gap-2.5">
              <a
                href={contactMailto()}
                aria-label="Email us"
                className="w-9 h-9 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center hover:bg-neon-pink/10 hover:border-neon-pink/20 transition-all duration-200 group/icon"
              >
                <EnvelopeIcon className="w-4 h-4 text-gray-500 group-hover/icon:text-neon-pink transition-colors" />
              </a>
              <a
                href={FACEBOOK_URL}
                aria-label="Facebook"
                className="w-9 h-9 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center hover:bg-neon-pink/10 hover:border-neon-pink/20 transition-all duration-200 group/icon"
                target="_blank"
                rel="noopener noreferrer"
              >
                <FacebookIcon className="w-4 h-4 text-gray-500 group-hover/icon:text-neon-pink transition-colors" />
              </a>
            </div>
          </div>

          {/* Right: Link columns */}
          <div className="flex gap-12 sm:gap-16">
            <div>
              <p className="text-[10px] font-inter text-gray-600 uppercase tracking-[0.15em] mb-4">Platform</p>
              <div className="flex flex-col gap-2.5">
                <Link href="/fairs" className="text-sm text-text-gray hover:text-white transition-colors font-inter">Discover Fairs</Link>
                <Link href="/sign-in/vendor" className="text-sm text-text-gray hover:text-white transition-colors font-inter">Vendor sign-in</Link>
                <Link href="/organizer/login" className="text-sm text-text-gray hover:text-white transition-colors font-inter">Organizer sign-in</Link>
                <Link href="/sign-in/runner" className="text-sm text-text-gray hover:text-white transition-colors font-inter">Runner sign-in</Link>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-inter text-gray-600 uppercase tracking-[0.15em] mb-4">Company</p>
              <div className="flex flex-col gap-2.5">
                <Link href="/faq" className="text-sm text-text-gray hover:text-white transition-colors font-inter">FAQ</Link>
                <Link href="/contact" className="text-sm text-text-gray hover:text-white transition-colors font-inter">Contact</Link>
                <Link href="/refund-policy" className="text-sm text-text-gray hover:text-white transition-colors font-inter">Refund Policy</Link>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-6 border-t border-white/[0.04] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-[10px] text-gray-700 font-inter">
            © {new Date().getFullYear()} FairSynq. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <p className="text-[10px] text-gray-700 font-inter">Made with 🩷 for fair food lovers.</p>
            {/* Discreet, internal-only admin entry */}
            <Link href="/admin/login" className="text-[10px] text-gray-700 hover:text-gray-400 transition-colors font-inter">
              Admin
            </Link>
          </div>
        </div>

      </div>
    </footer>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MarketplaceLanding({ initialFairs }: { initialFairs: PublicFairCard[] }) {
  // Fairs are fetched on the server and passed in, so the very first paint already
  // has the real list — no client re-fetch, no flash of the empty "Upcoming Fairs"
  // state. Renders once, stable.
  const allFairs    = initialFairs
  // Live and upcoming by DATE — an ACTIVE fair whose run has ended is not "happening".
  const activeFairs = partitionFairCards(allFairs).current

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
              For fairs &amp; festivals
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE.decelerate, delay: 0.2 }}
              className="font-bebas text-5xl sm:text-6xl md:text-7xl lg:text-[7rem] text-white tracking-wide leading-none mb-6"
            >
              Long lines are
              <br />
              <span className="text-neon-pink">lost sales.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE.decelerate, delay: 0.5 }}
              className="text-text-gray text-base sm:text-lg md:text-xl max-w-2xl mx-auto mb-10"
            >
              Mobile ordering and vendor management in one platform. Fairgoers skip
              the line, vendors sell more, and organizers run it all from one dashboard.
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

        {/* ── Active / upcoming fairs, or "Coming in 2027" when there are none ── */}
        <section className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-12 sm:py-20">
          {activeFairs.length > 0 ? (
            <>
              <Reveal className="flex items-center justify-between mb-8 sm:mb-10">
                <h2 className="font-bebas text-3xl sm:text-4xl md:text-5xl text-white tracking-wide">
                  Happening <span className="text-neon-pink">Now</span> &amp; Soon
                </h2>
                <Link href="/fairs" className="text-neon-pink text-sm font-semibold hover:underline shrink-0 ml-4">
                  View all →
                </Link>
              </Reveal>
              <Stagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
                {activeFairs.map((fair) => (
                  <StaggerItem key={fair.id} className="h-full">
                    <FairCard fair={fair} />
                  </StaggerItem>
                ))}
              </Stagger>
            </>
          ) : (
            <Reveal className="max-w-2xl mx-auto text-center bg-white/[0.03] border border-white/[0.08] rounded-2xl px-6 py-10 sm:py-12">
              <h2 className="font-bebas text-3xl sm:text-4xl md:text-5xl text-white tracking-wide">
                Coming in <span className="text-neon-pink">2027</span>
              </h2>
              <p className="mt-3 text-text-gray text-sm sm:text-base leading-relaxed">
                Coming to fairs and festivals in 2027. Events announced soon. Vendors, organizers
                and partner organizations can sign up now.
              </p>
            </Reveal>
          )}
        </section>

        {/* ── Role cards — how will you FairSynq? ── */}
        <RoleSection />

        {/* ── How It Works ── */}
        <HowItWorksSection />

        {/* ── Stats ── */}
        <ProofSection />

        {/* ── FAQ ── */}
        <FAQSection />

        {/* ── Contact — same "need help?" family as the FAQ, so it sits with it ── */}
        <ContactSection />

        {/* ── Final CTA ── */}
        <FinalCTABanner />

        {/* ── Footer ── */}
        <SiteFooter />

      </div>
    </>
  )
}
