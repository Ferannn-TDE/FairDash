'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import {
  MapPinIcon,
  ClockIcon,
  CalendarIcon,
  TicketIcon,
  ChevronRightIcon,
  StarIcon,
} from '@heroicons/react/24/outline'

import { SignedIn } from '@clerk/clerk-react'
import { useFair } from '../../_contexts/FairContext'
import FoodCard from '@/components/ui/FoodCard'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatCountdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'Starting soon'
  const days = Math.floor(diff / 86_400_000)
  if (days > 0) return `Opens in ${days} day${days !== 1 ? 's' : ''}`
  const hours = Math.floor(diff / 3_600_000)
  return `Opens in ${hours}h`
}

// ── FairComingSoon ────────────────────────────────────────────────────────────

function FairComingSoon({ accentColor, gradientFrom, gradientTo }: {
  accentColor: string
  gradientFrom: string
  gradientTo: string
}) {
  const { fair, vendors } = useFair()

  return (
    <div className="text-white">
      {/* Hero */}
      <div
        className="relative h-64 sm:h-80 flex items-end overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${gradientFrom}cc, ${gradientTo}cc), #0f0f0f` }}
      >
        {/* Glow orb */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 60% 40%, ${gradientFrom}30 0%, transparent 65%)`,
          }}
        />
        <div className="absolute inset-0 bg-black/40" />

        <div className="relative max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 pb-8 w-full">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-500/15 text-sky-400 text-[0.65rem] font-semibold uppercase tracking-wider mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
            Upcoming
          </span>
          <h1 className="font-bebas text-4xl sm:text-5xl md:text-6xl tracking-wide leading-none">
            {fair.name}
          </h1>
          {fair.tagline && (
            <p className="text-white/70 text-base sm:text-lg mt-1">{fair.tagline}</p>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-8 sm:py-12">
        <div className="max-w-2xl">
          {/* Countdown pill */}
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold mb-8"
            style={{ background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}30` }}
          >
            <ClockIcon className="w-4 h-4" />
            {formatCountdown(fair.dates.startDate)}
          </div>

          {/* Info cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
            {[
              { icon: CalendarIcon, label: 'Start Date', value: formatDate(fair.dates.startDate) },
              { icon: ClockIcon, label: 'Hours', value: `${fair.operatingHours.open} – ${fair.operatingHours.close}` },
              { icon: MapPinIcon, label: 'Location', value: fair.location.address },
              { icon: TicketIcon, label: 'Admission', value: fair.admissionFree ? 'Free entry' : 'Paid entry' },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="bg-bg-card border border-white/10 rounded-2xl p-4 flex gap-3">
                <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: accentColor }} />
                <div>
                  <p className="text-[0.6rem] uppercase tracking-widest text-text-gray font-semibold mb-0.5">{label}</p>
                  <p className="text-white text-sm">{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Description */}
          {fair.description && (
            <p className="text-text-gray text-sm leading-relaxed mb-8">{fair.description}</p>
          )}

          {/* Vendor count teaser */}
          {vendors.length > 0 && (
            <div className="bg-bg-card border border-white/10 rounded-2xl p-5">
              <p className="text-text-gray text-sm">
                <span className="text-white font-semibold">{vendors.length} vendor{vendors.length !== 1 ? 's' : ''}</span>{' '}
                are confirmed for this fair. Check back closer to the date to browse menus and place your order.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── FairEnded ─────────────────────────────────────────────────────────────────

function FairEnded({ accentColor, gradientFrom, gradientTo }: {
  accentColor: string
  gradientFrom: string
  gradientTo: string
}) {
  const { fair } = useFair()

  return (
    <div className="text-white">
      {/* Hero — desaturated tint */}
      <div
        className="relative h-56 sm:h-72 flex items-end overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${gradientFrom}55, ${gradientTo}55), #0f0f0f` }}
      >
        <div className="absolute inset-0 bg-black/60" />
        <div className="relative max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 pb-8 w-full">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/8 text-white/50 text-[0.65rem] font-semibold uppercase tracking-wider mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-white/40" />
            Event Ended
          </span>
          <h1 className="font-bebas text-4xl sm:text-5xl md:text-6xl tracking-wide leading-none text-white/60">
            {fair.name}
          </h1>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-12 sm:py-16 text-center">
        <p className="text-text-gray text-sm mb-2">This fair ended on</p>
        <p className="text-white font-semibold text-lg mb-8">{formatDate(fair.dates.endDate)}</p>
        <Link
          href="/fairs"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white transition-opacity hover:opacity-80"
          style={{ background: accentColor }}
        >
          Browse Other Fairs
          <ChevronRightIcon className="w-4 h-4" />
        </Link>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FairHomePage() {
  const { fair, vendors } = useFair()

  const accentColor  = fair.branding?.accentColor  ?? '#FF0077'
  const gradientFrom = fair.branding?.gradientFrom ?? '#FF0077'
  const gradientTo   = fair.branding?.gradientTo   ?? '#7C3AED'

  // Featured vendors — use admin-configured IDs, fall back to first 4 alphabetically
  const displayFeatured = useMemo(() => {
    const ids = fair.featuredVendorIds
    if (ids && ids.length > 0) {
      const pinned = ids.map(id => vendors.find(v => v.id === id)).filter(Boolean) as typeof vendors
      if (pinned.length > 0) return pinned
    }
    return [...vendors].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 4)
  }, [vendors, fair.featuredVendorIds])

  const featuredLabel = fair.featuredLabel ?? 'Featured Today'
  const featuredParts = featuredLabel.split(' ')
  const featuredFirst = featuredParts[0]
  const featuredRest  = featuredParts.slice(1).join(' ')

  // Delegate to status-specific views
  if (fair.status === 'upcoming') {
    return <FairComingSoon accentColor={accentColor} gradientFrom={gradientFrom} gradientTo={gradientTo} />
  }
  if (fair.status === 'completed') {
    return <FairEnded accentColor={accentColor} gradientFrom={gradientFrom} gradientTo={gradientTo} />
  }

  // ── Active fair ──────────────────────────────────────────────────────────────
  return (
    <div className="text-white">

      {/* ── Immersive hero banner ── */}
      <div
        className="relative h-[260px] sm:h-[340px] md:h-[400px] flex items-end overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${gradientFrom}, ${gradientTo})` }}
      >
        {/* Layered glows */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 70% 30%, ${gradientFrom}50 0%, transparent 60%)` }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 20% 80%, ${gradientTo}40 0%, transparent 55%)` }}
        />
        {/* Dark gradient bottom */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />

        {/* Fair info overlay */}
        <div className="relative z-10 max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 pb-7 sm:pb-10 w-full">
          {/* Live badge */}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 text-[0.65rem] font-semibold uppercase tracking-wider mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Live Now
          </span>

          <h1 className="font-bebas text-4xl sm:text-5xl md:text-[3.75rem] tracking-wide leading-none mb-1">
            {fair.name}
          </h1>
          {fair.tagline && (
            <p className="text-white/75 text-sm sm:text-base mb-4">{fair.tagline}</p>
          )}

          {/* Meta pills */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-white/70 text-xs">
            <span className="flex items-center gap-1">
              <MapPinIcon className="w-3.5 h-3.5 shrink-0" />
              {fair.location.city}
            </span>
            <span className="flex items-center gap-1">
              <ClockIcon className="w-3.5 h-3.5 shrink-0" />
              {fair.operatingHours.open} – {fair.operatingHours.close}
            </span>
            <span className="flex items-center gap-1">
              <TicketIcon className="w-3.5 h-3.5 shrink-0" />
              {fair.admissionFree ? 'Free entry' : 'Paid entry'}
            </span>
            <span className="flex items-center gap-1">
              <StarIcon className="w-3.5 h-3.5 shrink-0" />
              {vendors.length} vendor{vendors.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* ── Quick action bar ── */}
      <div className="bg-bg-dark/90 backdrop-blur-sm sticky top-14 sm:top-16 z-30">
        <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8">
          <div className="flex items-center gap-3 py-3 overflow-x-auto scrollbar-none">
            <Link
              href={`/fair/${fair.slug}/vendors`}
              className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white active:scale-[0.97] transition-all duration-200 hover:opacity-85"
              style={{ background: accentColor, boxShadow: `0 2px 12px ${accentColor}40` }}
            >
              Browse Vendors
              <ChevronRightIcon className="w-3.5 h-3.5" />
            </Link>
            <Link
              href={`/fair/${fair.slug}/info`}
              className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold btn-secondary"
            >
              <MapPinIcon className="w-3.5 h-3.5" />
              Fair Info
            </Link>
            <SignedIn>
              <Link
                href={`/fair/${fair.slug}/orders`}
                className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold btn-secondary"
              >
                My Orders
              </Link>
            </SignedIn>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 sm:py-10">

        {/* Featured Today */}
        {fair.featuredEnabled !== false && displayFeatured.length > 0 && (
          <section className="mb-10 sm:mb-14">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-bebas text-2xl sm:text-3xl text-white tracking-wide leading-none">
                  {featuredFirst}{featuredRest && <> <span style={{ color: accentColor }}>{featuredRest}</span></>}
                </h2>
                <p className="text-xs text-text-gray font-inter mt-1">
                  Hand-picked vendors at {fair.name}
                </p>
              </div>
              <Link
                href={`/fair/${fair.slug}/vendors`}
                className="text-xs font-inter hover:text-white transition-colors shrink-0"
                style={{ color: accentColor }}
              >
                See all {vendors.length} →
              </Link>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {displayFeatured.map(v => (
                <FoodCard
                  key={v.id}
                  variant="vendor"
                  href={`/fair/${fair.slug}/vendor/${v.slug}`}
                  name={v.name}
                  description={v.description}
                  cuisineType={v.cuisineType}
                  boothNumber={v.boothNumber}
                  logoUrl={v.logoUrl}
                  itemCount={v._count?.menuItems ?? 0}
                  isBusy={v.isBusy}
                  accentColor={accentColor}
                  featuredTag={v.featuredReason}
                />
              ))}
            </div>
          </section>
        )}

        {/* About */}
        {fair.description && (
          <div className="bg-bg-card border border-white/10 rounded-2xl p-5 sm:p-6">
            <h2 className="font-bebas text-xl text-white tracking-wide mb-2">About This Fair</h2>
            <p className="text-text-gray text-sm leading-relaxed">{fair.description}</p>
          </div>
        )}

      </div>
    </div>
  )
}
