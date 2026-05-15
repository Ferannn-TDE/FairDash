'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { HeartIcon, TrashIcon, ClockIcon } from '@heroicons/react/24/outline'
import { HeartIcon as HeartSolid } from '@heroicons/react/24/solid'
import toast from 'react-hot-toast'
import MarketplaceNavbar from '../../_components/MarketplaceNavbar'

interface FavoriteItem {
  id: string
  menuItemId: string
  menuItem: {
    id: string
    name: string
    description: string | null
    price: number
    imageUrl: string | null
    prepTime: number | null
    category: string
    vendor: {
      id: string
      name: string
      boothNumber: string | null
      event: {
        urlSlug: string
        name: string
      } | null
    }
  }
}

function FavoriteCard({ fav, onRemove }: { fav: FavoriteItem; onRemove: (menuItemId: string) => void }) {
  const { menuItem } = fav
  const vendor = menuItem.vendor
  const fairSlug = vendor.event?.urlSlug
  const vendorHref = fairSlug ? `/fair/${fairSlug}/vendor/${vendor.id}` : null

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden hover:border-white/20 transition-colors duration-200">
      {/* Image */}
      {menuItem.imageUrl ? (
        <div className="aspect-[16/9] overflow-hidden">
          <img src={menuItem.imageUrl} alt={menuItem.name} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="aspect-[16/9] bg-gradient-to-br from-neon-pink/8 to-[#1a1a1a] flex items-center justify-center">
          <HeartIcon className="w-10 h-10 opacity-20 text-white" />
        </div>
      )}

      {/* Body */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-semibold text-white text-sm leading-snug">{menuItem.name}</h3>
          <span className="text-neon-pink font-bold text-sm shrink-0">${menuItem.price.toFixed(2)}</span>
        </div>

        {menuItem.description && (
          <p className="text-text-gray text-xs leading-relaxed line-clamp-2 mb-2">{menuItem.description}</p>
        )}

        <div className="flex items-center gap-2 text-xs text-text-gray mb-3">
          <span>{vendor.name}</span>
          {vendor.boothNumber && <><span>·</span><span>Booth {vendor.boothNumber}</span></>}
          {menuItem.prepTime && (
            <><span>·</span><ClockIcon className="w-3 h-3 inline" /> {menuItem.prepTime}m</>
          )}
        </div>

        <div className="flex items-center gap-2">
          {vendorHref ? (
            <Link
              href={vendorHref}
              className="flex-1 text-center py-2 rounded-xl bg-neon-pink text-white text-xs font-semibold hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.2)]"
            >
              Order Now
            </Link>
          ) : (
            <div className="flex-1 text-center py-2 rounded-xl bg-white/5 text-text-gray text-xs font-semibold">
              Fair not available
            </div>
          )}
          <button
            onClick={() => onRemove(menuItem.id)}
            className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
            title="Remove from favorites"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function FavoriteSkeleton() {
  return (
    <div className="bg-bg-card border border-white/5 rounded-2xl overflow-hidden animate-pulse">
      <div className="aspect-[16/9] bg-white/5" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-white/10 rounded w-3/4" />
        <div className="h-3 bg-white/5 rounded w-full" />
        <div className="h-3 bg-white/5 rounded w-1/2" />
        <div className="h-8 bg-white/5 rounded-xl mt-3" />
      </div>
    </div>
  )
}

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/favorites')
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setFavorites(json.data.favorites)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleRemove = async (menuItemId: string) => {
    try {
      const res = await fetch(`/api/favorites?menuItemId=${menuItemId}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message || 'Failed to remove')
      setFavorites((prev) => prev.filter((f) => f.menuItemId !== menuItemId))
      toast.success('Removed from favorites')
    } catch (err: any) {
      toast.error(err.message || 'Could not remove favorite')
    }
  }

  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">
        <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-12">

          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <Link href="/account" className="text-text-gray hover:text-white transition-colors text-sm">
              ← Account
            </Link>
            <h1 className="font-bebas text-5xl text-white tracking-wide flex items-center gap-3">
              Favorites
              <HeartSolid className="w-8 h-8 text-neon-pink" />
            </h1>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {Array.from({ length: 6 }).map((_, i) => <FavoriteSkeleton key={i} />)}
            </div>
          ) : favorites.length === 0 ? (
            <div className="bg-bg-card border border-white/10 rounded-2xl p-12 text-center">
              <HeartIcon className="w-12 h-12 text-text-gray/30 mx-auto mb-4" />
              <p className="text-text-gray mb-2">No favorites yet.</p>
              <p className="text-text-gray text-sm mb-6">
                Browse vendors at an active fair and save items you love.
              </p>
              <Link
                href="/fairs"
                className="inline-flex items-center px-6 py-3 rounded-xl bg-neon-pink text-white font-semibold hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
              >
                Find a Fair
              </Link>
            </div>
          ) : (
            <>
              <p className="text-text-gray text-sm mb-6">
                {favorites.length} saved item{favorites.length !== 1 ? 's' : ''}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {favorites.map((fav) => (
                  <FavoriteCard key={fav.id} fav={fav} onRemove={handleRemove} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
