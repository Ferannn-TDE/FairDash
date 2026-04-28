'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { MagnifyingGlassIcon, XMarkIcon, ShoppingBagIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useFair } from '../../../_contexts/FairContext'
import { useFairCart } from '../../../_contexts/FairCartContext'
import FoodCard from '@/components/ui/FoodCard'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MenuItem {
  id: string
  name: string
  description: string | null
  price: number
  category: string
  imageUrl: string | null
  prepTime: number | null
  isAvailable: boolean
  vendorId: string
}

interface Vendor {
  id: string
  name: string
  cuisineType: string
  boothNumber: string | null
  logoUrl: string | null
  isBusy: boolean
  isOffline: boolean
}

interface FlatItem extends MenuItem {
  vendorName: string
}

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
  const { items: cartItems, vendorId: cartVendorId, itemCount, subtotal, addItem, updateQty } = useFairCart()
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [allItems, setAllItems] = useState<FlatItem[]>([])
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
    Promise.all([
      fetch(`/api/vendors?eventSlug=${params.fairSlug}&limit=100`).then(r => r.json()),
      fetch(`/api/menu?eventSlug=${params.fairSlug}&limit=200`).then(r => r.json()),
    ])
      .then(([vJson, mJson]) => {
        const fetchedVendors: Vendor[] = vJson?.data ?? []
        const menuItems: MenuItem[] = mJson?.data ?? []

        const vendorMap = new Map(fetchedVendors.map(v => [v.id, v]))

        const flat: FlatItem[] = menuItems
          .filter(i => i.isAvailable)
          .map(i => ({
            ...i,
            vendorName: vendorMap.get(i.vendorId)?.name ?? '',
          }))

        setVendors(fetchedVendors.filter(v => menuItems.some(i => i.vendorId === v.id)))
        setAllItems(flat)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [params.fairSlug])

  const cartQtyMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const item of cartItems) m.set(item.menuItemId, item.quantity)
    return m
  }, [cartItems])

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allItems.filter(item => {
      const matchesSearch = !q || item.name.toLowerCase().includes(q)
      const matchesVendor = !selectedVendorId || item.vendorId === selectedVendorId
      return matchesSearch && matchesVendor
    })
  }, [allItems, search, selectedVendorId])

  const handleAdd = useCallback((item: FlatItem, opts?: { price: number; label: string }) => {
    const vendor = vendors.find(v => v.id === item.vendorId)
    if (!vendor) return
    const price = opts?.price ?? item.price
    const name = opts?.label ? `${item.name} (${opts.label})` : item.name
    addItem(
      { id: item.id, name, price, prepTime: item.prepTime ?? undefined, imageUrl: item.imageUrl },
      { id: vendor.id, name: vendor.name }
    )
    toast.success(`${name} added`, { duration: 1200 })
  }, [addItem, vendors])

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
        {!loading && vendors.length > 1 && (
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
            {vendors.map(v => (
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
            {filteredItems.map(item => (
              <FoodCard
                key={item.id}
                variant="menu-item"
                id={item.id}
                name={item.name}
                description={item.description}
                price={item.price}
                imageUrl={item.imageUrl}
                prepTime={item.prepTime}
                available={item.isAvailable}
                accentColor={accentColor}
                qty={cartQtyMap.get(item.id) ?? 0}
                subtitle={item.vendorName}
                onAdd={(opts) => handleAdd(item, opts)}
                onDecrement={() => updateQty(item.id, (cartQtyMap.get(item.id) ?? 1) - 1)}
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
