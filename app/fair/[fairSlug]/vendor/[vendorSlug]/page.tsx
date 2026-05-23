'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ShoppingBagIcon, BuildingStorefrontIcon } from '@heroicons/react/24/outline'
import { useAuth } from '@clerk/clerk-react'
import { useFair } from '../../../../_contexts/FairContext'
import { useFairCart } from '../../../../_contexts/FairCartContext'
import type { GroupedMenuItem } from '@/lib/menu/getGroupedMenuItems'
import Breadcrumb from '../../_components/Breadcrumb'
import { GroupedFoodCard } from '@/components/menu/GroupedFoodCard'

// ─── Types ────────────────────────────────────────────────────────────────────

interface VendorDetail {
  id: string
  name: string
  cuisineType: string
  description: string | null
  boothNumber: string | null
  logoUrl: string | null
  isBusy: boolean
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

  const { isSignedIn } = useAuth()
  const [vendor, setVendor] = useState<VendorDetail | null>(null)
  // Pre-grouped items — set once in useEffect, never computed in render
  const [groupedItems, setGroupedItems] = useState<GroupedMenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set())

  // Single bulk favorites fetch — one request for all cards
  useEffect(() => {
    if (!isSignedIn) return
    fetch('/api/favorites/ids')
      .then((r) => r.json())
      .then((json) => { if (json.success) setFavoritedIds(new Set(json.data)) })
      .catch(() => {})
  }, [isSignedIn])

  const handleFavoriteToggle = useCallback((menuItemId: string, favorited: boolean) => {
    setFavoritedIds((prev) => {
      const next = new Set(prev)
      favorited ? next.add(menuItemId) : next.delete(menuItemId)
      return next
    })
  }, [])

  useEffect(() => {
    if (!params.vendorSlug || !params.fairSlug) return
    setLoading(true)

    Promise.all([
      fetch(`/api/vendors/${params.vendorSlug}`).then(r => r.json()),
      fetch(`/api/vendors/${params.vendorSlug}/menu`).then(r => r.json()),
    ])
      .then(([vendorJson, menuJson]) => {
        if (!vendorJson.success) { setNotFound(true); setLoading(false); return }
        const raw = vendorJson.data
        setVendor({
          id: raw.id,
          name: raw.name,
          cuisineType: raw.cuisineType,
          description: raw.description ?? null,
          boothNumber: raw.boothNumber ?? null,
          logoUrl: raw.logoUrl ?? null,
          isBusy: raw.isBusy ?? false,
        })
        setGroupedItems(menuJson.data ?? [])
        setLoading(false)
      })
      .catch(() => { setNotFound(true); setLoading(false) })
  }, [params.vendorSlug, params.fairSlug])

  if (loading) return <PageSkeleton accentColor={accentColor} />

  if (notFound || !vendor) {
    return (
      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-20 text-center text-white">
        <BuildingStorefrontIcon className="w-16 h-16 mb-5 mx-auto opacity-20 text-white" />
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

  // Categories derived from pre-grouped state — no computation in render body
  const categories = Array.from(new Set(groupedItems.map((g) => g.category)))

  return (
    <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 sm:py-10 text-white">
      <Breadcrumb crumbs={[
        { label: 'Vendors', href: `/fair/${fair.slug}/vendors` },
        { label: vendor.name },
      ]} />

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

      {/* Menu */}
      {groupedItems.length === 0 ? (
        <div className="text-center py-16 text-text-gray">
          <BuildingStorefrontIcon className="w-14 h-14 mb-4 mx-auto opacity-20 text-white" />
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
              {groupedItems
                .filter((g) => g.category === category)
                .map((group) => (
                  <GroupedFoodCard
                    key={group.groupKey}
                    group={group}
                    accentColor={accentColor}
                    isFavorited={group.variants.some((v) => favoritedIds.has(v.id))}
                    onFavoriteToggle={handleFavoriteToggle}
                  />
                ))}
            </div>
          </section>
        ))
      )}

      {/* Floating cart bar */}
      {itemCount > 0 && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-40">
          <Link
            href={`/fair/${fair.slug}/cart`}
            className="flex items-center gap-3 px-5 py-3 bg-[#FF0077] text-white rounded-full shadow-[0_4px_20px_rgba(255,0,119,0.4)] hover:shadow-[0_4px_30px_rgba(255,0,119,0.5)] hover:bg-[#FF0077]/90 active:scale-[0.97] transition-all duration-200 whitespace-nowrap"
          >
            <ShoppingBagIcon className="w-4 h-4 shrink-0" />
            <span className="text-sm font-semibold">
              View Cart · {itemCount} {itemCount === 1 ? 'item' : 'items'} · ${subtotal.toFixed(2)}
            </span>
          </Link>
        </div>
      )}
    </div>
  )
}
