'use client'

// THE fair card — the only place a public fair card is drawn (landing page and /fairs).
// Uniform by construction: the card fills its grid cell (h-full) as a flex column, the
// banner has a fixed aspect ratio, the name is one line, the description always reserves
// two lines (clamped, or blank), and the CTA is pinned to the bottom with mt-auto. Status,
// CTA and badge come from fairCardState (dates, not the admin flag), so an ended fair can
// never say "Order now". scripts/fair-card-guard.ts pins all of this.

import Link from 'next/link'
import { motion } from 'framer-motion'
import { MapPinIcon, CalendarIcon, UsersIcon } from '@heroicons/react/24/outline'
import { EASE } from '@/components/animations/motion'
import { fairCardState, vendorCountLabel, FAIR_CARD_BADGE, type PublicFairCard } from '@/lib/fair-view'
import { formatEventDateRange } from '@/lib/event-date'

interface FairCardProps {
  fair: PublicFairCard
}

export default function FairCard({ fair }: FairCardProps) {
  const gradientFrom = fair.primaryColor || '#FF0077'
  const gradientTo   = '#7C3AED'
  const hasLocation  = !!(fair.city && fair.state)
  const state        = fairCardState(fair)
  const badge        = FAIR_CARD_BADGE[state]
  const cta          = state === 'live' ? 'Order now →' : 'View fair →'

  return (
    <motion.div
      className="h-full"
      whileHover={{ scale: 1.02, transition: { duration: 0.2, ease: EASE.smooth } }}
      whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
    >
      <Link
        href={`/fair/${fair.slug}`}
        data-fair-card={state}
        className="h-full flex flex-col bg-bg-card border border-white/10 rounded-2xl overflow-hidden
                   hover:border-[#FF0077]/30 hover:shadow-[0_0_30px_rgba(255,0,119,0.1)]
                   transition-[border-color,box-shadow] duration-300"
      >
        {/* Banner — fixed aspect ratio, same on every card */}
        <div
          className="aspect-[3/1] w-full shrink-0 relative flex items-end p-4"
          style={{ background: `linear-gradient(135deg, ${gradientFrom}, ${gradientTo})` }}
        >
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.6875rem] font-semibold uppercase tracking-wide border border-white/15 shadow-lg"
            style={{ color: badge.fg, backgroundColor: badge.bg }}
          >
            {state === 'live' && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: badge.fg }} />}
            {badge.label}
          </span>
        </div>

        {/* Body — flex column so the CTA can sit at the bottom */}
        <div className="flex-1 flex flex-col p-5">
          <h3 className="font-bebas text-xl text-white tracking-wide leading-tight truncate" title={fair.name}>
            {fair.name}
          </h3>
          {/* Always two lines tall: clamped text, or reserved blank space */}
          <p className="mt-1 text-text-gray text-sm leading-5 h-10 line-clamp-2" data-fair-desc>
            {fair.tagline ?? ''}
          </p>

          <div className="mt-4 space-y-2">
            {hasLocation && (
              <div className="flex items-center gap-2 text-text-gray text-sm">
                <MapPinIcon className="w-4 h-4 shrink-0" />
                <span>{fair.city}, {fair.state}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-text-gray text-sm">
              <CalendarIcon className="w-4 h-4 shrink-0" />
              <span>{formatEventDateRange(fair.startDate, fair.endDate)}</span>
            </div>
            <div className="flex items-center gap-2 text-text-gray text-sm">
              <UsersIcon className="w-4 h-4 shrink-0" />
              <span>{vendorCountLabel(fair.vendorCount)}</span>
            </div>
          </div>

          <div className="mt-auto pt-4">
            <div className="mt-1 pt-4 border-t border-white/10">
              <span className="text-sm font-semibold text-neon-pink">{cta}</span>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}
