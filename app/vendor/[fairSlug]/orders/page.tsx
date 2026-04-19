'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'

interface VendorOrder {
  id: string
  customer: string
  items: string
  total: number
  status: string
  time: string
  fulfillmentType: string
}

const ORDER_NEXT_STATUS: Record<string, string> = {
  PLACED:    'ACCEPTED',
  ACCEPTED:  'PREPARING',
  PREPARING: 'READY',
  READY:     'COMPLETED',
}

const ORDER_ACTION_LABEL: Record<string, string> = {
  PLACED:    'Accept',
  ACCEPTED:  'Start Preparing',
  PREPARING: 'Mark Ready',
  READY:     'Mark Completed',
}

const STATUS_STYLES: Record<string, string> = {
  PLACED:      'bg-neon-pink/10 text-neon-pink border-neon-pink/20',
  ACCEPTED:    'bg-amber-500/10 text-amber-400 border-amber-500/20',
  PREPARING:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  READY:       'bg-blue-500/10 text-blue-400 border-blue-500/20',
  COMPLETED:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  DELIVERED:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  CANCELLED:   'bg-red-500/10 text-red-400 border-red-500/20',
  UNCOLLECTED: 'bg-red-500/10 text-red-400 border-red-500/20',
}

const STATUS_LABELS: Record<string, string> = {
  PLACED: 'New', ACCEPTED: 'Accepted', PREPARING: 'Preparing',
  READY: 'Ready', COMPLETED: 'Completed', DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled', UNCOLLECTED: 'Uncollected',
}

