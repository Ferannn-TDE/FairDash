'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  HeartIcon,
  TrashIcon,
  ClockIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
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

function FavoriteSkeleton() {
  return (
    <div className="bg-[#1a1a1a] border border-white/[0.07] rounded-2xl overflow-hidden animate-pulse">
      <div className="aspect-[4/3] bg-white/5" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-white/10 rounded w-3/4" />
        <div className="h-3 bg-white/5 rounded w-full" />
        <div className="h-3 bg-white/5 rounded w-1/2" />
        <div className="h-8 bg-white/5 rounded-xl mt-3" />
      </div>
    </div>
  )
}

interface FavoriteCardProps {
  fav: FavoriteItem
  onRequestDelete: (fav: FavoriteItem) => void
}

function FavoriteCard({ fav, onRequestDelete }: FavoriteCardProps) {
  const { menuItem } = fav
  const vendor = menuItem.vendor
  const fairSlug = vendor.event?.urlSlug
  const vendorHref = fairSlug ? `/fair/${fairSlug}/vendor/${vendor.id}` : null

  return (
    <div className="bg-[#1a1a1a] border border-white/[0.07] rounded-2xl overflow-hidden flex flex-col h-full group">
      {/* Image — fixed height, never shifts layout */}
      <div className="relative h-40 bg-white/[0.03] shrink-0 overflow-hidden">
        {menuItem.imageUrl ? (
          <img
            src={menuItem.imageUrl}
            alt={menuItem.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="font-bebas text-5xl text-white/10">
              {menuItem.name.charAt(0)}
            </span>
          </div>
        )}

        {/* Delete overlay button */}
        <button
          onClick={() => onRequestDelete(fav)}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center hover:bg-red-500/80 transition-colors group/del cursor-pointer border-0"
          title="Remove from favorites"
        >
          <TrashIcon className="w-4 h-4 text-white/70 group-hover/del:text-white" />
        </button>
      </div>

      {/* Card content — grows to fill, button always at bottom */}
      <div className="p-3 flex flex-col flex-1">
        <p className="font-bebas text-lg text-white tracking-wide leading-tight uppercase truncate">
          {menuItem.name}
        </p>

        {/* Reserved 2-line slot — keeps cards aligned even without description */}
        <p className="text-white/40 text-xs leading-relaxed line-clamp-2 min-h-[2.5rem] mt-1">
          {menuItem.description ?? ''}
        </p>

        <div className="flex items-center justify-between mt-2">
          <span className="text-neon-pink font-bold text-base">
            ${(menuItem.price ?? 0).toFixed(2)}
          </span>
          {menuItem.prepTime && (
            <span className="flex items-center gap-1 text-white/30 text-xs">
              <ClockIcon className="w-3 h-3" />
              {menuItem.prepTime}m
            </span>
          )}
        </div>

        <p className="text-[10px] text-white/30 uppercase tracking-widest font-medium mt-1 truncate">
          {vendor.name}
          {vendor.boothNumber && ` · Booth ${vendor.boothNumber}`}
        </p>

        {/* Spacer — pushes button to bottom regardless of content length */}
        <div className="flex-1" />

        {vendorHref ? (
          <Link
            href={vendorHref}
            className="mt-3 w-full py-2.5 bg-[#FF0077] hover:bg-[#e6006b] text-white text-xs font-bold rounded-xl text-center transition-colors block uppercase tracking-wide"
          >
            Order Now
          </Link>
        ) : (
          <div className="mt-3 w-full py-2.5 bg-white/5 text-white/30 text-xs font-semibold rounded-xl text-center uppercase tracking-wide">
            Unavailable
          </div>
        )}
      </div>
    </div>
  )
}

interface DeleteModalProps {
  fav: FavoriteItem
  onConfirm: () => void
  onCancel: () => void
}

function DeleteModal({ fav, onConfirm, onCancel }: DeleteModalProps) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-sm p-6">
        <h3 className="font-bebas text-xl text-white mb-1 tracking-wide">
          Remove from Favorites?
        </h3>
        <p className="text-white/50 text-sm mb-6">
          <span className="text-white font-medium">{fav.menuItem.name}</span>
          {' '}will be removed from your saved items.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/5 transition-colors cursor-pointer bg-transparent"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-colors cursor-pointer border-0"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState<FavoriteItem | null>(null)

  useEffect(() => {
    fetch('/api/favorites')
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setFavorites(json.data.favorites)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return
    // Optimistic remove
    setFavorites((prev) => prev.filter((f) => f.id !== confirmDelete.id))
    setConfirmDelete(null)
    try {
      const res = await fetch(`/api/favorites?menuItemId=${confirmDelete.menuItemId}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message || 'Failed')
      toast.success('Removed from favorites')
    } catch {
      toast.error('Could not remove favorite')
    }
  }

  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">
        <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-12">

          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-xs text-white/40 mb-6">
            <Link href="/" className="hover:text-white/70 transition-colors">Home</Link>
            <ChevronRightIcon className="w-3 h-3 text-white/20 shrink-0" />
            <Link href="/account" className="hover:text-white/70 transition-colors">Account</Link>
            <ChevronRightIcon className="w-3 h-3 text-white/20 shrink-0" />
            <span className="text-white/70 font-medium">Favorites</span>
          </nav>

          {/* Header */}
          <div className="mb-8">
            <h1 className="font-bebas text-5xl text-white tracking-wide">
              Favorites
            </h1>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => <FavoriteSkeleton key={i} />)}
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
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-stretch">
                {favorites.map((fav) => (
                  <div key={fav.id} className="h-full">
                    <FavoriteCard
                      fav={fav}
                      onRequestDelete={setConfirmDelete}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {confirmDelete && (
        <DeleteModal
          fav={confirmDelete}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  )
}
