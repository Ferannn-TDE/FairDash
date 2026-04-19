'use client'

import { useState } from 'react'
import { PlusIcon, EllipsisHorizontalIcon } from '@heroicons/react/24/outline'
import { mockVendorsForFair } from '@/lib/mock/organizer'

type VendorStatus = 'active' | 'pending' | 'invited' | 'declined'

const TABS: { key: VendorStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending' },
  { key: 'invited', label: 'Invited' },
  { key: 'declined', label: 'Declined' },
]

const STATUS_STYLES: Record<VendorStatus, string> = {
  active:   'bg-green-500/15 text-green-400',
  pending:  'bg-yellow-500/15 text-yellow-400',
  invited:  'bg-sky-500/15 text-sky-400',
  declined: 'bg-red-500/15 text-red-400',
}

export default function VendorManagementPage() {
  const [activeTab, setActiveTab] = useState<VendorStatus | 'all'>('all')

  const vendors = activeTab === 'all' ? mockVendorsForFair : mockVendorsForFair.filter(v => (v.status as string) === activeTab)
  const counts = {
    all: mockVendorsForFair.length,
    active: mockVendorsForFair.filter(v => v.status === 'active').length,
    pending: mockVendorsForFair.filter(v => v.status === 'pending').length,
    invited: mockVendorsForFair.filter(v => v.status === 'invited').length,
    declined: mockVendorsForFair.filter(v => (v.status as string) === 'declined').length,
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">Vendors</h1>
          <p className="text-sm text-[#666] font-inter mt-1">{counts.active} of 50 vendor slots filled</p>
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
      <div className="bg-[#111111] rounded-xl border border-white/5 divide-y divide-white/5">
        {vendors.map(vendor => (
          <div key={vendor.id} className="flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-[#FF0077]/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-bebas text-[#FF0077]">{vendor.name[0]}</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-inter font-medium text-white truncate">{vendor.name}</p>
                <p className="text-xs text-[#666] font-inter">
                  {vendor.cuisine}
                  {vendor.booth && ` · Booth ${vendor.booth}`}
                  {vendor.ordersTotal > 0 && ` · ${vendor.ordersTotal} orders · $${vendor.revenueTotal.toLocaleString()}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${STATUS_STYLES[vendor.status]}`}>
                {vendor.status}
              </span>
              <button className="p-1.5 rounded-lg hover:bg-white/5 transition-colors">
                <EllipsisHorizontalIcon className="w-4 h-4 text-[#666]" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
