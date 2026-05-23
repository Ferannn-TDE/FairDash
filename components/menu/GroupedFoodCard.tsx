'use client'

import { useState } from 'react'
import { PlusIcon, MinusIcon, ClockIcon, BuildingStorefrontIcon, HeartIcon } from '@heroicons/react/24/outline'
import { HeartIcon as HeartSolid } from '@heroicons/react/24/solid'
import toast from 'react-hot-toast'
import { useAuth } from '@clerk/clerk-react'
import { useFairCart } from '@/app/_contexts/FairCartContext'
import type { GroupedMenuItem, MenuVariant } from '@/lib/menu/getGroupedMenuItems'

interface Props {
  group: GroupedMenuItem
  accentColor: string
  isFavorited?: boolean
  onFavoriteToggle?: (menuItemId: string, favorited: boolean) => void
}

export function GroupedFoodCard({ group, accentColor, isFavorited = false, onFavoriteToggle }: Props) {
  const { addItem, updateQty, items } = useFairCart()
  const { isSignedIn } = useAuth()

  const availableVariants = group.variants.filter((v) => v.available)
  const [selected, setSelected] = useState<MenuVariant>(
    availableVariants[0] ?? group.variants[0]
  )
  const [favLoading, setFavLoading] = useState(false)

  const toggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isSignedIn) {
      toast('Sign in to save favorites', { icon: '🔒' })
      return
    }
    setFavLoading(true)
    const next = !isFavorited
    try {
      if (isFavorited) {
        await fetch(`/api/favorites?menuItemId=${selected.id}`, { method: 'DELETE' })
        toast.success('Removed from favorites')
      } else {
        await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ menuItemId: selected.id }),
        })
        toast.success('Saved to favorites')
      }
      onFavoriteToggle?.(selected.id, next)
    } catch {
      toast.error('Could not update favorites')
    } finally {
      setFavLoading(false)
    }
  }

  const isSingleVariant = group.variants.length === 1
  const cartItem = items.find((i) => i.menuItemId === selected.id)
  const selectedQty = cartItem?.quantity ?? 0

  const cartCount = items
    .filter((i) => group.variants.some((v) => v.id === i.menuItemId))
    .reduce((sum, i) => sum + i.quantity, 0)

  const handleAdd = () => {
    const variantSuffix = group.variants.length > 1 ? ` (${selected.label})` : ''
    addItem(
      {
        id: selected.id,
        name: `${group.baseName}${variantSuffix}`,
        price: selected.price,
        prepTime: group.prepTime ?? undefined,
        imageUrl: group.imageUrl,
      },
      { id: group.vendorId, name: group.vendorName }
    )
    toast.success(`${group.baseName}${variantSuffix} added`)
  }

  const allUnavailable = group.variants.every((v) => !v.available)

  return (
    <div className="bg-bg-card border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-colors duration-200 flex flex-col">
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden">
        {group.imageUrl ? (
          <img
            src={group.imageUrl}
            alt={group.baseName}
            className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${accentColor}12, ${accentColor}06)` }}
          >
            <BuildingStorefrontIcon className="w-8 h-8 opacity-20 text-white" />
          </div>
        )}
        {allUnavailable && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-t-xl">
            <span className="bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
              Sold Out
            </span>
          </div>
        )}
        <button
          onClick={toggleFavorite}
          disabled={favLoading}
          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center hover:bg-black/70 transition-colors cursor-pointer border-0"
          title={isFavorited ? 'Remove from favorites' : 'Save to favorites'}
        >
          {isFavorited
            ? <HeartSolid className="w-4 h-4 text-neon-pink" />
            : <HeartIcon className="w-4 h-4 text-white" />
          }
        </button>
      </div>

      {/* Body */}
      <div className={`p-3 flex flex-col flex-1 ${allUnavailable ? 'opacity-50' : ''}`}>
        <h3 className="font-semibold text-white text-xs sm:text-sm leading-snug line-clamp-2">
          {group.baseName}
        </h3>

        <p className="mt-0.5 text-[0.6rem] text-text-gray">{group.vendorName}</p>

        <p className="mt-1 text-sm font-bold tabular-nums" style={{ color: accentColor }}>
          ${selected.price.toFixed(2)}
        </p>

        {group.description && (
          <p className="text-text-gray text-[0.65rem] mt-1 leading-relaxed line-clamp-2 flex-1">
            {group.description}
          </p>
        )}

        {/* Size pills — only when multiple variants */}
        {group.variants.length > 1 && (
          <div className="flex gap-1 flex-wrap mt-2">
            {group.variants.map((v) => {
              const isSelected = v.id === selected.id
              return (
                <button
                  key={v.id}
                  onClick={() => v.available && setSelected(v)}
                  disabled={!v.available}
                  className={`px-2.5 py-0.5 rounded-full text-[0.6rem] font-semibold border transition-colors cursor-pointer ${
                    isSelected
                      ? 'text-white border-transparent'
                      : v.available
                      ? 'border-white/20 text-text-gray hover:border-white/40'
                      : 'border-white/10 text-white/20 cursor-not-allowed line-through'
                  }`}
                  style={isSelected ? { backgroundColor: accentColor, borderColor: accentColor } : {}}
                >
                  {v.label}
                </button>
              )
            })}
          </div>
        )}

        {/* Bottom row */}
        <div className="mt-2 flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            {group.prepTime ? (
              <span className="flex items-center gap-0.5 text-text-gray text-[0.6rem]">
                <ClockIcon className="w-2.5 h-2.5 shrink-0" /> {group.prepTime}m
              </span>
            ) : null}
            {cartCount > 0 && (
              <span
                className="text-[0.6rem] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: `${accentColor}22`, color: accentColor }}
              >
                {cartCount} in cart
              </span>
            )}
          </div>

          {allUnavailable ? (
            <button
              disabled
              className="px-2 py-1 rounded-lg text-[0.65rem] font-semibold bg-white/10 text-white/30 cursor-not-allowed whitespace-nowrap shrink-0"
            >
              Sold Out
            </button>
          ) : isSingleVariant && selectedQty > 0 ? (
            <div className="flex items-center shrink-0 rounded-lg overflow-hidden border border-white/10">
              <button
                onClick={() => updateQty(selected.id, selectedQty - 1)}
                className="w-6 h-6 bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
              >
                <MinusIcon className="w-3 h-3 text-white" />
              </button>
              <span className="text-white font-semibold w-5 text-center text-xs tabular-nums bg-white/5">
                {selectedQty}
              </span>
              <button
                onClick={handleAdd}
                className="w-6 h-6 flex items-center justify-center hover:opacity-80 transition-opacity"
                style={{ background: accentColor }}
              >
                <PlusIcon className="w-3 h-3 text-white" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleAdd}
              disabled={!selected.available}
              className={`flex items-center gap-0.5 px-2 py-1 rounded-lg text-[0.65rem] font-semibold text-white transition-opacity hover:opacity-80 whitespace-nowrap shrink-0 ${!selected.available ? 'bg-white/10 text-white/30 cursor-not-allowed' : ''}`}
              style={selected.available ? { background: accentColor } : {}}
            >
              {selected.available ? <><PlusIcon className="w-3 h-3" />Add</> : 'Sold Out'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
