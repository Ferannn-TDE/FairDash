'use client'

import { useParams } from 'next/navigation'
import { notFound } from 'next/navigation'
import { StarIcon } from '@heroicons/react/24/solid'
import { PlusIcon, MinusIcon, ShoppingBagIcon, ClockIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useFair } from '../../../../_contexts/FairContext'
import { useFairCart } from '../../../../_contexts/FairCartContext'
import { getVendorBySlug, type MenuItem, type MockVendor } from '@/lib/mock'

// ── Fix 3: Card layout with image support ─────────────────────────────────────

function MenuItemCard({
  item,
  vendor,
  accentColor,
}: {
  item: MenuItem
  vendor: MockVendor
  accentColor: string
}) {
  const { addItem, items, updateQty } = useFairCart()
  const cartItem = items.find((i) => i.menuItemId === item.id)
  const qty = cartItem?.quantity ?? 0

  return (
    <div className={`bg-bg-card border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-colors duration-200 flex flex-col ${!item.available ? 'opacity-50' : ''}`}>

      {/* Image area — aspect-[4/3] gradient placeholder when no imageUrl */}
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
        {/* Name */}
        <h3 className="font-semibold text-white text-xs sm:text-sm leading-snug line-clamp-2">{item.name}</h3>

        {/* Popular badge */}
        {item.popular && (
          <span className="inline-block mt-1 px-1.5 py-0.5 bg-yellow-400/15 text-yellow-400 text-[0.55rem] font-semibold uppercase tracking-wide rounded w-fit">
            Popular
          </span>
        )}

        {/* Price */}
        <p className="mt-1 text-sm font-bold tabular-nums" style={{ color: accentColor }}>
          ${item.price.toFixed(2)}
        </p>

        {/* Description */}
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
                onClick={() => {
                  addItem(item, vendor)
                  toast.success(`${item.name} added`)
                }}
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
                  onClick={() => addItem(item, vendor)}
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function VendorMenuPage() {
  const params = useParams<{ fairSlug: string; vendorSlug: string }>()
  const { fair } = useFair()
  const { itemCount, subtotal, syncToSpaCart } = useFairCart()
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  const vendor = getVendorBySlug(params.fairSlug, params.vendorSlug)
  if (!vendor) notFound()

  const categories = Array.from(new Set(vendor.menu.map((m) => m.category)))

  const handleCheckout = () => {
    syncToSpaCart()
    window.location.href = `/fair/${fair.slug}/cart`
  }

  return (
    // Fix 2: NO back link here — the FairNavbar handles all back navigation contextually.
    <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 sm:py-10 text-white">
      <div className="flex flex-col lg:flex-row gap-8">

        {/* Main: vendor info + menu */}
        <div className="flex-1">

          {/* Vendor header */}
          <div className="flex items-start gap-3 sm:gap-4 mb-6 sm:mb-8">
            <div
              className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0 font-bebas text-2xl sm:text-3xl"
              style={{ background: `${accentColor}22`, border: `1px solid ${accentColor}44`, color: accentColor }}
            >
              {vendor.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <h1 className="font-bebas text-2xl sm:text-3xl text-white tracking-wide leading-tight">{vendor.name}</h1>
              <p className="text-text-gray text-xs sm:text-sm">{vendor.cuisineType} · Booth {vendor.boothNumber}</p>
              {vendor.rating && (
                <span className="flex items-center gap-1 text-yellow-400 text-xs sm:text-sm font-semibold mt-1">
                  <StarIcon className="w-3.5 h-3.5 shrink-0" /> {vendor.rating.toFixed(1)}
                  <span className="text-text-gray font-normal text-xs">({vendor.reviewCount} reviews)</span>
                </span>
              )}
              {vendor.description && (
                <p className="text-text-gray text-xs sm:text-sm mt-1.5 max-w-xl leading-relaxed">{vendor.description}</p>
              )}
            </div>
          </div>

          {/* Fix 3: Category grid — 2 cols on sm+ */}
          {categories.map((category, i) => (
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
          ))}
        </div>

        {/* Sidebar: cart summary (desktop only — mobile uses bottom nav Cart tab) */}
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
