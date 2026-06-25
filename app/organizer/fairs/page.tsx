'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api-fetcher'
import { OrganizerBreadcrumb } from '../_components/Breadcrumb'

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
  enableBoothPickup: boolean
  enableCurbside: boolean
  enableHomeDelivery: boolean
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function OrganizerFairsPage() {
  const query = useQuery({
    queryKey: ['organizer-fairs-sidebar'],
    queryFn: () => fetchJson<{ fairs: Fair[] }>('/api/organizer/fairs'),
  })
  const fairs = query.data?.fairs ?? []
  const loading = query.isPending

  return (
    <div>
      <OrganizerBreadcrumb crumbs={[{ label: 'My Fairs' }]} />
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
            <div key={fair.id} className="bg-[#111111] border border-white/5 rounded-xl overflow-hidden hover:border-white/10 transition-colors">
              <div className="flex items-center gap-3 p-4 min-w-0">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bebas text-xl bg-[#FF0077]/20 text-[#FF0077]">
                    {fair.name[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white text-sm truncate">{fair.name}</p>
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase
                        ${fair.status === 'ACTIVE' ? 'bg-green-500/15 text-green-400' : 'bg-sky-500/15 text-sky-400'}`}>
                        {fair.status}
                      </span>
                    </div>
                    <p className="text-xs text-[#666] font-inter truncate mt-0.5">
                      {formatDate(fair.startDate)} · {fair.vendorCount} vendors · {fair.orderCount} orders
                    </p>
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {fair.enableBoothPickup && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] text-white/40">Booth Pickup</span>
                      )}
                      {fair.enableCurbside && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] text-white/40">Curbside</span>
                      )}
                      {fair.enableHomeDelivery && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] text-white/40">Home Delivery</span>
                      )}
                    </div>
                  </div>
                </div>
                <Link
                  href={`/organizer/fairs/${fair.slug}`}
                  className="shrink-0 px-3 py-1.5 bg-white/[0.05] hover:bg-white/[0.08] border border-white/10 rounded-lg text-white/70 text-xs font-semibold whitespace-nowrap transition-colors"
                >
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
