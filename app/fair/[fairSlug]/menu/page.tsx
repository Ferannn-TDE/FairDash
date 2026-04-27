'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import {
  MagnifyingGlassIcon,
  BuildingStorefrontIcon,
  XMarkIcon,
  PlusIcon,
  MinusIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useFair } from '../../../_contexts/FairContext'
import { useFairCart } from '../../../_contexts/FairCartContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FlatMenuItem {
  id: string
  name: string
  description: string | null
  price: number
  category: string
  imageUrl: string | null
  prepTime: number | null
  available: boolean
  vendorId: string
  vendorName: string
}

interface VendorOption {
  id: string
  name: string
}

// ── FoodCard ───────────────────────────────────────────────────────────────────

function FoodCard({
  item,
  accentColor,
}: {
  item: FlatMenuItem
  accentColor: string
}) {
  const { addItem, items, updateQty } = useFairCart()
  const cartItem = items.find((i) => i.menuItemId === item.id)
  const qty = cartItem?.quantity ?? 0

  const handleAdd = () => {
    addItem(
      { id: item.id, name: item.name, price: item.price, prepTime: item.prepTime ?? undefined, imageUrl: item.imageUrl },
      { id: item.vendorId, name: item.vendorName },
    )
    toast.success(`${item.name} added`)
  }

  return (
    <div
      className={`bg-bg-card border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-colors duration-200 flex flex-col ${!item.available ? 'opacity-50' : ''}`}
    >
      {/* Image / placeholder */}
      {item.imageUrl ? (
        <div className="aspect-[4/3] overflow-hidden">
          <img
            src={item.imageUrl}
            alt={item.name}
            className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
          />
        </div>
      ) : (
        <div
          className="aspect-[4/3] flex items-center justify-center"
          style={{ background: `linear-gradient(135deg, ${accentColor}12, ${accentColor}06)` }}
        >
          <span className="text-2xl opacity-20">🍽️</span>
        </div>
      )}

      {/* Card body */}
      <div className="p-3 flex flex-col flex-1">
        <h3 className="font-semibold text-white text-xs sm:text-sm leading-snug line-clamp-2">{item.name}</h3>

        <p className="mt-0.5 text-[0.6rem] text-text-gray">{item.vendorName}</p>

        <p className="mt-1 text-sm font-bold tabular-nums" style={{ color: accentColor }}>
          ${item.price.toFixed(2)}
        </p>

        {item.description && (
          <p className="text-text-gray text-[0.65rem] mt-1 leading-relaxed line-clamp-2 flex-1">{item.description}</p>
        )}

        {/* Bottom row */}
        <div className="mt-2 flex items-center justify-between gap-1">
          {item.prepTime ? (
            <span className="flex items-center gap-0.5 text-text-gray text-[0.6rem]">
              <ClockIcon className="w-2.5 h-2.5 shrink-0" /> {item.prepTime}m
            </span>
          ) : (
            <span />
          )}

          {item.available && (
            qty === 0 ? (
              <button
                onClick={handleAdd}
                className="flex items-center gap-0.5 px-2 py-1 rounded-lg text-[0.65rem] font-semibold text-white transition-opacity hover:opacity-80 whitespace-nowrap shrink-0"
                style={{ background: accentColor }}
              >
                <PlusIcon className="w-3 h-3" />
                Add
              </button>
            ) : (
              <div className="flex items-center shrink-0 rounded-lg overflow-hidden border border-white/10">
                <button
                  onClick={() => updateQty(item.id, qty - 1)}
                  className="w-6 h-6 bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                >
                  <MinusIcon className="w-3 h-3 text-white" />
                </button>
                <span className="text-white font-semibold w-5 text-center text-xs tabular-nums bg-white/5">{qty}</span>
                <button
                  onClick={handleAdd}
                  className="w-6 h-6 flex items-center justify-center hover:opacity-80 transition-opacity"
                  style={{ background: accentColor }}
                >
                  <PlusIcon className="w-3 h-3 text-white" />
                </button>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
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

  const [allItems, setAllItems] = useState<FlatMenuItem[]>([])
  const [loading, setLoading] = useState(true)

  // Bust any stale localStorage cart that has mock IDs from before the real API was wired up
  useEffect(() => {
    const versionKey = `fairsynq-cart-version-${params.fairSlug}`
    if (localStorage.getItem(versionKey) !== CART_VERSION) {
      localStorage.removeItem(`fairsynq-cart-${params.fairSlug}`)
      localStorage.setItem(versionKey, CART_VERSION)
    }
  }, [params.fairSlug])

  // Fetch all menu items from the real DB
  useEffect(() => {
    setLoading(true)
    fetch(`/api/menu?eventSlug=${params.fairSlug}&limit=200`)
      .then(r => r.json())
      .then(json => {
        if (json?.data) {
          setAllItems(
            json.data.map((item: any): FlatMenuItem => ({
              id: item.id,
              name: item.name,
              description: item.description ?? null,
              price: item.price,
              category: item.category,
              imageUrl: item.imageUrl ?? null,
              prepTime: item.prepTime ?? null,
              available: item.isAvailable,
              vendorId: item.vendorId,
              vendorName: item.vendor?.name ?? '',
            }))
          )
        }
      })
      .catch(() => {/* keep empty state, show no items */})
      .finally(() => setLoading(false))
  }, [params.fairSlug])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedVendorId, setSelectedVendorId] = useState<string>('all')
  const [showFilters, setShowFilters] = useState(false)

  const isSearching = searchQuery.trim().length > 0
  const clearSearch = () => setSearchQuery('')

  // Unique vendor options — derive from real menu items so pills only show
  // vendors that actually have items available
  const vendorOptions = useMemo<VendorOption[]>(() => {
    const seen = new Set<string>()
    const opts: VendorOption[] = []
    allItems.forEach((item) => {
      if (!seen.has(item.vendorId)) {
        seen.add(item.vendorId)
        opts.push({ id: item.vendorId, name: item.vendorName })
      }
    })
    return opts
  }, [allItems])

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allItems.filter((item) => {
      if (q)
        return (
          item.name.toLowerCase().includes(q) ||
          (item.description ?? '').toLowerCase().includes(q) ||
          item.vendorName.toLowerCase().includes(q)
        )
      return selectedVendorId === 'all' || item.vendorId === selectedVendorId
    })
  }, [allItems, selectedVendorId, searchQuery])

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
              : activeVendorName ?? 'All Items'}
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-text-gray text-sm">
              {loading ? '…' : `${filteredItems.length} ${filteredItems.length === 1 ? 'item' : 'items'}`}
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
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-20 px-5">
              <div className="text-[6rem] mb-5 opacity-30">🔍</div>
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
              {filteredItems.map((item) => (
                <FoodCard key={`${item.vendorId}-${item.id}`} item={item} accentColor={accentColor} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
