'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { PlusIcon, EllipsisHorizontalIcon } from '@heroicons/react/24/outline'

interface Vendor {
  id: string
  name: string
  status: string
  category: string
  boothNumber: string | null
  logoUrl: string | null
  joinedAt: string
  orderCount: number
  revenue: number
}

type TabKey = 'all' | 'ACTIVE' | 'PENDING' | 'PAUSED' | 'SUSPENDED' | 'REJECTED'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'PAUSED', label: 'Paused' },
  { key: 'SUSPENDED', label: 'Suspended' },
  { key: 'REJECTED', label: 'Rejected' },
]

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:    'bg-green-500/15 text-green-400',
  PENDING:   'bg-yellow-500/15 text-yellow-400',
  PAUSED:    'bg-sky-500/15 text-sky-400',
  SUSPENDED: 'bg-orange-500/15 text-orange-400',
  REJECTED:  'bg-red-500/15 text-red-400',
}

export default function VendorManagementPage() {
  const params = useParams<{ fairId: string }>()
  const fairId = params.fairId
  const [activeTab, setActiveTab] = useState<TabKey>('all')
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/organizer/fair/${fairId}/vendors`)
      .then(r => r.json())
      .then(d => { if (d.data?.vendors) setVendors(d.data.vendors) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [fairId])

  const filtered = activeTab === 'all' ? vendors : vendors.filter(v => v.status === activeTab)
  const counts: Record<TabKey, number> = {
    all: vendors.length,
    ACTIVE:    vendors.filter(v => v.status === 'ACTIVE').length,
    PENDING:   vendors.filter(v => v.status === 'PENDING').length,
    PAUSED:    vendors.filter(v => v.status === 'PAUSED').length,
    SUSPENDED: vendors.filter(v => v.status === 'SUSPENDED').length,
    REJECTED:  vendors.filter(v => v.status === 'REJECTED').length,
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">Vendors</h1>
          <p className="text-sm text-[#666] font-inter mt-1">
            {loading ? 'Loading…' : `${counts.ACTIVE} active vendor${counts.ACTIVE !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#FF0077] text-white text-sm font-semibold rounded-lg hover:bg-[#e0006b] transition-colors whitespace-nowrap">
          <PlusIcon className="w-4 h-4" /> Invite Vendor
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 mb-6 bg-white/5 rounded-lg p-1 max-w-full overflow-x-auto scrollbar-none">
        {TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold font-inter whitespace-nowrap transition-colors
              ${activeTab === key ? 'bg-[#FF0077] text-white' : 'text-[#888] hover:text-white'}`}>
            {label} <span className="ml-1 opacity-60">{counts[key]}</span>
          </button>
        ))}
      </div>

      {/* Vendor list */}
      {loading ? (
        <div className="bg-[#111111] rounded-xl border border-white/5 divide-y divide-white/5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white/5 shrink-0" />
                <div>
                  <div className="h-4 w-32 bg-white/5 rounded mb-2" />
                  <div className="h-3 w-48 bg-white/5 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#111111] rounded-xl border border-white/5 p-8 text-center">
          <p className="text-[#666] font-inter text-sm">No vendors found{activeTab !== 'all' ? ` with status "${activeTab}"` : ''}.</p>
        </div>
      ) : (
        <div className="bg-[#111111] rounded-xl border border-white/5 divide-y divide-white/5">
          {filtered.map(vendor => (
            <div key={vendor.id} className="flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-[#FF0077]/10 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bebas text-[#FF0077]">{vendor.name[0]}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-inter font-medium text-white truncate">{vendor.name}</p>
                  <p className="text-xs text-[#666] font-inter">
                    {vendor.category}
                    {vendor.boothNumber && ` · Booth ${vendor.boothNumber}`}
                    {vendor.orderCount > 0 && ` · ${vendor.orderCount} orders · $${vendor.revenue.toLocaleString()}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${STATUS_STYLES[vendor.status] ?? ''}`}>
                  {vendor.status}
                </span>
                <button className="p-1.5 rounded-lg hover:bg-white/5 transition-colors">
                  <EllipsisHorizontalIcon className="w-4 h-4 text-[#666]" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
