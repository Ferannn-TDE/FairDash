'use client'

import { useState, useEffect, useCallback } from 'react'
import { OrganizerBreadcrumb } from '../_components/Breadcrumb'

interface Vendor {
  id: string
  name: string
  cuisineType: string
  boothNumber: string | null
  isOffline: boolean
  status: string
  fairName: string
  orderCount: number
  revenue: number
}

export default function OrganizerVendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<Vendor | null>(null)

  useEffect(() => {
    fetch('/api/organizer/vendors')
      .then(r => r.json())
      .then(json => { if (Array.isArray(json.data)) setVendors(json.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleToggleOffline = useCallback(async (vendor: Vendor) => {
    setTogglingId(vendor.id)
    const next = !vendor.isOffline
    setVendors(prev => prev.map(v => v.id === vendor.id ? { ...v, isOffline: next } : v))
    try {
      await fetch(`/api/vendors/${vendor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isOffline: next }),
      })
    } catch {
      // Revert on error
      setVendors(prev => prev.map(v => v.id === vendor.id ? { ...v, isOffline: !next } : v))
    } finally {
      setTogglingId(null)
    }
  }, [])

  const online  = vendors.filter(v => !v.isOffline).length
  const offline = vendors.filter(v => v.isOffline).length

  return (
    <div className="max-w-5xl mx-auto">
      <OrganizerBreadcrumb crumbs={[{ label: 'Vendor Management' }]} />
      <h1 className="font-bebas text-3xl text-white tracking-wide mb-1">
        Vendor <span className="text-[#FF0077]">Management</span>
      </h1>
      <p className="text-white/40 text-sm mb-2 font-inter">All vendors across your fairs</p>

      {!loading && vendors.length > 0 && (
        <div className="flex gap-4 mb-6 text-sm font-inter">
          <span className="text-green-400">{online} online</span>
          <span className="text-white/20">·</span>
          <span className="text-red-400">{offline} offline</span>
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 bg-white/[0.03] rounded-xl animate-pulse" />
          ))
        ) : vendors.length === 0 ? (
          <div className="text-center py-16 text-white/30 font-inter text-sm">
            No vendors found
          </div>
        ) : (
          vendors.map(vendor => (
            <div
              key={vendor.id}
              className="bg-[#1a1a1a] border border-white/[0.07] rounded-xl p-4 flex items-center gap-3 min-w-0"
            >
              {/* Avatar */}
              <div className="w-10 h-10 rounded-xl bg-[#FF0077]/20 flex items-center justify-center font-bebas text-[#FF0077] text-lg shrink-0">
                {vendor.name.charAt(0)}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <p className="text-white font-semibold text-sm truncate">{vendor.name}</p>
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    vendor.isOffline
                      ? 'bg-red-500/15 text-red-400'
                      : 'bg-green-500/15 text-green-400'
                  }`}>
                    {vendor.isOffline ? 'Offline' : 'Online'}
                  </span>
                </div>
                <p className="text-white/40 text-xs font-inter truncate">
                  {vendor.cuisineType} · {vendor.fairName}
                  {vendor.boothNumber && ` · Booth ${vendor.boothNumber}`}
                </p>
                <p className="text-white/25 text-xs font-inter mt-0.5">
                  {vendor.orderCount} orders · ${vendor.revenue.toFixed(0)} revenue
                </p>
              </div>

              {/* Toggle button */}
              <button
                disabled={togglingId === vendor.id}
                onClick={() => setConfirmTarget(vendor)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-40 ${
                  vendor.isOffline
                    ? 'border-green-500/30 text-green-400 hover:bg-green-500/10'
                    : 'border-red-500/30 text-red-400 hover:bg-red-500/10'
                }`}
              >
                {vendor.isOffline ? 'Bring Online' : 'Mark Offline'}
              </button>
            </div>
          ))
        )}
      </div>
      {confirmTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-sm p-6">
            <h3 className="font-bebas text-xl text-white mb-1">
              {confirmTarget.isOffline ? 'Bring Vendor Online?' : 'Mark Vendor Offline?'}
            </h3>
            <p className="text-white/50 text-sm mb-2">{confirmTarget.name}</p>
            <p className="text-white/40 text-sm mb-6">
              {confirmTarget.isOffline
                ? 'This vendor will appear on the customer menu immediately.'
                : 'This vendor will be hidden from the customer menu immediately. Any pending orders will remain active.'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={() => { handleToggleOffline(confirmTarget); setConfirmTarget(null) }}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-bold ${
                  confirmTarget.isOffline ? 'bg-green-600 hover:bg-green-700' : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                {confirmTarget.isOffline ? 'Bring Online' : 'Mark Offline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
