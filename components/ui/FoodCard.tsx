'use client'

import Link from 'next/link'
import { PlusIcon, MinusIcon, ClockIcon, ChevronRightIcon } from '@heroicons/react/24/outline'

// ── Vendor card variant ────────────────────────────────────────────────────────

interface VendorCardProps {
  variant: 'vendor'
  href: string
  name: string
  description?: string | null
  cuisineType?: string
  boothNumber?: string | null
  logoUrl?: string | null
  itemCount?: number
  isBusy?: boolean
  rating?: number | null
  accentColor: string
  featuredTag?: string
}

// ── Menu item card variant ─────────────────────────────────────────────────────

export interface MenuItemVariant {
  id: string
  label: string
  price: number
}

interface MenuItemCardProps {
  variant: 'menu-item'
  id: string
  name: string
  description?: string | null
  price: number
  imageUrl?: string | null
  prepTime?: number | null
  available?: boolean
  accentColor: string
  qty: number
  variants?: MenuItemVariant[]
  selectedVariantId?: string
  onVariantChange?: (id: string) => void
  onAdd: (opts?: { price: number; label: string }) => void
  onDecrement: () => void
  subtitle?: string | null
}

type FoodCardProps = VendorCardProps | MenuItemCardProps

// ── Component ─────────────────────────────────────────────────────────────────

