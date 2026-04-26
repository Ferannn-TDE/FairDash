'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ShoppingBagIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useFair } from '../../../../_contexts/FairContext'
import { useFairCart } from '../../../../_contexts/FairCartContext'
import { getVendorBySlug } from '@/lib/mock'
import Breadcrumb from '../../_components/Breadcrumb'
import FoodCard from '@/components/ui/FoodCard'

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

// ── Wrapper connecting FoodCard to cart context ────────────────────────────────

function MenuItemCard({ item, vendor, accentColor }: { item: DisplayMenuItem; vendor: VendorDetail; accentColor: string }) {
  const { addItem, items, updateQty } = useFairCart()
  const qty = items.find((i) => i.menuItemId === item.id)?.quantity ?? 0

  const handleAdd = () => {
    addItem(
      { id: item.id, name: item.name, price: item.price, prepTime: item.prepTime ?? undefined, imageUrl: item.imageUrl },
      { id: vendor.id, name: vendor.name },
    )
    toast.success(`${item.name} added`)
  }

  return (
    <FoodCard
      variant="menu-item"
      id={item.id}
      name={item.name}
      description={item.description}
      price={item.price}
      imageUrl={item.imageUrl}
      prepTime={item.prepTime}
      available={item.available}
      accentColor={accentColor}
      qty={qty}
      onAdd={handleAdd}
      onDecrement={() => updateQty(item.id, qty - 1)}
    />
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
    if (!params.vendorSlug || !params.fairSlug) return
    setLoading(true)

    // Look up from mock data (slug-based). Falls through to API when backend is ready.
    const mockV = getVendorBySlug(params.fairSlug, params.vendorSlug)
    if (mockV) {
      setVendor({
        id: mockV.id,
        name: mockV.name,
        cuisineType: mockV.cuisineType,
        description: mockV.description ?? null,
        boothNumber: mockV.boothNumber ?? null,
        logoUrl: mockV.logoUrl ?? null,
        isBusy: mockV.isBusy ?? false,
        menu: mockV.menu.map((item): DisplayMenuItem => ({
          id: item.id,
          name: item.name,
          description: item.description ?? null,
          price: item.price,
          category: item.category,
          imageUrl: item.imageUrl ?? null,
          prepTime: item.prepTime ?? null,
          available: item.available ?? true,
        })),
      })
      setLoading(false)
      return
    }

    // API upgrade path — used when real backend is available
    fetch(`/api/vendors/${params.vendorSlug}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) { setNotFound(true); setLoading(false); return }
        const raw = json.data
        setVendor({
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
        })
        setLoading(false)
      })
      .catch(() => { setNotFound(true); setLoading(false) })
  }, [params.vendorSlug, params.fairSlug])

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

      {/* Menu — always full-width, never affected by cart state */}
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

      {/* Floating cart bar — fixed position, never affects page flow */}
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
