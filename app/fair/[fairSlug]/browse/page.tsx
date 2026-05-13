'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { MagnifyingGlassIcon, XMarkIcon, ShoppingBagIcon } from '@heroicons/react/24/outline'
import { useFair } from '../../../_contexts/FairContext'
import { useFairCart } from '../../../_contexts/FairCartContext'
import { GroupedFoodCard } from '@/components/menu/GroupedFoodCard'
import type { GroupedMenuItem } from '@/lib/menu/getGroupedMenuItems'

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function BrowseSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-white/5 rounded-xl aspect-[3/4]" />
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const CART_VERSION = 'v2-real-ids'

export default function BrowsePage() {
  const params = useParams<{ fairSlug: string }>()
  const router = useRouter()
  const { fair } = useFair()
  const { itemCount, subtotal } = useFairCart()
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  const [allGrouped, setAllGrouped] = useState<GroupedMenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null)

  // Bust stale cart versions
  useEffect(() => {
    const versionKey = `fairsynq-cart-version-${params.fairSlug}`
    if (localStorage.getItem(versionKey) !== CART_VERSION) {
      localStorage.removeItem(`fairsynq-cart-${params.fairSlug}`)
      localStorage.setItem(versionKey, CART_VERSION)
    }
  }, [params.fairSlug])

  useEffect(() => {
    setLoading(true)
    fetch(`/api/menu?eventSlug=${params.fairSlug}&limit=200`)
      .then(r => r.json())
      .then(json => { if (json?.data) setAllGrouped(json.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [params.fairSlug])

  // Vendor options derived from grouped data — no separate vendors fetch needed
  const vendorOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: { id: string; name: string }[] = []
    allGrouped.forEach(g => {
      if (!seen.has(g.vendorId)) {
        seen.add(g.vendorId)
        opts.push({ id: g.vendorId, name: g.vendorName })
      }
    })
    return opts
  }, [allGrouped])

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allGrouped.filter(g => {
      if (selectedVendorId && g.vendorId !== selectedVendorId) return false
      if (q) return (
        g.baseName.toLowerCase().includes(q) ||
        (g.description ?? '').toLowerCase().includes(q) ||
        g.vendorName.toLowerCase().includes(q)
      )
      return true
    })
  }, [allGrouped, search, selectedVendorId])

  return (
    <div className="min-h-screen bg-[#111] text-white">

      {/* Page header */}
      <div className="bg-[#111] border-b border-white/[0.06] py-6 sm:py-8">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <h1 className="font-bebas text-2xl sm:text-3xl text-white uppercase tracking-wide">
            Browse Menu
          </h1>
          <p className="mt-1 text-sm text-[#A1A1A1] font-inter">
            {fair.name ? `${fair.name} · ` : ''}All vendors and items in one place
          </p>

          {/* Search */}
          <div className="relative mt-5">
            <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A1A1A1] pointer-events-none" />
            <input
              type="text"
              placeholder="Search menu items…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-11 pl-11 pr-10 bg-[#1a1a1a] border border-white/[0.06] text-white text-sm
                         font-inter rounded-xl placeholder:text-[#555]
                         focus:border-[#FF0077]/40 focus:ring-1 focus:ring-[#FF0077]/20
                         transition-all duration-200 outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#A1A1A1] hover:text-white transition-colors cursor-pointer bg-transparent border-0"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6">

        {/* Vendor filter pills */}
        {!loading && vendorOptions.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-6 scrollbar-hide">
            <button
              onClick={() => setSelectedVendorId(null)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-inter font-semibold uppercase tracking-wider transition-all border cursor-pointer
                ${!selectedVendorId
                  ? 'text-white border-transparent'
                  : 'bg-white/[0.04] border-white/[0.06] text-[#A1A1A1] hover:bg-white/[0.08] hover:text-white'}`}
              style={!selectedVendorId ? { background: accentColor, borderColor: accentColor } : {}}
            >
              All
            </button>
            {vendorOptions.map(v => (
              <button
                key={v.id}
                onClick={() => setSelectedVendorId(v.id)}
                className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-inter font-semibold uppercase tracking-wider transition-all border cursor-pointer
                  ${selectedVendorId === v.id
                    ? 'text-white border-transparent'
                    : 'bg-white/[0.04] border-white/[0.06] text-[#A1A1A1] hover:bg-white/[0.08] hover:text-white'}`}
                style={selectedVendorId === v.id ? { background: accentColor, borderColor: accentColor } : {}}
              >
                {v.name}
              </button>
            ))}
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <BrowseSkeleton />
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[#A1A1A1] text-sm font-inter">
              {search ? `No items match "${search}"` : 'No items available'}
            </p>
            {search && (
              <button
                onClick={() => setSearch('')}
                className="mt-4 px-5 py-2.5 rounded-xl text-white text-sm font-semibold cursor-pointer border-0"
                style={{ background: accentColor }}
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {filteredItems.map(group => (
              <GroupedFoodCard
                key={group.groupKey}
                group={group}
                accentColor={accentColor}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sticky cart pill */}
      {itemCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
          <button
            onClick={() => router.push(`/fair/${params.fairSlug}/checkout`)}
            className="flex items-center gap-3 px-5 py-3 rounded-full font-semibold text-white text-sm border-0 cursor-pointer transition-all hover:opacity-90 active:scale-[0.97]"
            style={{ background: accentColor, boxShadow: `0 4px 20px ${accentColor}60` }}
          >
            <ShoppingBagIcon className="w-4 h-4" />
            <span>
              View Cart · {itemCount} {itemCount === 1 ? 'item' : 'items'} · ${subtotal.toFixed(2)}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
