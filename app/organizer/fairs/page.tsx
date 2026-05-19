'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Fair {
  id: string
  name: string
  slug: string
  status: string
  startDate: string
  endDate: string
  vendorCount: number
  orderCount: number
  totalRevenue: number
  pendingOrders: number
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function OrganizerFairsPage() {
  const [fairs, setFairs] = useState<Fair[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/organizer/fairs')
      .then(r => r.json())
      .then(d => { if (d.data?.fairs) setFairs(d.data.fairs) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">My Fairs</h1>
          <p className="text-sm text-[#666] font-inter mt-1">
            {loading ? 'Loading…' : `${fairs.length} fair${fairs.length !== 1 ? 's' : ''} total`}
          </p>
        </div>
        <Link href="/organizer/fairs/new" className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 bg-[#FF0077] text-white text-sm font-semibold rounded-lg hover:bg-[#e0006b] transition-colors whitespace-nowrap">
          + Create Fair
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-[#111111] border border-white/5 rounded-xl p-4 sm:p-5 animate-pulse flex items-center gap-3">
              <div className="w-10 h-10 bg-white/5 rounded-xl shrink-0" />
              <div className="flex-1">
                <div className="h-4 w-40 bg-white/5 rounded mb-2" />
                <div className="h-3 w-64 bg-white/5 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : fairs.length === 0 ? (
        <div className="bg-[#111111] border border-white/5 rounded-xl p-8 text-center">
          <p className="text-[#666] font-inter text-sm">No fairs yet. Create your first fair to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {fairs.map(fair => (
            <div key={fair.id} className="bg-[#111111] border border-white/5 rounded-xl p-4 sm:p-5 flex items-center gap-3 hover:border-white/10 transition-colors">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bebas text-xl bg-[#FF0077]/20 text-[#FF0077]">
                  {fair.name[0]}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{fair.name}</p>
                  <p className="text-xs text-[#666] font-inter truncate">
                    {formatDate(fair.startDate)} – {formatDate(fair.endDate)} · {fair.vendorCount} vendors · {fair.orderCount} orders
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`hidden sm:inline-flex px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase
                  ${fair.status === 'ACTIVE' ? 'bg-green-500/15 text-green-400' : 'bg-sky-500/15 text-sky-400'}`}>
                  {fair.status}
                </span>
                <Link href={`/organizer/fair/${fair.id}`} className="px-3 py-1.5 text-xs font-inter text-[#888] border border-white/10 rounded-lg hover:text-white hover:border-white/20 transition-colors whitespace-nowrap">
                  Manage →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
