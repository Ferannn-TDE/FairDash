'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import {
  MagnifyingGlassIcon,
  BuildingStorefrontIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { useFair } from '../../../_contexts/FairContext'
import type { GroupedMenuItem } from '@/lib/menu/getGroupedMenuItems'
import { GroupedFoodCard } from '@/components/menu/GroupedFoodCard'

// ─── Types ────────────────────────────────────────────────────────────────────

interface VendorOption {
  id: string
  name: string
}

// ── Skeletons ─────────────────────────────────────────────────────────────────

function FoodCardSkeleton() {
  return (
    <div className="bg-bg-card border border-white/5 rounded-xl overflow-hidden animate-pulse">
      <div className="aspect-[4/3] bg-white/5" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-white/10 rounded w-3/4" />
        <div className="h-3 bg-white/5 rounded w-1/2" />
        <div className="h-3 bg-white/5 rounded w-full" />
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

// Cart version — bump this when the cart schema or ID format changes to bust stale caches
const CART_VERSION = 'v2-real-ids'

export default function FairMenuPage() {
  const params = useParams<{ fairSlug: string }>()
  const { fair, vendors } = useFair()
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  const [allGrouped, setAllGrouped] = useState<GroupedMenuItem[]>([])
  const [loading, setLoading] = useState(true)

  // Bust stale localStorage carts with mock IDs
  useEffect(() => {
    const versionKey = `fairsynq-cart-version-${params.fairSlug}`
    if (localStorage.getItem(versionKey) !== CART_VERSION) {
      localStorage.removeItem(`fairsynq-cart-${params.fairSlug}`)
      localStorage.setItem(versionKey, CART_VERSION)
    }
  }, [params.fairSlug])

  // Fetch pre-grouped menu items from the server
  useEffect(() => {
    setLoading(true)
    fetch(`/api/menu?eventSlug=${params.fairSlug}&limit=200`)
      .then(r => r.json())
      .then(json => { if (json?.data) setAllGrouped(json.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [params.fairSlug])

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedVendorId, setSelectedVendorId] = useState<string>('all')
  const [showFilters, setShowFilters] = useState(false)

  const isSearching = searchQuery.trim().length > 0
  const clearSearch = () => setSearchQuery('')

  // Vendor pills derived from grouped items
  const vendorOptions = useMemo<VendorOption[]>(() => {
    const seen = new Set<string>()
    const opts: VendorOption[] = []
    allGrouped.forEach((g) => {
      if (!seen.has(g.vendorId)) {
        seen.add(g.vendorId)
        opts.push({ id: g.vendorId, name: g.vendorName })
      }
    })
    return opts
  }, [allGrouped])

  // Filter pre-grouped items — no re-grouping needed
  const groupedItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allGrouped.filter((g) => {
      if (selectedVendorId !== 'all' && g.vendorId !== selectedVendorId) return false
      if (q) return (
        g.baseName.toLowerCase().includes(q) ||
        (g.description ?? '').toLowerCase().includes(q) ||
        g.vendorName.toLowerCase().includes(q)
      )
      return true
    })
  }, [allGrouped, selectedVendorId, searchQuery])

  const activeVendorName = vendorOptions.find((v) => v.id === selectedVendorId)?.name

  return (
    <div className="min-h-screen text-white">
      {/* Header with search */}
      <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-10 border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8">
          <h1 className="font-bebas text-[clamp(2rem,6vw,3.5rem)] text-center mb-2 tracking-[0.125rem]">
            <span style={{ color: accentColor }}>{fair.name || '…'}</span> Menu
          </h1>
          <p className="text-center text-text-gray text-sm sm:text-base mb-8">
            All your favorite fair foods in one place
          </p>

          <div className="max-w-[37.5rem] mx-auto relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-5 top-1/2 -translate-y-1/2 text-text-gray pointer-events-none" />
            <input
              type="text"
              placeholder="Search for foods…"
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
        {!isSearching && !loading && vendorOptions.length > 1 && (
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
                All Vendors
              </button>
              {vendorOptions.map((vendor) => (
                <button
                  key={vendor.id}
                  className={`px-4 py-2 text-xs border rounded-full font-medium cursor-pointer transition-all duration-200 ${selectedVendorId === vendor.id ? 'bg-neon-pink border-neon-pink text-white shadow-glow' : 'bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20'}`}
                  onClick={() => { setSelectedVendorId(vendor.id); setShowFilters(false) }}
                >
                  <BuildingStorefrontIcon className="w-3.5 h-3.5 inline mr-1" />{vendor.name}
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
              : activeVendorName ?? 'All Items'}
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-text-gray text-sm">
              {loading ? '…' : `${groupedItems.length} ${groupedItems.length === 1 ? 'item' : 'items'}`}
            </span>
            {isSearching && (
              <button onClick={clearSearch} className="text-neon-pink text-sm font-semibold hover:opacity-80 transition-opacity">
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="pb-16">
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
              {Array.from({ length: 8 }).map((_, i) => <FoodCardSkeleton key={i} />)}
            </div>
          ) : groupedItems.length === 0 ? (
            <div className="text-center py-20 px-5">
              <MagnifyingGlassIcon className="w-16 h-16 mb-5 mx-auto opacity-20 text-white" />
              <h3 className="font-bebas text-3xl mb-2 tracking-wide">No items found</h3>
              <p className="text-text-gray">
                {isSearching ? `No results for "${searchQuery}"` : 'Try a different vendor or search term'}
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
              {groupedItems.map((group) => (
                <GroupedFoodCard
                  key={group.groupKey}
                  group={group}
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