function normalizeOrder(o: any): VendorOrder {
  return {
    id: o.id,
    customer: o.customerName ?? '—',
    items: o.orderItems
      ? o.orderItems.map((i: any) => `${i.menuItem?.name ?? 'Item'} ×${i.quantity}`).join(', ')
      : '—',
    total: o.total ?? 0,
    status: o.status,
    time: new Date(o.placedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    fulfillmentType: o.fulfillmentType,
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[0.6875rem] font-semibold border ${STATUS_STYLES[status] ?? 'bg-white/5 text-text-gray border-white/10'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

export default function VendorOrdersPage() {
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [orders, setOrders] = useState<VendorOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('all')
  const [since, setSince] = useState<string>(() => {
    const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString()
  })

  useEffect(() => {
    fetch('/api/vendors/me')
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) { setLoading(false); return }
        const id = json.data.vendor.id as string
        setVendorId(id)
        return fetch(`/api/vendors/${id}/orders?limit=200&since=${since}`)
      })
      .then((r) => r?.json())
      .then((json) => {
        if (json?.success) setOrders(json.data.orders.map(normalizeOrder))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [since])

  const handleUpdateStatus = useCallback(async (orderId: string, newStatus: string) => {
    setUpdatingIds((prev) => new Set(prev).add(orderId))
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message || 'Update failed')
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: newStatus } : o))
      toast.success(`Order updated to ${STATUS_LABELS[newStatus] ?? newStatus}`)
    } catch (err: any) {
      toast.error(err.message || 'Could not update order')
    } finally {
      setUpdatingIds((prev) => { const s = new Set(prev); s.delete(orderId); return s })
    }
  }, [])

  const filtered = filter === 'all' ? orders : orders.filter((o) => o.status === filter)

  const filterOptions = [
    { value: 'all',       label: `All (${orders.length})` },
    { value: 'PLACED',    label: 'New' },
    { value: 'PREPARING', label: 'Preparing' },
    { value: 'READY',     label: 'Ready' },
    { value: 'COMPLETED', label: 'Completed' },
    { value: 'CANCELLED', label: 'Cancelled' },
  ]

  const dateOptions = [
    { label: 'Today',      value: (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString() })() },
    { label: 'Last 7 days', value: (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 7); d.setUTCHours(0, 0, 0, 0); return d.toISOString() })() },
    { label: 'Last 30 days', value: (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 30); d.setUTCHours(0, 0, 0, 0); return d.toISOString() })() },
  ]

  return (
    <div className="p-6 md:p-4 sm:p-3 max-w-[78rem] mx-auto">
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight mb-1">
            Order <span className="text-neon-pink">History</span>
          </h1>
          <p className="text-text-gray text-sm">{orders.length} orders in selected period</p>
        </div>
        {/* Period selector */}
        <div className="flex gap-1.5 flex-wrap">
          {dateOptions.map((d) => (
            <button
              key={d.label}
              onClick={() => setSince(d.value)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all duration-200 ${
                since === d.value
                  ? 'bg-neon-pink border-neon-pink text-white'
                  : 'bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
        {/* Filter tabs */}
        <div className="p-5 border-b border-white/10 flex gap-1.5 flex-wrap">
          {filterOptions.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1 rounded-full text-[0.6875rem] font-semibold border cursor-pointer transition-all duration-200 ${
                filter === f.value
                  ? 'bg-neon-pink border-neon-pink text-white'
                  : 'bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="p-8 space-y-3 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-4 bg-white/10 rounded w-24" />
                <div className="h-4 bg-white/5 rounded w-32" />
                <div className="h-4 bg-white/5 rounded flex-1" />
                <div className="h-4 bg-white/10 rounded w-16" />
                <div className="h-6 bg-white/10 rounded-full w-20" />
                <div className="h-4 bg-white/5 rounded w-12" />
              </div>
            ))}
          </div>
        ) : !vendorId ? (
          <div className="py-20 text-center px-6">
            <ExclamationTriangleIcon className="w-10 h-10 text-amber-400/60 mx-auto mb-3" />
            <p className="text-white font-semibold text-sm">No vendor found</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              {filtered.length === 0 ? (
                <div className="py-16 text-center text-text-gray text-sm">No orders match this filter.</div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5">
                      {['Order ID', 'Customer', 'Items', 'Total', 'Status', 'Time', 'Fulfillment', 'Action'].map((h) => (
                        <th key={h} className="text-left text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold px-6 py-3 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((order) => {
                      const isUpdating = updatingIds.has(order.id)
                      return (
                        <tr key={order.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors duration-150">
                          <td className="px-6 py-4 text-sm font-bold text-white whitespace-nowrap">#{order.id.slice(-8).toUpperCase()}</td>
                          <td className="px-6 py-4 text-sm text-text-gray whitespace-nowrap">{order.customer}</td>
                          <td className="px-6 py-4 text-sm text-white/70 max-w-[180px] truncate">{order.items}</td>
                          <td className="px-6 py-4 text-sm font-bold text-neon-pink whitespace-nowrap">${order.total.toFixed(2)}</td>
                          <td className="px-6 py-4 whitespace-nowrap"><StatusBadge status={order.status} /></td>
                          <td className="px-6 py-4 text-xs text-text-gray whitespace-nowrap">{order.time}</td>
                          <td className="px-6 py-4 text-xs text-text-gray whitespace-nowrap capitalize">
                            {order.fulfillmentType?.toLowerCase().replace(/_/g, ' ') ?? '—'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {ORDER_NEXT_STATUS[order.status] ? (
                              <button
                                disabled={isUpdating}
                                onClick={() => handleUpdateStatus(order.id, ORDER_NEXT_STATUS[order.status])}
                                className="px-3 py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-neon-pink/10 hover:border-neon-pink/30 hover:text-neon-pink transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isUpdating ? '…' : ORDER_ACTION_LABEL[order.status]}
                              </button>
                            ) : <span className="text-text-gray/40 text-xs">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-white/5">
              {filtered.length === 0 ? (
                <div className="py-12 text-center text-text-gray text-sm">No orders match this filter.</div>
              ) : filtered.map((order) => {
                const isUpdating = updatingIds.has(order.id)
                return (
                  <div key={order.id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-bold text-white text-sm">#{order.id.slice(-8).toUpperCase()}</p>
                        <p className="text-text-gray text-xs">{order.customer} · {order.time}</p>
                      </div>
                      <StatusBadge status={order.status} />
                    </div>
                    <p className="text-white/60 text-xs mb-3 line-clamp-2">{order.items}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-neon-pink font-bold text-sm">${order.total.toFixed(2)}</span>
                      {ORDER_NEXT_STATUS[order.status] && (
                        <button
                          disabled={isUpdating}
                          onClick={() => handleUpdateStatus(order.id, ORDER_NEXT_STATUS[order.status])}
                          className="px-3 py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-neon-pink/10 hover:border-neon-pink/30 hover:text-neon-pink transition-all duration-200 disabled:opacity-50"
                        >
                          {isUpdating ? '…' : ORDER_ACTION_LABEL[order.status]}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
