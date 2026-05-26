'use client'

import { useState, useMemo } from 'react'
import { Search, ChevronDown, ChevronUp, Package, User, Store, Clock, ArrowUpDown } from 'lucide-react'
import { mockAdminOrders, type MockAdminOrder, type AdminOrderStatus } from '@/lib/mock/admin'

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_META: Record<AdminOrderStatus, { label: string; cls: string }> = {
  PLACED:    { label: 'New',       cls: 'bg-neon-pink/10 text-neon-pink border-neon-pink/20' },
  ACCEPTED:  { label: 'Accepted',  cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  PREPARING: { label: 'Preparing', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  READY:     { label: 'Ready',     cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  COMPLETED: { label: 'Completed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  REFUNDED:  { label: 'Refunded',  cls: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
}

const FULFILLMENT_LABEL: Record<string, string> = {
  BOOTH_PICKUP:  'Booth Pickup',
  CURBSIDE:      'Curbside',
  HOME_DELIVERY: 'Home Delivery',
}

const FILTER_TABS = [
  { value: 'all',       label: 'All' },
  { value: 'active',    label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'REFUNDED',  label: 'Refunded' },
] as const

const ACTIVE_STATUSES = new Set(['PLACED', 'ACCEPTED', 'PREPARING', 'READY'])

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AdminOrderStatus }) {
  const meta = STATUS_META[status]
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[0.6875rem] font-semibold border ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

function OrderRow({ order }: { order: MockAdminOrder }) {
  const [expanded, setExpanded] = useState(false)
  const placedTime = new Date(order.placedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden bg-bg-card">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.02] transition-colors text-left cursor-pointer"
      >
        <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
          <span className="font-bold text-white text-sm">#{order.id.slice(-8).toUpperCase()}</span>
          <StatusBadge status={order.status} />
          <span className="text-xs text-text-gray hidden sm:inline">{FULFILLMENT_LABEL[order.fulfillmentType]}</span>
        </div>
        <div className="hidden sm:flex items-center gap-4 text-sm shrink-0">
          <span className="text-text-gray text-xs flex items-center gap-1">
            <User className="w-3 h-3" />
            {order.customerName}
          </span>
          <span className="text-text-gray text-xs flex items-center gap-1">
            <Store className="w-3 h-3" />
            {order.vendorName}
          </span>
          <span className="text-text-gray text-xs flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {placedTime}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-bold text-neon-pink text-sm">${(order.total ?? 0).toFixed(2)}</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-text-gray" /> : <ChevronDown className="w-4 h-4 text-text-gray" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/10 p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">Customer</p>
              <p className="text-white">{order.customerName}</p>
            </div>
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">Vendor</p>
              <p className="text-white">{order.vendorName}</p>
            </div>
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">Placed</p>
              <p className="text-white">{placedTime}</p>
            </div>
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">Fulfillment</p>
              <p className="text-white">{FULFILLMENT_LABEL[order.fulfillmentType]}</p>
            </div>
          </div>

          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-2">Items</p>
            <div className="space-y-1">
              {order.items.map((item, i) => (
                <p key={i} className="text-sm text-white">
                  <span className="text-neon-pink font-semibold">{item.quantity}×</span> {item.name}
                </p>
              ))}
            </div>
          </div>

          {order.cancellationReason && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <p className="text-[0.6875rem] uppercase tracking-wide text-red-400 font-semibold mb-0.5">Reason</p>
              <p className="text-sm text-white">{order.cancellationReason}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminOrdersPage() {
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [sortNewest, setSortNewest] = useState(true)

  const tabCounts = useMemo(() => ({
    all:       mockAdminOrders.length,
    active:    mockAdminOrders.filter((o) => ACTIVE_STATUSES.has(o.status)).length,
    COMPLETED: mockAdminOrders.filter((o) => o.status === 'COMPLETED').length,
    CANCELLED: mockAdminOrders.filter((o) => o.status === 'CANCELLED').length,
    REFUNDED:  mockAdminOrders.filter((o) => o.status === 'REFUNDED').length,
  }), [])

  const filtered = useMemo(() => {
    let list = mockAdminOrders
    if (filter === 'active') {
      list = list.filter((o) => ACTIVE_STATUSES.has(o.status))
    } else if (filter !== 'all') {
      list = list.filter((o) => o.status === filter)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((o) =>
        o.id.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.vendorName.toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => {
      const diff = new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime()
      return sortNewest ? diff : -diff
    })
  }, [filter, search, sortNewest])

  return (
    <div className="p-6 md:p-4 sm:p-3 max-w-[64rem] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight">
            Order <span className="text-neon-pink">Log</span>
          </h1>
          <p className="text-text-gray text-sm mt-0.5">{mockAdminOrders.length} orders today</p>
        </div>
        <button
          onClick={() => setSortNewest((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-semibold text-text-gray hover:text-white transition-all cursor-pointer"
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
          {sortNewest ? 'Newest First' : 'Oldest First'}
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-gray" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by order ID, customer, or vendor…"
          className="w-full bg-bg-card border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/50"
        />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap mb-5">
        {FILTER_TABS.map((tab) => {
          const count = tabCounts[tab.value as keyof typeof tabCounts] ?? 0
          const isActive = filter === tab.value
          return (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-3.5 py-1.5 rounded-full text-[0.6875rem] font-semibold border transition-all cursor-pointer ${
                isActive
                  ? 'bg-neon-pink border-neon-pink text-white'
                  : 'bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white'
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 text-[0.625rem] ${isActive ? 'text-white/70' : 'text-white/30'}`}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Order list */}
      {filtered.length === 0 ? (
        <div className="bg-bg-card border border-white/10 rounded-2xl py-16 text-center">
          <Package className="w-10 h-10 text-white/10 mx-auto mb-3" />
          <p className="text-white font-semibold text-sm mb-1">No orders found</p>
          <p className="text-text-gray text-xs">Try adjusting your filter or search query.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  )
}
