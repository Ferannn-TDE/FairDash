'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PlusIcon, MinusIcon, ShoppingBagIcon, ClockIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useFair } from '../../../../_contexts/FairContext'
import { useFairCart } from '../../../../_contexts/FairCartContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DisplayMenuItem {
  id: string
  name: string
  description: string | null
  price: number
  category: string
  imageUrl: string | null
  prepTime: number | null
  available: boolean
}

interface VendorDetail {
  id: string
  name: string
  cuisineType: string
  description: string | null
  boothNumber: string | null
  logoUrl: string | null
  isBusy: boolean
  menu: DisplayMenuItem[]
}

// ── Card layout with image support ────────────────────────────────────────────

function MenuItemCard({
  item,
  vendor,
  accentColor,
}: {
  item: DisplayMenuItem
  vendor: VendorDetail
  accentColor: string
}) {
  const { addItem, items, updateQty } = useFairCart()
  const cartItem = items.find((i) => i.menuItemId === item.id)
  const qty = cartItem?.quantity ?? 0

  const handleAdd = () => {
    addItem(
      { id: item.id, name: item.name, price: item.price, prepTime: item.prepTime ?? undefined, imageUrl: item.imageUrl },
      { id: vendor.id, name: vendor.name },
    )
    toast.success(`${item.name} added`)
  }

  return (
    <div className={`bg-bg-card border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-colors duration-200 flex flex-col ${!item.available ? 'opacity-50' : ''}`}>

      {/* Image area */}
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

        <p className="mt-1 text-sm font-bold tabular-nums" style={{ color: accentColor }}>
          ${item.price.toFixed(2)}
        </p>

        {item.description && (
          <p className="text-text-gray text-[0.65rem] mt-1 leading-relaxed line-clamp-2 flex-1">{item.description}</p>
        )}

        {/* Bottom row: prep time + add/qty */}
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

// ── Skeleton ──────────────────────────────────────────────────────────────────

function PageSkeleton({ accentColor }: { accentColor: string }) {
  return (
    <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 sm:py-10 animate-pulse">
      <div className="flex items-start gap-4 mb-8">
        <div className="w-16 h-16 rounded-2xl" style={{ background: `${accentColor}22` }} />
        <div className="flex-1 space-y-2">
          <div className="h-8 bg-white/10 rounded w-48" />
          <div className="h-4 bg-white/5 rounded w-32" />
          <div className="h-4 bg-white/5 rounded w-64" />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-bg-card rounded-xl overflow-hidden">
            <div className="aspect-[4/3] bg-white/5" />
            <div className="p-3 space-y-2">
              <div className="h-4 bg-white/10 rounded w-3/4" />
              <div className="h-3 bg-white/5 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function VendorMenuPage() {
  const params = useParams<{ fairSlug: string; vendorSlug: string }>()
  const router = useRouter()
  const { fair } = useFair()
  const { itemCount, subtotal } = useFairCart()
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  const [vendor, setVendor] = useState<VendorDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!params.vendorSlug) return
    setLoading(true)

    fetch(`/api/vendors/${params.vendorSlug}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) {
          setNotFound(true)
          setLoading(false)
          return
        }
        const raw = json.data
        const normalized: VendorDetail = {
          id: raw.id,
          name: raw.name,
          cuisineType: raw.cuisineType,
          description: raw.description ?? null,
          boothNumber: raw.boothNumber ?? null,
          logoUrl: raw.logoUrl ?? null,
          isBusy: raw.isBusy ?? false,
          menu: (raw.menuItems ?? []).map((item: any): DisplayMenuItem => ({
            id: item.id,
            name: item.name,
            description: item.description ?? null,
            price: item.price,
            category: item.category,
            imageUrl: item.imageUrl ?? null,
            prepTime: item.prepTime ?? null,
            available: item.isAvailable ?? true,
          })),
        }
        setVendor(normalized)
        setLoading(false)
      })
      .catch(() => { setNotFound(true); setLoading(false) })
  }, [params.vendorSlug])

  if (loading) {
    return <PageSkeleton accentColor={accentColor} />
  }

  if (notFound || !vendor) {
    return (
      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-20 text-center text-white">
        <div className="text-[6rem] mb-5 opacity-30">🍽️</div>
        <h2 className="font-bebas text-3xl tracking-wide mb-2">Vendor not found</h2>
        <p className="text-text-gray mb-6">This vendor may no longer be available at this fair.</p>
        <button
          onClick={() => router.push(`/fair/${fair.slug}/vendors`)}
          className="px-6 py-3 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          Browse Vendors
        </button>
      </div>
    )
  }

  const categories = Array.from(new Set(vendor.menu.map((m) => m.category)))

  const handleCheckout = () => {
    router.push(`/fair/${fair.slug}/cart`)
  }

  return (
    <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 sm:py-10 text-white">
      <div className="flex flex-col lg:flex-row gap-8">

        {/* Main: vendor info + menu */}
        <div className="flex-1">

          {/* Vendor header */}
          <div className="flex items-start gap-3 sm:gap-4 mb-6 sm:mb-8">
            <div
              className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0 font-bebas text-2xl sm:text-3xl overflow-hidden"
              style={{ background: `${accentColor}22`, border: `1px solid ${accentColor}44`, color: accentColor }}
            >
              {vendor.logoUrl ? (
                <img src={vendor.logoUrl} alt={vendor.name} className="w-full h-full object-cover" />
              ) : (
                vendor.name.charAt(0)
              )}
            </div>
            <div className="min-w-0">
              <h1 className="font-bebas text-2xl sm:text-3xl text-white tracking-wide leading-tight">{vendor.name}</h1>
              <p className="text-text-gray text-xs sm:text-sm">
                {vendor.cuisineType}
                {vendor.boothNumber && ` · Booth ${vendor.boothNumber}`}
              </p>
              {vendor.isBusy && (
                <span className="inline-block mt-1 px-2 py-0.5 bg-yellow-500/15 text-yellow-400 text-xs font-semibold rounded-full">
                  Currently Busy
                </span>
              )}
              {vendor.description && (
                <p className="text-text-gray text-xs sm:text-sm mt-1.5 max-w-xl leading-relaxed">{vendor.description}</p>
              )}
            </div>
          </div>

          {vendor.menu.length === 0 ? (
            <div className="text-center py-16 text-text-gray">
              <div className="text-[4rem] mb-4 opacity-20">🍽️</div>
              <p>No menu items available right now.</p>
            </div>
          ) : (
            categories.map((category, i) => (
              <section key={category} className={i === 0 ? 'mb-8' : 'mt-10 mb-8'}>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="font-bebas text-xs sm:text-sm text-white uppercase tracking-widest whitespace-nowrap">
                    {category}
                  </h2>
                  <div className="flex-1 h-px" style={{ background: `${accentColor}30` }} />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  {vendor.menu
                    .filter((m) => m.category === category)
                    .map((item) => (
                      <MenuItemCard key={item.id} item={item} vendor={vendor} accentColor={accentColor} />
                    ))}
                </div>
              </section>
            ))
          )}
        </div>

        {/* Sidebar: cart summary (desktop only) */}
        {itemCount > 0 && (
          <div className="hidden lg:block lg:w-72 shrink-0">
            <div className="bg-bg-card border border-white/10 rounded-2xl p-5 sticky top-20">
              <h2 className="font-bebas text-xl text-white tracking-wide mb-1">Your Order</h2>
              <p className="text-text-gray text-sm mb-4">
                {itemCount} item{itemCount !== 1 ? 's' : ''} · ${subtotal.toFixed(2)}
              </p>
              <button
                onClick={handleCheckout}
                className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                style={{ background: accentColor }}
              >
                <ShoppingBagIcon className="w-4 h-4" />
                View Cart
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