export default function FoodCard(props: FoodCardProps) {
  if (props.variant === 'vendor') {
    const { href, name, description, cuisineType, boothNumber, logoUrl, itemCount = 0, isBusy, rating, accentColor, featuredTag } = props

    const subtitle = [cuisineType, boothNumber ? `Booth ${boothNumber}` : null].filter(Boolean).join(' · ')

    return (
      <Link
        href={href}
        className="group bg-bg-card rounded-xl border border-white/[0.06] overflow-hidden hover:border-[#FF0077]/30 hover:shadow-[0_0_25px_rgba(255,0,119,0.08)] transition-all duration-300 flex flex-col h-full no-underline"
      >
        {/* Image area — same as menu item card */}
        <div className="relative aspect-[4/3] bg-gradient-to-br from-[#1a1a1a] to-[#252525] overflow-hidden">
          {logoUrl ? (
            <img src={logoUrl} alt={name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="font-bebas text-5xl sm:text-6xl" style={{ color: `${accentColor}30` }}>{name[0]}</span>
            </div>
          )}
          {featuredTag && (
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[0.5625rem] font-bold text-white uppercase tracking-wider shadow-[0_2px_10px_rgba(255,0,119,0.35)]"
                 style={{ background: accentColor }}>
              {featuredTag}
            </div>
          )}
          {isBusy && !featuredTag && (
            <div className="absolute top-2 left-2 bg-yellow-500/90 px-2 py-0.5 rounded-full text-[0.5625rem] font-bold text-black">
              Busy
            </div>
          )}
        </div>

        {/* Card body */}
        <div className="p-3 sm:p-4 flex flex-col flex-1">
          <h3 className="font-bebas text-sm sm:text-base text-white uppercase tracking-wide leading-tight line-clamp-2">
            {name}
          </h3>
          <p className="mt-0.5 text-xs text-text-gray">{subtitle}</p>
          {description && (
            <p className="mt-1.5 text-xs text-text-gray/70 leading-relaxed line-clamp-2 flex-1">{description}</p>
          )}

          {/* Bottom row */}
          <div className="mt-auto pt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {rating ? (
                <div className="flex items-center gap-1">
                  <svg className="w-3 h-3 fill-yellow-500 text-yellow-500" viewBox="0 0 20 20">
                    <path d="M10 1l2.39 4.84 5.34.78-3.87 3.77.92 5.32L10 13.27l-4.78 2.44.92-5.32L2.27 6.62l5.34-.78L10 1z" />
                  </svg>
                  <span className="text-xs text-yellow-500">{rating}</span>
                </div>
              ) : null}
              <span className="text-xs text-text-gray">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
            </div>
            <span className="flex items-center gap-1 text-xs font-semibold transition-colors duration-200" style={{ color: accentColor }}>
              View Menu
              <ChevronRightIcon className="w-3 h-3 group-hover:translate-x-0.5 transition-transform duration-200" />
            </span>
          </div>
        </div>
      </Link>
    )
  }

  // menu-item variant
  const { name, description, price, imageUrl, prepTime, available = true, accentColor, qty, variants, selectedVariantId, onVariantChange, onAdd, onDecrement, subtitle } = props

  const activeVariant = variants?.find(v => v.id === selectedVariantId) ?? variants?.[0]
  const displayPrice = activeVariant?.price ?? price

  const handleAdd = () => {
    if (activeVariant) {
      onAdd({ price: activeVariant.price, label: activeVariant.label })
    } else {
      onAdd()
    }
  }

  return (
    <div className={`bg-bg-card rounded-xl overflow-hidden card-hover flex flex-col ${!available ? 'opacity-50' : ''}`}>
      {imageUrl ? (
        <div className="aspect-[4/3] overflow-hidden">
          <img src={imageUrl} alt={name} className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" />
        </div>
      ) : (
        <div
          className="aspect-[4/3] flex items-center justify-center"
          style={{ background: `linear-gradient(135deg, ${accentColor}12, ${accentColor}06)` }}
        >
          <span className="text-2xl opacity-20">🍽️</span>
        </div>
      )}

      <div className="p-3 flex flex-col flex-1">
        <h3 className="font-semibold text-white text-xs sm:text-sm leading-snug line-clamp-2">{name}</h3>
        {subtitle && (
          <p className="mt-0.5 text-xs text-text-gray">{subtitle}</p>
        )}

        {variants && variants.length > 0 ? (
          <div className="mt-1.5 flex gap-1 flex-wrap">
            {variants.map(v => (
              <button
                key={v.id}
                onClick={e => { e.preventDefault(); onVariantChange?.(v.id) }}
                className={`px-2 py-0.5 rounded text-[0.6rem] font-semibold font-inter transition-all border-0 cursor-pointer
                  ${(selectedVariantId ?? variants[0]?.id) === v.id
                    ? 'text-white'
                    : 'bg-white/[0.04] text-gray-400 hover:bg-white/[0.08]'}`}
                style={(selectedVariantId ?? variants[0]?.id) === v.id ? { background: accentColor } : {}}
              >
                {v.label} · ${v.price.toFixed(2)}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-sm font-bold tabular-nums" style={{ color: accentColor }}>
            ${displayPrice.toFixed(2)}
          </p>
        )}

        {description && (
          <p className="text-text-gray text-[0.65rem] mt-1 leading-relaxed line-clamp-2 flex-1">{description}</p>
        )}

        <div className="mt-2 flex items-center justify-between gap-1">
          {prepTime ? (
            <span className="flex items-center gap-0.5 text-text-gray text-[0.6rem]">
              <ClockIcon className="w-2.5 h-2.5 shrink-0" /> {prepTime}m
            </span>
          ) : (
            <span />
          )}

          {available && (
            <div className="w-[88px] h-[32px] flex items-center justify-end shrink-0">
              {qty > 0 ? (
                <div className="flex items-center h-full w-full rounded-lg overflow-hidden border border-white/10">
                  <button
                    onClick={onDecrement}
                    className="w-7 h-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors shrink-0"
                  >
                    <MinusIcon className="w-3 h-3 text-white" />
                  </button>
                  <span className="flex-1 h-full bg-white/5 flex items-center justify-center text-xs text-white font-semibold tabular-nums">
                    {qty}
                  </span>
                  <button
                    onClick={handleAdd}
                    className="w-7 h-full flex items-center justify-center hover:opacity-80 transition-opacity shrink-0"
                    style={{ background: accentColor }}
                  >
                    <PlusIcon className="w-3 h-3 text-white" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleAdd}
                  className="w-full h-full rounded-lg text-[0.65rem] font-semibold text-white hover:opacity-80 transition-opacity"
                  style={{ background: accentColor }}
                >
                  + Add
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
