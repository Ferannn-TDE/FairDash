'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  ChevronDown, ChevronUp, Clock, User, Phone,
  ShoppingBag, Car, MapPin, CheckCircle, XCircle,
  Package, ArrowUpDown,
} from 'lucide-react'
import { useVendorMeta } from '@/lib/contexts/VendorContext'
import { StatusPill } from '@/components/ui/StatusPill'

// ─── Types ──────────────────────────────────────────────────────────────────

type OrderStatus = 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED' | string

interface OrderItem {
  itemName: string
  quantity: number
  unitPrice: number
}

interface Order {
  id: string
  status: OrderStatus
  fulfillmentType: 'BOOTH_PICKUP' | 'CURBSIDE' | 'HOME_DELIVERY' | string
  customerName: string
  customerPhone?: string | null
  total: number
  subtotal: number
  vendorPayout: number
  orderItems: OrderItem[]
  placedAt: string
  estimatedReadyAt?: string | null
  vehicleColor?: string | null
  vehicleMake?: string | null
  vehiclePlate?: string | null
  deliveryStreet?: string | null
  deliveryCity?: string | null
}

// ─── Constants ──────────────────────────────────────────────────────────────

const FULFILLMENT_LABEL: Record<string, string> = {
  BOOTH_PICKUP: 'Booth Pickup',
  CURBSIDE: 'Curbside',
  HOME_DELIVERY: 'Home Delivery',
}

