'use client'

import { useState, useEffect, useMemo, use } from 'react'
import {
  DocumentTextIcon,
} from '@heroicons/react/24/outline'
import { Store, AlertTriangle } from 'lucide-react'

// ─── Types (real /api/admin/events/[id]/vendors shape via getFairVendors) ──────

interface AdminVendor {
  id: string
  name: string
  status: string
  cuisineType: string | null
  boothNumber: string | null
  stripeVerified: boolean
  isOffline: boolean
  isBusy: boolean
  docs: { foodHandlerPermit: boolean; insurance: boolean; insuranceExpired: boolean; businessLicense: boolean }
  orderCount: number
  ordersToday: number
  revenue: number
  ready: boolean
}

type FilterTab = 'all' | 'PENDING' | 'ACTIVE'

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:    'bg-green-500/15 text-green-400',
  PENDING:   'bg-yellow-500/15 text-yellow-400',
  INACTIVE:  'bg-white/5 text-[#888]',
  SUSPENDED: 'bg-red-500/15 text-red-400',
  REJECTED:  'bg-red-500/15 text-red-400',
}

function DocBadge({ present, label }: { present: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase
      ${present ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
      <DocumentTextIcon className="w-3 h-3" />
      {label}
    </span>
  )
}

export default function AdminVendorsPage({ params: paramsPromise }: { params: Promise<{ eventSlug: string }> }) {
  const params = use(paramsPromise)
  const [vendors, setVendors] = useState<AdminVendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<FilterTab>('all')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetch(`/api/admin/events/${params.eventSlug}/vendors?take=200`)
      .then(r => r.json())
      .then(json => {
        if (!active) return
        if (!json.success) { setError(json.error?.message ?? 'Failed to load vendors'); return }
        setVendors((json.data.vendors ?? []) as AdminVendor[])
      })
      .catch(() => { if (active) setError('Failed to load vendors') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [params.eventSlug])

  const filtered = useMemo(
    () => tab === 'all' ? vendors : vendors.filter(v => v.status === tab),
    [vendors, tab]
  )
  const pendingCount = vendors.filter(v => v.status === 'PENDING').length
  const activeCount  = vendors.filter(v => v.status === 'ACTIVE').length

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">Vendors</h1>
          <p className="text-sm text-[#666] font-inter mt-1">
            {loading ? 'Loading…' : `${activeCount} active`}
            {pendingCount > 0 && (
              <span className="ml-2 px-1.5 py-0.5 bg-yellow-500/15 text-yellow-400 text-[10px] font-semibold rounded">
                {pendingCount} pending review
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 bg-white/5 rounded-lg p-1 w-fit">
        {(['all', 'PENDING', 'ACTIVE'] as FilterTab[]).map(key => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold font-inter whitespace-nowrap transition-colors
              ${tab === key ? 'bg-[#FF0077] text-white' : 'text-[#888] hover:text-white'}`}
          >
            {key === 'all' ? 'All' : key.charAt(0) + key.slice(1).toLowerCase()}
            <span className="ml-1 opacity-60">
              {key === 'all' ? vendors.length : vendors.filter(v => v.status === key).length}
            </span>
          </button>
        ))}
      </div>

      {/* Vendor list */}
      {error ? (
        <div className="bg-[#111111] border border-red-500/20 rounded-xl py-12 text-center">
          <AlertTriangle className="w-8 h-8 text-red-400/40 mx-auto mb-2" />
          <p className="text-white font-semibold text-sm mb-1">Couldn’t load vendors</p>
          <p className="text-[#666] text-xs">{error}</p>
        </div>
      ) : loading ? (
        <div className="bg-[#111111] border border-white/5 rounded-xl py-12 text-center">
          <Store className="w-8 h-8 text-white/10 mx-auto mb-2 animate-pulse" />
          <p className="text-[#666] text-xs">Loading vendors…</p>
        </div>
      ) : (
        <div className="bg-[#111111] rounded-xl border border-white/5 divide-y divide-white/5">
          {filtered.map(vendor => (
            <div key={vendor.id} className="flex items-center justify-between gap-3 p-4 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-lg bg-[#FF0077]/10 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bebas text-[#FF0077]">{vendor.name[0]}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-inter font-medium text-white truncate">{vendor.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {vendor.cuisineType && <span className="text-xs text-[#666] font-inter">{vendor.cuisineType}</span>}
                    {vendor.boothNumber && (
                      <span className="text-xs text-[#555] font-inter">· Booth {vendor.boothNumber}</span>
                    )}
                    <DocBadge present={vendor.docs.foodHandlerPermit} label="Permit" />
                    <DocBadge present={vendor.docs.insurance} label="Insurance" />
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="hidden md:block shrink-0 text-right">
                <p className="text-sm text-white font-inter tabular-nums">${vendor.revenue.toFixed(2)}</p>
                <p className="text-[10px] text-[#555] font-inter">{vendor.ordersToday} today · {vendor.orderCount} total</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!vendor.ready && vendor.status === 'ACTIVE' && (
                  <span className="hidden sm:inline px-2 py-0.5 bg-orange-500/15 text-orange-400 text-[10px] font-semibold rounded uppercase">Not live</span>
                )}
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${STATUS_STYLES[vendor.status] ?? STATUS_STYLES.INACTIVE}`}>
                  {vendor.status}
                </span>
                {vendor.stripeVerified
                  ? <span className="hidden sm:inline px-2 py-0.5 bg-green-500/15 text-green-400 text-[10px] font-semibold rounded uppercase">Stripe ✓</span>
                  : <span className="hidden sm:inline px-2 py-0.5 bg-white/5 text-[#555] text-[10px] font-semibold rounded uppercase">No Stripe</span>
                }
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm text-[#555] font-inter">No vendors in this category.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
