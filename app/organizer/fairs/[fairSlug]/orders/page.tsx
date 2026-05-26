'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'

interface OrderItem {
  id: string
  name: string
  quantity: number
  unitPrice: number
  specialInstructions?: string | null
}

interface Order {
  id: string
  status: string
  total: number
  subtotal: number
  vendorPayout: number
  fairSynqFee: number
  placedAt: string
  customerName: string
  customerPhone: string
  fulfillmentType: string
  pickupLocation: string | null
  vendorId: string
  vendorName: string
  boothNumber: string | null
  items: OrderItem[]
}

const STATUS_STYLES: Record<string, string> = {
  PLACED:           'bg-yellow-400/10 text-yellow-400',
  ACCEPTED:         'bg-yellow-400/10 text-yellow-400',
  PREPARING:        'bg-blue-400/10 text-blue-400',
  READY:            'bg-green-400/10 text-green-400',
  RUNNER_COLLECTED: 'bg-green-400/10 text-green-400',
  COMPLETED:        'bg-white/5 text-[#888]',
  DELIVERED:        'bg-white/5 text-[#888]',
  CANCELLED:        'bg-red-400/10 text-red-400',
}

const FILTERS = ['All', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED']
const FILTER_LABELS: Record<string, string> = {
  All: 'All',
  PLACED: 'Placed',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function FairOrdersPage() {
  const params = useParams<{ fairSlug: string }>()
  const fairSlug = params.fairSlug
  const [filter, setFilter] = useState('All')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  const loadOrders = useCallback(() => {
    setLoading(true)
    const url = filter === 'All'
      ? `/api/organizer/fairs/${fairSlug}/orders`
      : `/api/organizer/fairs/${fairSlug}/orders?status=${filter}`
    fetch(url)
      .then(r => r.json())
      .then(d => { if (d.data?.orders) setOrders(d.data.orders) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [fairSlug, filter])

  useEffect(() => { loadOrders() }, [loadOrders])

  const activeCount = orders.filter(o => ['PLACED', 'ACCEPTED', 'PREPARING'].includes(o.status)).length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">Orders</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-sm text-[#666] font-inter">Live — {activeCount} active order{activeCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <button
          onClick={loadOrders}
          className="px-3 py-1.5 text-xs font-inter text-[#888] border border-white/10 rounded-lg hover:text-white hover:border-white/20 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-6 bg-white/5 rounded-lg p-1 max-w-full overflow-x-auto scrollbar-none">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold font-inter whitespace-nowrap transition-colors
              ${filter === f ? 'bg-[#FF0077] text-white' : 'text-[#888] hover:text-white'}`}>
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Orders */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-[#111111] rounded-xl border border-white/5 p-4 sm:p-5 animate-pulse">
              <div className="h-4 w-32 bg-white/5 rounded mb-2" />
              <div className="h-3 w-48 bg-white/5 rounded" />
            </div>
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-[#111111] rounded-xl border border-white/5 p-8 text-center">
          <p className="text-[#666] font-inter text-sm">No orders found{filter !== 'All' ? ` with status "${FILTER_LABELS[filter]}"` : ''}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <div key={order.id} className="bg-[#111111] rounded-xl border border-white/5 p-4 sm:p-5 hover:border-white/10 transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-inter font-medium text-white">Order #{order.id.slice(-6).toUpperCase()}</p>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${STATUS_STYLES[order.status] ?? ''}`}>
                      {order.status}
                    </span>
                  </div>
                  <p className="text-xs text-[#666] font-inter mt-0.5">{order.customerName} · {timeAgo(order.placedAt)}</p>
                </div>
                <p className="text-sm font-semibold text-white tabular-nums">${(order.total ?? 0).toFixed(2)}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {order.items.map(item => (
                  <span key={item.id} className="px-2 py-1 bg-white/5 rounded text-xs text-[#aaa] font-inter">
                    {item.quantity}× {item.name}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-[#666] font-inter">
                  {order.vendorName}{order.boothNumber ? ` · Booth ${order.boothNumber}` : ''}
                </p>
                <span className="text-xs text-[#555] font-inter">{order.fulfillmentType.replace('_', ' ')}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
