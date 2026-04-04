'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { MapPinIcon, CalendarIcon, UsersIcon } from '@heroicons/react/24/outline'
import StatusBadge from './StatusBadge'
import { EASE } from '@/components/animations/motion'
import type { Fair } from '@/lib/mock'

function formatDateRange(startDate: string, endDate: string) {
  const start = new Date(startDate)
  const end   = new Date(endDate)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const startStr = start.toLocaleDateString('en-US', opts)
  const endStr   = end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })
  return `${startStr} – ${endStr}`
}

interface FairCardProps {
  fair: Fair
}

export default function FairCard({ fair }: FairCardProps) {
  const gradientFrom = fair.branding?.gradientFrom ?? '#FF0077'
  const gradientTo   = fair.branding?.gradientTo   ?? '#7C3AED'
  const isClickable  = fair.status !== 'archived'

  const cardInner = (
    <>
      {/* Gradient banner */}
      <div
        className="h-32 w-full relative flex items-end p-4"
        style={{ background: `linear-gradient(135deg, ${gradientFrom}, ${gradientTo})` }}
      >
        <StatusBadge status={fair.status} className="shadow-lg" />
        {fair.admissionFree && (
          <span className="ml-auto text-[0.6875rem] font-semibold bg-black/30 backdrop-blur-sm text-white px-2.5 py-1 rounded-full">
            Free entry
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-5">
        <h3 className="font-bebas text-xl text-white tracking-wide leading-tight mb-0.5">
          {fair.name}
        </h3>
        {fair.tagline && (
          <p className="text-text-gray text-sm line-clamp-1">{fair.tagline}</p>
        )}

        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-text-gray text-sm">
            <MapPinIcon className="w-4 h-4 shrink-0" />
            <span>{fair.location.city}, {fair.location.state}</span>
          </div>
          <div className="flex items-center gap-2 text-text-gray text-sm">
            <CalendarIcon className="w-4 h-4 shrink-0" />
            <span>{formatDateRange(fair.dates.startDate, fair.dates.endDate)}</span>
          </div>
          <div className="flex items-center gap-2 text-text-gray text-sm">
            <UsersIcon className="w-4 h-4 shrink-0" />
            <span>{fair.vendorCount} vendors</span>
          </div>
        </div>

        {isClickable && (
          <div className="mt-5 pt-4 border-t border-white/10">
            <span className="text-sm font-semibold" style={{ color: gradientFrom }}>
              {fair.status === 'active' ? 'Order now →' : 'View details →'}
            </span>
          </div>
        )}
      </div>
    </>
  )

  if (!isClickable) {
    return (
      <div className="opacity-50 cursor-default bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
        {cardInner}
      </div>
    )
  }

  return (
    <motion.div
      whileHover={{
        scale: 1.02,
        transition: { duration: 0.2, ease: EASE.smooth },
      }}
      whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
    >
      <Link
        href={`/fair/${fair.slug}`}
        className="block bg-bg-card border border-white/10 rounded-2xl overflow-hidden
                   hover:border-[#FF0077]/30 hover:shadow-[0_0_30px_rgba(255,0,119,0.1)]
                   transition-[border-color,box-shadow] duration-300"
      >
        {cardInner}
      </Link>
    </motion.div>
  )
}
