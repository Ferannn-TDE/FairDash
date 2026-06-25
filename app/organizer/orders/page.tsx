'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api-fetcher'
import { OrganizerBreadcrumb } from '../_components/Breadcrumb'

interface OrderItem {
  id: string
  name: string
  quantity: number
  unitPrice: number
}

interface Order {
  id: string
  status: string
  total: number
  subtotal: number
  placedAt: string
  customerName: string
  vendorName: string
  boothNumber: string | null
  fairName: string
  items: OrderItem[]
}

const STATUS_FILTERS = ['All', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED']

const STATUS_STYLES: Record<string, string> = {
  PLACED:    'bg-yellow-500/15 text-yellow-400',
  ACCEPTED:  'bg-blue-500/15 text-blue-400',
  PREPARING: 'bg-orange-500/15 text-orange-400',
  READY:     'bg-purple-500/15 text-purple-400',
  COMPLETED: 'bg-green-500/15 text-green-400',
  CANCELLED: 'bg-red-500/15 text-red-400',
}

const STATUS_LABELS: Record<string, string> = {
  PLACED:    'Placed',
  ACCEPTED:  'Accepted',
  PREPARING: 'Preparing',
  READY:     'Ready',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLES[status] ?? 'bg-white/10 text-white/40'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

export default function OrganizerOrdersPage() {
  const query = useQuery({
    queryKey: ['organizer-orders-global'],
    queryFn: () => fetchJson<{ orders: Order[] }>('/api/organizer/orders?limit=100'),
  })
  const orders = query.data?.orders ?? []
  const loading = query.isPending
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')

  const filtered = orders.filter(o => {
    const matchesStatus = filter === 'All' || o.status === filter
    const matchesSearch = !search ||
      o.id.slice(-6).toLowerCase().includes(search.toLowerCase()) ||
      o.customerName?.toLowerCase().includes(search.toLowerCase()) ||
      o.vendorName?.toLowerCase().includes(search.toLowerCase())
    return matchesStatus && matchesSearch
  })

  return (
    <div className="max-w-5xl mx-auto">
      <OrganizerBreadcrumb crumbs={[{ label: 'Order Feed' }]} />
      <h1 className="font-bebas text-3xl text-white tracking-wide mb-1">
        Order <span className="text-[#FF0077]">Feed</span>
      </h1>
      <p className="text-white/40 text-sm mb-6 font-inter">Live orders across all your fairs</p>

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by order #, customer, or vendor…"
        className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-white/30 focus:border-[#FF0077] outline-none mb-4 font-inter"
      />

      {/* Status filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-5 scrollbar-hide">
        {STATUS_FILTERS.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              filter === s
                ? 'bg-[#FF0077] border-[#FF0077] text-white'
                : 'border-white/10 text-white/50 hover:text-white/80 hover:border-white/20'
            }`}
          >
            {STATUS_LABELS[s] ?? s}
          </button>
        ))}
      </div>

      <p className="text-white/30 text-xs mb-3 font-inter">{loading ? '…' : `${filtered.length} orders`}</p>

      <div className="space-y-2">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 bg-white/[0.03] rounded-xl animate-pulse" />
          ))
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-white/30 font-inter text-sm">
            No orders found
          </div>
        ) : (
          filtered.map(order => (
            <div
              key={order.id}
              className="bg-[#1a1a1a] border border-white/[0.07] rounded-xl p-4 flex items-center justify-between gap-3 min-w-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-white font-bold text-sm font-inter">
                    #{order.id.slice(-6).toUpperCase()}
                  </span>
                  <StatusBadge status={order.status} />
                  <span className="text-white/30 text-xs font-inter truncate">
                    {order.vendorName}
                  </span>
                </div>
                <p className="text-white/40 text-xs font-inter truncate">
                  {order.customerName}
                  {order.items?.length > 0 && (
                    <> · {order.items[0].name}{order.items.length > 1 ? ` +${order.items.length - 1}` : ''}</>
                  )}
                  {' · '}{formatTime(order.placedAt)}
                </p>
              </div>
              <span className="text-[#FF0077] font-bold text-sm shrink-0 font-inter">
                ${(order.total ?? order.subtotal ?? 0).toFixed(2)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
