'use client'

import Link from 'next/link'
import { StarIcon } from '@heroicons/react/24/solid'
import { ClockIcon } from '@heroicons/react/24/outline'
import { useFair } from '../../../_contexts/FairContext'
import type { MockVendor } from '@/lib/mock'

function VendorCard({ vendor, fairSlug, accentColor }: { vendor: MockVendor; fairSlug: string; accentColor: string }) {
  const popularItems = vendor.menu.filter((m) => m.popular && m.available).slice(0, 2)

  return (
    <Link
      href={`/fair/${fairSlug}/vendor/${vendor.slug}`}
      className="group bg-bg-card border border-white/10 rounded-2xl p-4 sm:p-5 hover:border-white/20 hover:-translate-y-0.5 transition-all duration-300"
    >
      {/* Header */}
      <div className="flex items-start gap-3 sm:gap-4 mb-4">
        <div
          className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center shrink-0 font-bebas text-xl sm:text-2xl text-white"
          style={{ background: `${accentColor}22`, border: `1px solid ${accentColor}44` }}
        >
          {vendor.name.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-white text-sm sm:text-base group-hover:text-neon-pink transition-colors truncate">
            {vendor.name}
          </h3>
          <p className="text-text-gray text-xs sm:text-sm">{vendor.cuisineType} · Booth {vendor.boothNumber}</p>
          <div className="flex items-center gap-2 sm:gap-3 mt-1 flex-wrap">
            {vendor.rating && (
              <span className="flex items-center gap-1 text-yellow-400 text-xs font-semibold">
                <StarIcon className="w-3 h-3" /> {vendor.rating.toFixed(1)}
                <span className="text-text-gray font-normal">({vendor.reviewCount})</span>
              </span>
            )}
            {vendor.prepTimeMin && (
              <span className="flex items-center gap-1 text-text-gray text-xs">
                <ClockIcon className="w-3 h-3" /> {vendor.prepTimeMin} min avg
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Popular items preview */}
      {popularItems.length > 0 && (
        <div className="space-y-1.5">
          {popularItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-sm">
              <span className="text-text-gray text-xs sm:text-sm truncate">{item.name}</span>
              <span className="text-white font-medium ml-2 shrink-0 text-xs sm:text-sm tabular-nums">
                ${item.price.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Link>
  )
}

export default function FairVendorsPage() {
  const { fair, vendors } = useFair()
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  return (
    // Fix 5: px-5 minimum on mobile
    <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 sm:py-10 text-white">
      <div className="mb-6 sm:mb-8">
        <h1 className="font-bebas text-3xl sm:text-4xl text-white tracking-wide">Vendors</h1>
        <p className="text-text-gray text-sm mt-1">
          {vendors.length} vendor{vendors.length !== 1 ? 's' : ''} at {fair.name}
        </p>
      </div>

      {vendors.length === 0 ? (
        <div className="bg-bg-card border border-white/10 rounded-2xl p-12 text-center">
          <p className="text-text-gray">No vendors yet — check back soon.</p>
        </div>
      ) : (
        // Fix 5: gap-4 on mobile, gap-5 on desktop
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {vendors.map((vendor) => (
            <VendorCard key={vendor.id} vendor={vendor} fairSlug={fair.slug} accentColor={accentColor} />
          ))}
        </div>
      )}
    </div>
  )
}
