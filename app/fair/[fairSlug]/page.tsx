'use client'

import Link from 'next/link'
import { MapPinIcon, ClockIcon, CalendarIcon, TicketIcon } from '@heroicons/react/24/outline'
import { useFair } from '../../_contexts/FairContext'
import StatusBadge from '../../_components/StatusBadge'
import FairCard from '../../_components/FairCard'
import { mockFairs } from '@/lib/mock'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export default function FairHomePage() {
  const { fair, vendors } = useFair()
  const accentColor = fair.branding?.accentColor ?? '#FF0077'
  const gradientFrom = fair.branding?.gradientFrom ?? '#FF0077'
  const gradientTo   = fair.branding?.gradientTo   ?? '#7C3AED'

  const otherFairs = mockFairs.filter((f) => f.id !== fair.id && (f.status === 'active' || f.status === 'upcoming'))

  return (
    <div className="text-white">
      {/* Hero banner */}
      <div
        className="relative h-56 sm:h-72 flex items-end"
        style={{ background: `linear-gradient(135deg, ${gradientFrom}, ${gradientTo})` }}
      >
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 pb-8 w-full">
          <StatusBadge status={fair.status} className="mb-3" />
          <h1 className="font-bebas text-4xl sm:text-5xl md:text-6xl tracking-wide leading-none">
            {fair.name}
          </h1>
          {fair.tagline && (
            <p className="text-white/80 text-lg mt-1">{fair.tagline}</p>
          )}
        </div>
      </div>

      {/* Details + CTA */}
      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 sm:py-8">
        <div className="flex flex-col lg:flex-row gap-6 sm:gap-8">

          {/* Left: details */}
          <div className="flex-1">
            {/* Quick info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              {[
                { icon: MapPinIcon, label: 'Location', value: fair.location.address },
                { icon: CalendarIcon, label: 'Dates', value: `${formatDate(fair.dates.startDate)} – ${formatDate(fair.dates.endDate)}` },
                { icon: ClockIcon, label: 'Hours', value: `${fair.operatingHours.open} – ${fair.operatingHours.close}` },
                { icon: TicketIcon, label: 'Admission', value: fair.admissionFree ? 'Free' : 'Paid entry' },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="bg-bg-card border border-white/10 rounded-2xl p-4 flex gap-3">
                  <Icon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: accentColor }} />
                  <div>
                    <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">{label}</p>
                    <p className="text-white text-sm">{value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Description */}
            {fair.description && (
              <div className="bg-bg-card border border-white/10 rounded-2xl p-5 mb-8">
                <h2 className="font-semibold text-white mb-2">About</h2>
                <p className="text-text-gray text-sm leading-relaxed">{fair.description}</p>
              </div>
            )}

            {/* Vendor preview */}
            {vendors.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bebas text-2xl text-white tracking-wide">Vendors</h2>
                  <Link
                    href={`/fair/${fair.slug}/vendors`}
                    className="text-sm font-semibold hover:underline"
                    style={{ color: accentColor }}
                  >
                    View all {vendors.length} →
                  </Link>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {vendors.slice(0, 4).map((v) => (
                    <Link
                      key={v.id}
                      href={`/fair/${fair.slug}/vendor/${v.slug}`}
                      className="bg-bg-card border border-white/10 rounded-2xl p-4 flex items-center gap-4 hover:border-white/20 hover:-translate-y-0.5 transition-all duration-200"
                    >
                      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center shrink-0 text-xl font-bold" style={{ color: accentColor }}>
                        {v.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-white font-semibold truncate">{v.name}</p>
                        <p className="text-text-gray text-sm truncate">{v.cuisineType} · Booth {v.boothNumber}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: order CTA card */}
          <div className="lg:w-80 shrink-0">
            <div className="bg-bg-card border border-white/10 rounded-2xl p-6 sticky top-20">
              <h2 className="font-bebas text-2xl text-white tracking-wide mb-1">Ready to order?</h2>
              <p className="text-text-gray text-sm mb-6">
                Browse {vendors.length} vendor{vendors.length !== 1 ? 's' : ''} and skip the line.
              </p>
              <Link
                href={`/fair/${fair.slug}/vendors`}
                className="block w-full text-center py-3 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: `linear-gradient(135deg, ${gradientFrom}, ${gradientTo})`, boxShadow: `0 4px 20px ${gradientFrom}40` }}
              >
                Browse Vendors
              </Link>
              <Link
                href={`/fair/${fair.slug}/orders`}
                className="block w-full text-center py-3 mt-3 rounded-xl font-semibold bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors"
              >
                My Orders
              </Link>
            </div>
          </div>
        </div>

        {/* Other fairs */}
        {otherFairs.length > 0 && (
          <div className="mt-16">
            <h2 className="font-bebas text-2xl text-white tracking-wide mb-6">Other Fairs You May Like</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {otherFairs.slice(0, 3).map((f) => (
                <FairCard key={f.id} fair={f} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