const FILTER_TABS = [
  { value: 'all',       label: 'All' },
  { value: 'PLACED',    label: 'Incoming' },
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'READY',     label: 'Ready' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const

// ─── Sub-components ─────────────────────────────────────────────────────────

function FulfillmentIcon({ type }: { type: string }) {
  if (type === 'CURBSIDE') return <Car className="w-3.5 h-3.5" />
  if (type === 'HOME_DELIVERY') return <MapPin className="w-3.5 h-3.5" />
  return <ShoppingBag className="w-3.5 h-3.5" />
}

function OrderCard({ order }: { order: Order }) {
  const [expanded, setExpanded] = useState(false)
  const placedTime = new Date(order.placedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const shortId = '#' + order.id.slice(-8).toUpperCase()

  return (
    <div className={`border border-white/10 rounded-2xl overflow-hidden transition-all duration-200 ${
      order.status === 'PLACED' ? 'border-neon-pink/30 bg-neon-pink/[0.03]' : 'bg-bg-card'
    }`}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-4 p-4 sm:p-5 hover:bg-white/[0.02] transition-colors text-left cursor-pointer"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-white text-sm">{shortId}</span>
            <StatusPill status={order.status} />
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-text-gray">
              <User className="w-3 h-3" />
              {order.customerName}
            </span>
            <span className="flex items-center gap-1 text-xs text-text-gray">
              <Clock className="w-3 h-3" />
              {placedTime}
            </span>
            <span className="flex items-center gap-1 text-xs text-text-gray">
              <FulfillmentIcon type={order.fulfillmentType} />
              {FULFILLMENT_LABEL[order.fulfillmentType] ?? order.fulfillmentType}
            </span>
          </div>
        </div>
        <div className="hidden sm:block flex-1 min-w-0">
          <p className="text-white/60 text-xs truncate">
            {order.orderItems.map(i => `${i.quantity}× ${i.itemName}`).join(', ')}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-bold text-neon-pink text-sm">${(order.vendorPayout ?? 0).toFixed(2)}</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-text-gray" /> : <ChevronDown className="w-4 h-4 text-text-gray" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/10 p-4 sm:p-5 space-y-4">
          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-2">Items</p>
            <div className="space-y-1.5">
              {order.orderItems.map((item, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm text-white">
                    <span className="text-neon-pink font-semibold">{item.quantity}×</span>{' '}
                    {item.itemName}
                  </span>
                  <span className="text-sm text-text-gray">${(item.unitPrice * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 pt-2 border-t border-white/5 space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-text-gray">Subtotal</span>
                <span className="text-xs text-white">${(order.subtotal ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-text-gray">Your Earnings</span>
                <span className="text-xs font-semibold text-emerald-400">${(order.vendorPayout ?? 0).toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-2">Customer</p>
            <div className="flex flex-wrap gap-4">
              <span className="flex items-center gap-1.5 text-sm text-white">
                <User className="w-3.5 h-3.5 text-text-gray" />
                {order.customerName}
              </span>
              {order.customerPhone && (
                <span className="flex items-center gap-1.5 text-sm text-white">
                  <Phone className="w-3.5 h-3.5 text-text-gray" />
                  {order.customerPhone}
                </span>
              )}
            </div>
          </div>

          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-2">Fulfillment</p>
            <div className="flex items-start gap-2">
              <FulfillmentIcon type={order.fulfillmentType} />
              <div className="text-sm text-white space-y-0.5">
                <p className="font-semibold">{FULFILLMENT_LABEL[order.fulfillmentType] ?? order.fulfillmentType}</p>
                {order.fulfillmentType === 'CURBSIDE' && (
                  <p className="text-text-gray text-xs">
                    {order.vehicleColor} {order.vehicleMake}{order.vehiclePlate ? ` · ${order.vehiclePlate}` : ''}
                  </p>
                )}
                {order.fulfillmentType === 'HOME_DELIVERY' && (
                  <p className="text-text-gray text-xs">{order.deliveryStreet}, {order.deliveryCity}</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/[0.03] rounded-xl p-3">
              <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">Placed</p>
              <p className="text-sm text-white">{placedTime}</p>
            </div>
            {order.estimatedReadyAt && (
              <div className="bg-white/[0.03] rounded-xl p-3">
                <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">Est. Ready</p>
                <p className="text-sm text-white">
                  {new Date(order.estimatedReadyAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {order.status === 'COMPLETED'
              ? <CheckCircle className="w-4 h-4 text-emerald-400" />
              : order.status === 'CANCELLED'
              ? <XCircle className="w-4 h-4 text-red-400" />
              : <Package className="w-4 h-4 text-neon-pink" />}
            <span className="text-xs text-text-gray">
              {order.status === 'COMPLETED' ? 'Order fulfilled successfully'
                : order.status === 'CANCELLED' ? 'Order was cancelled'
                : 'Order in progress'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function VendorOrdersPage() {
  const { vendorId } = useVendorMeta()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [sortNewest, setSortNewest] = useState(true)

  useEffect(() => {
    if (!vendorId) return
    fetch(`/api/vendors/${vendorId}/orders/history`)
      .then(r => r.json())
      .then(json => {
        if (json.success) setOrders(json.data?.orders ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [vendorId])

  const tabCounts = useMemo(() => ({
    all:       orders.length,
    PLACED:    orders.filter(o => o.status === 'PLACED').length,
    PREPARING: orders.filter(o => o.status === 'ACCEPTED' || o.status === 'PREPARING').length,
    READY:     orders.filter(o => o.status === 'READY').length,
    COMPLETED: orders.filter(o => o.status === 'COMPLETED').length,
    CANCELLED: orders.filter(o => o.status === 'CANCELLED').length,
  }), [orders])

  const filtered = useMemo(() => {
    let list = orders
    if (filter !== 'all') {
      if (filter === 'PREPARING') {
        list = list.filter(o => o.status === 'ACCEPTED' || o.status === 'PREPARING')
      } else {
        list = list.filter(o => o.status === filter)
      }
    }
    return [...list].sort((a, b) => {
      const diff = new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime()
      return sortNewest ? diff : -diff
    })
  }, [orders, filter, sortNewest])

  return (
    <div className="p-6 md:p-4 sm:p-3 max-w-[56rem] mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight">
            Order <span className="text-neon-pink">History</span>
          </h1>
          <p className="text-text-gray text-sm mt-0.5">
            {loading ? 'Loading…' : `${orders.length} order${orders.length !== 1 ? 's' : ''} total`}
          </p>
        </div>
        <button
          onClick={() => setSortNewest(v => !v)}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-semibold text-text-gray hover:text-white hover:border-white/20 transition-all duration-200 cursor-pointer"
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
          {sortNewest ? 'Newest First' : 'Oldest First'}
        </button>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-6">
        {FILTER_TABS.map(tab => {
          const count = tabCounts[tab.value as keyof typeof tabCounts] ?? 0
          const isActive = filter === tab.value
          return (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-3.5 py-1.5 rounded-full text-[0.6875rem] font-semibold border transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'bg-neon-pink border-neon-pink text-white'
                  : 'bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white'
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 text-[0.625rem] ${isActive ? 'text-white/70' : 'text-white/30'}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-bg-card border border-white/10 rounded-2xl py-16 text-center">
          <Package className="w-10 h-10 text-white/10 mx-auto mb-3" />
          <p className="text-white font-semibold text-sm mb-1">No orders found</p>
          <p className="text-text-gray text-xs">No orders match the selected filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(order => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  )
}
