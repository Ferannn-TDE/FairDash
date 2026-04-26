'use client'

import { useState, useMemo } from 'react'
import { MagnifyingGlassIcon, BuildingStorefrontIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useFair } from '../../../_contexts/FairContext'
import type { VendorData } from '../../../_contexts/FairContext'
import Breadcrumb from '../_components/Breadcrumb'
import FoodCard from '@/components/ui/FoodCard'

// ── Skeleton ──────────────────────────────────────────────────────────────────

function VendorCardSkeleton() {
  return (
    <div className="bg-bg-card rounded-xl md:rounded-2xl border border-white/5 overflow-hidden animate-pulse flex flex-col">
      <div className="aspect-square bg-white/5" />
      <div className="p-3 md:p-5 space-y-2">
        <div className="h-5 bg-white/10 rounded w-3/4" />
        <div className="h-3 bg-white/5 rounded w-full" />
        <div className="h-3 bg-white/5 rounded w-1/2" />
        <div className="h-8 bg-white/5 rounded-lg mt-3" />
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function FairVendorsPage() {
  const { fair, vendors, vendorsLoading } = useFair()
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedVendorId, setSelectedVendorId] = useState<string>('all')
  const [showFilters, setShowFilters] = useState(false)

  const isSearching = searchQuery.trim().length > 0
  const clearSearch = () => setSearchQuery('')

  const filtered = useMemo(() => {
    if (isSearching) {
      const q = searchQuery.toLowerCase()
      return vendors.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          (v.description ?? '').toLowerCase().includes(q) ||
          v.cuisineType.toLowerCase().includes(q),
      )
    }
    if (selectedVendorId !== 'all') {
      return vendors.filter((v) => v.id === selectedVendorId)
    }
    return vendors
  }, [vendors, selectedVendorId, searchQuery, isSearching])

  return (
    <div className="min-h-screen text-white">
      {/* Header with search */}
      <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-10 border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8">
          <div className="mb-2"><Breadcrumb crumbs={[{ label: 'Vendors' }]} /></div>
          <h1 className="font-bebas text-[clamp(2rem,6vw,3.5rem)] text-center mb-2 tracking-[0.125rem]">
            <span style={{ color: accentColor }}>{fair.name || '…'}</span> Vendors
          </h1>
          <p className="text-center text-text-gray text-sm sm:text-base mb-8">
            Browse all vendors and discover their menus
          </p>

          <div className="max-w-[37.5rem] mx-auto relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-5 top-1/2 -translate-y-1/2 text-text-gray pointer-events-none" />
            <input
              type="text"
              placeholder="Search vendors…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full py-4 px-5 pl-12 pr-12 bg-bg-dark border border-white/10 rounded-full text-white text-sm outline-none transition-all duration-200 placeholder:text-text-gray hover:border-white/20 focus:border-neon-pink"
            />
            {isSearching && (
              <button
                onClick={clearSearch}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-text-gray hover:text-white transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8">
        {/* Vendor filter pills */}
        {!isSearching && !vendorsLoading && (
          <div className="py-5 border-b border-white/5">
            <button
              className="flex items-center justify-between w-full mb-4 bg-transparent border-0 cursor-pointer p-0 sm:cursor-default"
              onClick={() => setShowFilters((v) => !v)}
            >
              <div className="flex items-center gap-2.5 text-text-gray text-xs uppercase tracking-wide font-semibold">
                <BuildingStorefrontIcon className="w-4 h-4" />
                <span>Filter by Vendor</span>
              </div>
              <span className="sm:hidden text-text-gray text-xs">{showFilters ? '▲' : '▼'}</span>
            </button>

            <div className={`sm:flex gap-2 flex-wrap ${showFilters ? 'flex' : 'hidden sm:flex'}`}>
              <button
                className={`px-4 py-2 text-xs border rounded-full font-medium cursor-pointer transition-all duration-200 ${selectedVendorId === 'all' ? 'bg-neon-pink border-neon-pink text-white shadow-glow' : 'bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20'}`}
                onClick={() => { setSelectedVendorId('all'); setShowFilters(false) }}
              >
                <BuildingStorefrontIcon className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                All Vendors
              </button>
              {vendors.map((vendor) => (
                <button
                  key={vendor.id}
                  className={`px-4 py-2 text-xs border rounded-full font-medium cursor-pointer transition-all duration-200 ${selectedVendorId === vendor.id ? 'bg-neon-pink border-neon-pink text-white shadow-glow' : 'bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20'}`}
                  onClick={() => { setSelectedVendorId(vendor.id); setShowFilters(false) }}
                >
                  🍽️ {vendor.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results header */}
        <div className="flex items-center justify-between py-5 pb-4">
          <h2 className="font-bebas text-xl sm:text-2xl tracking-wide">
            {isSearching
              ? `Results for "${searchQuery}"`
              : selectedVendorId === 'all'
              ? 'All Vendors'
              : vendors.find((v) => v.id === selectedVendorId)?.name ?? 'Vendors'}
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-text-gray text-sm">
              {vendorsLoading ? '…' : `${filtered.length} ${filtered.length === 1 ? 'vendor' : 'vendors'}`}
            </span>
            {isSearching && (
              <button onClick={clearSearch} className="text-neon-pink text-sm font-semibold hover:opacity-80 transition-opacity">
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="pb-16">
          {vendorsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 sm:gap-5">
              {Array.from({ length: 6 }).map((_, i) => <VendorCardSkeleton key={i} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 px-5">
              <div className="text-[6rem] mb-5 opacity-30">🔍</div>
              <h3 className="font-bebas text-3xl mb-2 tracking-wide">No vendors found</h3>
              <p className="text-text-gray">
                {isSearching ? `No results for "${searchQuery}"` : 'Check back soon'}
              </p>
              {isSearching && (
                <button
                  onClick={clearSearch}
                  className="mt-6 px-6 py-3 bg-neon-pink text-white rounded-xl font-bold text-sm hover:opacity-90 transition-opacity"
                >
                  Clear Search
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 sm:gap-5">
              {filtered.map((vendor) => (
                <FoodCard
                  key={vendor.id}
                  variant="vendor"
                  href={`/fair/${fair.slug}/vendor/${vendor.slug}`}
                  name={vendor.name}
                  description={vendor.description}
                  cuisineType={vendor.cuisineType}
                  boothNumber={vendor.boothNumber}
                  logoUrl={vendor.logoUrl}
                  itemCount={vendor._count?.menuItems ?? 0}
                  isBusy={vendor.isBusy}
                  accentColor={accentColor}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
