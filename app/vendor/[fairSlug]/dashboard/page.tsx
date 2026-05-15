'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { UserAvatar } from '../_components/VendorPortalShell'
import {
  Clock, CheckCircle, Bell, ChevronRight, AlertCircle,
} from 'lucide-react'
import { useVendorMeta } from '@/lib/contexts/VendorContext'
import { getFirebaseApp } from '@/lib/firebase-client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrderItem {
  menuItem: { name: string }
  quantity: number
  unitPrice: number
}

export type OrderStatus =
  | 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY'
  | 'RUNNER_COLLECTED' | 'COMPLETED' | 'DELIVERED'
  | 'CANCELLED' | 'UNCOLLECTED' | 'UNDELIVERABLE'

export type FulfillmentType = 'BOOTH_PICKUP' | 'CURBSIDE' | 'HOME_DELIVERY'

export interface VendorOrder {
  id: string
  status: OrderStatus
  fulfillmentType: FulfillmentType
  customerName: string
  customerPhone: string
  total: number
  subtotal: number
  orderItems: OrderItem[]
  placedAt: string
  // curbside
  vehicleMake?: string | null
  vehicleColor?: string | null
  vehiclePlate?: string | null
  // delivery
  deliveryStreet?: string | null
  deliveryCity?: string | null
}

// ─── Lane bucketing ───────────────────────────────────────────────────────────

const BUCKET: Record<string, 'incoming' | 'active' | 'ready' | 'completed'> = {
  PLACED:           'incoming',
  ACCEPTED:         'active',
  PREPARING:        'active',
  READY:            'ready',
  RUNNER_COLLECTED: 'ready',
  COMPLETED:        'completed',
  DELIVERED:        'completed',
  CANCELLED:        'completed',
  UNCOLLECTED:      'completed',
  UNDELIVERABLE:    'completed',
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchFullOrder(orderId: string): Promise<VendorOrder | null> {
  try {
    const res = await fetch(`/api/orders/${orderId}`)
    const json = await res.json()
    return json.success ? json.data : null
  } catch {
    return null
  }
}

async function transitionOrder(orderId: string, status: string): Promise<void> {
  const res = await fetch(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json?.error?.message ?? 'Status update failed')
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtId(id: string) { return '#' + id.slice(-8).toUpperCase() }
function fmtItems(order: VendorOrder) {
  return order.orderItems.map(i => `${i.quantity}× ${i.menuItem.name}`).join(', ')
}
function fmtFulfillment(type: FulfillmentType) {
  return { BOOTH_PICKUP: 'Booth Pickup', CURBSIDE: 'Curbside', HOME_DELIVERY: 'Home Delivery' }[type]
}
function fmtDeliveryDetail(order: VendorOrder) {
  if (order.fulfillmentType === 'CURBSIDE') return `${order.vehicleColor} ${order.vehicleMake}${order.vehiclePlate ? ' · ' + order.vehiclePlate : ''}`
  if (order.fulfillmentType === 'HOME_DELIVERY') return `${order.deliveryStreet}, ${order.deliveryCity}`
  return null
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, color = 'pink' }: {
  label: string; value: string | number
  color?: 'pink' | 'blue' | 'emerald' | 'amber'
}) {
  const c = {
    pink:    { text: 'text-neon-pink',   border: 'border-neon-pink/20'   },
    blue:    { text: 'text-blue-400',    border: 'border-blue-500/20'    },
    emerald: { text: 'text-emerald-400', border: 'border-emerald-500/20' },
    amber:   { text: 'text-amber-400',   border: 'border-amber-500/20'   },
  }[color]
  return (
    <div className={`bg-bg-card rounded-xl border ${c.border} px-4 py-3`}>
      <p className="text-[0.6rem] uppercase tracking-wider text-text-gray font-semibold mb-1">{label}</p>
      <p className={`font-bebas text-2xl tracking-wide leading-none ${c.text}`}>{value}</p>
    </div>
  )
}

// ─── Lane Header ──────────────────────────────────────────────────────────────

function LaneHeader({ label, count, pulse }: { label: string; count: number; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.04] shrink-0">
      {pulse && <span className="w-2 h-2 rounded-full bg-neon-pink animate-pulse shrink-0" />}
      <h2 className="font-bebas text-base tracking-wide text-white">{label}</h2>
      {count > 0 && (
        <span className={`px-2 py-0.5 rounded-full text-[0.6rem] font-bold uppercase tracking-wider ${pulse ? 'bg-neon-pink/20 text-neon-pink' : 'bg-white/10 text-text-gray'}`}>
          {count}
        </span>
      )}
    </div>
  )
}

// ─── Incoming Order Card ───────────────────────────────────────────────────────

function IncomingCard({ order, onAccept, onDecline }: {
  order: VendorOrder
  onAccept: (o: VendorOrder) => void
  onDecline: (o: VendorOrder) => void
}) {
  const detail = fmtDeliveryDetail(order)

  return (
    <div className="bg-bg-card border border-neon-pink/30 rounded-xl p-3.5 shadow-[0_0_20px_rgba(255,0,119,0.07)]">
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5">
          <Bell className="w-3.5 h-3.5 text-neon-pink shrink-0" />
          <span className="font-bold text-white text-xs">{fmtId(order.id)}</span>
        </div>
        <span className="text-text-gray text-[0.6rem]">
          {new Date(order.placedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <p className="text-[0.6875rem] text-text-gray mb-0.5">{fmtFulfillment(order.fulfillmentType)}</p>
      <p className="text-white/80 text-xs mb-1 leading-snug">{fmtItems(order)}</p>
      {detail && <p className="text-text-gray text-[0.65rem] mb-2.5">{detail}</p>}
      <div className="flex items-center justify-between mt-2.5">
        <span className="font-bold text-neon-pink text-sm">${order.total.toFixed(2)}</span>
        <div className="flex gap-1.5">
          <button
            onClick={() => onDecline(order)}
            className="px-3 py-1.5 bg-white/5 border border-white/10 text-text-gray rounded-lg text-[0.65rem] font-semibold hover:border-red-500/30 hover:text-red-400 transition-all cursor-pointer"
          >
            Decline
          </button>
          <button
            onClick={() => onAccept(order)}
            className="px-3 py-1.5 bg-neon-pink text-white rounded-lg text-[0.65rem] font-semibold hover:bg-[#e0006b] transition-all shadow-[0_2px_10px_rgba(255,0,119,0.3)] cursor-pointer"
          >
            ✓ Accept
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Active Order Card ─────────────────────────────────────────────────────────

function ActiveCard({ order, onStartPreparing, onMarkReady }: {
  order: VendorOrder
  onStartPreparing: (o: VendorOrder) => void
  onMarkReady: (o: VendorOrder) => void
}) {
  const detail = fmtDeliveryDetail(order)
  const isAccepted = order.status === 'ACCEPTED'

  return (
    <div className="bg-bg-card border border-amber-500/20 rounded-xl p-3.5">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-white text-xs">{fmtId(order.id)}</span>
          <span className={`px-1.5 py-0.5 rounded-full text-[0.6rem] font-bold border ${
            isAccepted
              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
          }`}>{isAccepted ? 'Accepted' : 'Preparing'}</span>
        </div>
        <span className="text-text-gray text-[0.65rem] shrink-0">{fmtFulfillment(order.fulfillmentType)}</span>
      </div>
      <p className="text-white/70 text-xs mb-1 leading-snug">{fmtItems(order)}</p>
      {detail && <p className="text-text-gray text-[0.65rem] mb-2">{detail}</p>}
      <div className="flex items-center justify-between mt-2.5">
        <span className="text-neon-pink font-bold text-sm">${order.total.toFixed(2)}</span>
        {isAccepted ? (
          <button
            onClick={() => onStartPreparing(order)}
            className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg text-[0.65rem] font-semibold hover:bg-blue-500/20 transition-all cursor-pointer"
          >
            Start Preparing
          </button>
        ) : (
          <button
            onClick={() => onMarkReady(order)}
            className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg text-[0.65rem] font-semibold hover:bg-amber-500/20 transition-all cursor-pointer"
          >
            Mark Ready
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Ready Card ────────────────────────────────────────────────────────────────

function ReadyCard({ order, onComplete }: {
  order: VendorOrder
  onComplete: (o: VendorOrder) => void
}) {
  const detail = fmtDeliveryDetail(order)

  return (
    <div className="bg-bg-card border border-emerald-500/20 rounded-xl p-3.5">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-white text-xs">{fmtId(order.id)}</span>
          <span className="px-1.5 py-0.5 rounded-full text-[0.6rem] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Ready
          </span>
        </div>
        <span className="text-text-gray text-[0.65rem] shrink-0">{fmtFulfillment(order.fulfillmentType)}</span>
      </div>
      <p className="text-white/70 text-xs mb-1 leading-snug">{fmtItems(order)}</p>
      {detail && <p className="text-text-gray text-[0.65rem] mb-2">{detail}</p>}
      <div className="flex items-center justify-between mt-2.5">
        <span className="text-text-gray text-xs">Waiting for pickup</span>
        <button
          onClick={() => onComplete(order)}
          className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-[0.65rem] font-semibold hover:bg-emerald-500/20 transition-all cursor-pointer"
        >
          Mark Picked Up
        </button>
      </div>
    </div>
  )
}

// ─── Empty Lane ────────────────────────────────────────────────────────────────

function EmptyLane({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-32 text-center px-4">
      <CheckCircle className="w-6 h-6 text-white/10 mb-2" />
      <p className="text-text-gray text-xs">{message}</p>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type Tab = 'incoming' | 'active' | 'ready'

export default function VendorDashboardPage() {
  const params = useParams<{ fairSlug: string }>()
  const { vendorId, eventId, vendorName } = useVendorMeta()

  const [isOnline, setIsOnline] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('incoming')
  const [loading, setLoading] = useState(true)

  const [incoming,  setIncoming]  = useState<VendorOrder[]>([])
  const [active,    setActive]    = useState<VendorOrder[]>([])
  const [ready,     setReady]     = useState<VendorOrder[]>([])
  const [completed, setCompleted] = useState<VendorOrder[]>([])


  // Track Firebase order IDs we've already fetched to avoid duplicate fetches
  const seenOrderIds = useRef<Set<string>>(new Set())

  // ── Initial REST load ────────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`/api/vendors/${vendorId}/orders`)
      .then(r => r.json())
      .then(json => {
        const orders: VendorOrder[] = json.data?.orders ?? []
        orders.forEach(o => seenOrderIds.current.add(o.id))
        setIncoming( orders.filter(o => BUCKET[o.status] === 'incoming'))
        setActive(   orders.filter(o => BUCKET[o.status] === 'active'))
        setReady(    orders.filter(o => BUCKET[o.status] === 'ready'))
        setCompleted(orders.filter(o => BUCKET[o.status] === 'completed'))
      })
      .catch(() => {/* keep empty state */})
      .finally(() => setLoading(false))
  }, [vendorId])

  // ── Firebase RTDB listener ───────────────────────────────────────────────────
  // Listens on fairs/{eventId}/orders/{vendorId} for real-time pushes.
  // New PLACED orders trigger a full REST fetch to get the complete shape.
  // Status changes on existing orders are handled by optimistic local updates
  // (the buttons), so Firebase here serves as a multi-device/multi-tab sync.

  useEffect(() => {
    if (!eventId || !vendorId) return

    const app = getFirebaseApp()
    if (!app) return // no Firebase config — REST-only mode

    let unsubscribe: (() => void) | null = null

    import('firebase/database').then(({ getDatabase, ref, onValue, off }) => {
      const db = getDatabase(app)
      const ordersRef = ref(db, `fairs/${eventId}/orders/${vendorId}`)

      const handler = onValue(ordersRef, async (snapshot) => {
        const data = snapshot.val() as Record<string, { status: string; placedAt: number }> | null
        if (!data) return

        for (const [orderId, payload] of Object.entries(data)) {
          // Only handle new PLACED orders not already in state
          if (payload.status === 'PLACED' && !seenOrderIds.current.has(orderId)) {
            seenOrderIds.current.add(orderId)
            const fullOrder = await fetchFullOrder(orderId)
            if (fullOrder) {
              setIncoming(prev => {
                if (prev.some(o => o.id === orderId)) return prev
                return [fullOrder, ...prev]
              })
            }
          }
        }
      })

      unsubscribe = () => off(ordersRef, 'value', handler)
    }).catch(() => {/* firebase/database not available */})

    return () => { unsubscribe?.() }
  }, [eventId, vendorId])

  // ── Patching helpers ─────────────────────────────────────────────────────────

  const handleAccept = useCallback((order: VendorOrder) => {
    // Optimistic: move card immediately
    setIncoming(prev => prev.filter(o => o.id !== order.id))
    setActive(prev => [{ ...order, status: 'ACCEPTED' }, ...prev])
    transitionOrder(order.id, 'ACCEPTED').catch(() => {
      // Rollback
      setActive(prev => prev.filter(o => o.id !== order.id))
      setIncoming(prev => [order, ...prev])
    })
  }, [])

  const handleDecline = useCallback((order: VendorOrder) => {
    setIncoming(prev => prev.filter(o => o.id !== order.id))
    setCompleted(prev => [{ ...order, status: 'CANCELLED' }, ...prev])
    transitionOrder(order.id, 'CANCELLED').catch(() => {
      setCompleted(prev => prev.filter(o => o.id !== order.id))
      setIncoming(prev => [order, ...prev])
    })
  }, [])

  const handleStartPreparing = useCallback(async (order: VendorOrder) => {
    // Wait for API before updating status — prevents race where user clicks Mark Ready
    // before ACCEPTED→PREPARING commits, causing a 409 on the READY transition
    try {
      const res = await fetch(`/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PREPARING' }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      setActive(prev => prev.map(o => o.id === order.id ? { ...o, status: 'PREPARING' } : o))
    } catch (err) {
      console.error('Start preparing failed:', err)
    }
  }, [])

  const handleMarkReady = useCallback(async (order: VendorOrder) => {
    // Wait for API before moving — avoids 409 flash when order isn't PREPARING yet
    try {
      const res = await fetch(`/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'READY' }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      setActive(prev => prev.filter(o => o.id !== order.id))
      setReady(prev => [{ ...order, status: 'READY' }, ...prev])
    } catch (err) {
      console.error('Mark ready failed:', err)
    }
  }, [])

  const handleComplete = useCallback((order: VendorOrder) => {
    setReady(prev => prev.filter(o => o.id !== order.id))
    setCompleted(prev => [{ ...order, status: 'COMPLETED' }, ...prev])
    transitionOrder(order.id, 'COMPLETED').catch(() => {
      setCompleted(prev => prev.filter(o => o.id !== order.id))
      setReady(prev => [order, ...prev])
    })
  }, [])

  // ── Derived stats ────────────────────────────────────────────────────────────

  const todayOrders  = incoming.length + active.length + ready.length + completed.length
  const todayRevenue = [...incoming, ...active, ...ready, ...completed]
    .filter(o => o.status !== 'CANCELLED')
    .reduce((sum, o) => sum + o.total, 0)

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'incoming', label: 'Incoming',  count: incoming.length },
    { id: 'active',   label: 'Preparing', count: active.length   },
    { id: 'ready',    label: 'Ready',     count: ready.length    },
  ]

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">

      {/* Top bar */}
      <div className="shrink-0 px-4 sm:px-5 pt-4 pb-3 border-b border-white/[0.04]">
        <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
          <div>
            <h1 className="font-bebas text-2xl tracking-wide text-white leading-none">
              Vendor <span className="text-neon-pink">Dashboard</span>
            </h1>
            <p className="text-text-gray text-[0.6875rem] mt-0.5">{vendorName} · Today</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsOnline(v => !v)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border font-semibold text-xs transition-all cursor-pointer ${
                isOnline
                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/15'
                  : 'bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/15'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
              {isOnline ? 'Online' : 'Offline'}
            </button>
            <UserAvatar />
          </div>
        </div>

        {!isOnline && (
          <div className="mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-red-300 text-xs font-medium">
              Store is offline — customers cannot place orders.
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Orders Today" value={loading ? '…' : todayOrders} color="blue" />
          <StatCard label="Revenue"      value={loading ? '…' : `$${todayRevenue.toFixed(0)}`} color="pink" />
          <StatCard label="In Queue"     value={loading ? '…' : incoming.length + active.length} color="amber" />
        </div>
      </div>

      {/* Mobile tab bar */}
      <div className="sm:hidden flex border-b border-white/[0.04] shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === tab.id
                ? 'text-neon-pink border-b-2 border-neon-pink'
                : 'text-text-gray hover:text-white'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[0.6rem] font-bold ${
                activeTab === tab.id ? 'bg-neon-pink/20 text-neon-pink' : 'bg-white/10 text-text-gray'
              }`}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Kanban body */}
      <div className="flex-1 overflow-hidden">

        {/* Desktop: 3-column kanban */}
        <div className="hidden sm:grid sm:grid-cols-3 h-full divide-x divide-white/[0.04]">

          {/* Incoming lane */}
          <div className="flex flex-col h-full overflow-hidden">
            <LaneHeader label="Incoming" count={incoming.length} pulse />
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {loading ? (
                <div className="h-24 bg-white/5 rounded-xl animate-pulse" />
              ) : incoming.length === 0 ? (
                <EmptyLane message="No incoming orders" />
              ) : (
                incoming.map(order => (
                  <IncomingCard
                    key={order.id}
                    order={order}
                    onAccept={handleAccept}
                    onDecline={handleDecline}
                  />
                ))
              )}
            </div>
          </div>

          {/* Preparing lane */}
          <div className="flex flex-col h-full overflow-hidden">
            <LaneHeader label="Preparing" count={active.length} />
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {loading ? (
                <div className="h-24 bg-white/5 rounded-xl animate-pulse" />
              ) : active.length === 0 ? (
                <EmptyLane message="No active orders" />
              ) : (
                active.map(order => (
                  <ActiveCard
                    key={order.id}
                    order={order}
                    onStartPreparing={handleStartPreparing}
                    onMarkReady={handleMarkReady}
                  />
                ))
              )}
            </div>
          </div>

          {/* Ready lane */}
          <div className="flex flex-col h-full overflow-hidden">
            <LaneHeader label="Ready for Pickup" count={ready.length} />
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {loading ? (
                <div className="h-24 bg-white/5 rounded-xl animate-pulse" />
              ) : ready.length === 0 ? (
                <EmptyLane message="No orders staged" />
              ) : (
                ready.map(order => (
                  <ReadyCard
                    key={order.id}
                    order={order}
                    onComplete={handleComplete}
                  />
                ))
              )}

              {/* Completed summary */}
              {!loading && completed.length > 0 && (
                <div className="mt-4 pt-4 border-t border-white/[0.04]">
                  <p className="text-[0.65rem] uppercase tracking-wider text-text-gray font-semibold mb-2">
                    Completed Today — {completed.filter(o => o.status !== 'CANCELLED').length}
                  </p>
                  <div className="bg-bg-card border border-white/5 rounded-xl divide-y divide-white/5 overflow-hidden">
                    {completed.slice(0, 4).map(order => (
                      <div key={order.id} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <span className="text-xs font-medium text-white">{fmtId(order.id)}</span>
                          <p className="text-text-gray text-[0.6rem] mt-0.5 truncate max-w-[120px]">{fmtItems(order)}</p>
                        </div>
                        <span className={`font-bold text-xs ${order.status === 'CANCELLED' ? 'text-red-400' : 'text-emerald-400'}`}>
                          {order.status === 'CANCELLED' ? 'Cancelled' : `$${order.total.toFixed(2)}`}
                        </span>
                      </div>
                    ))}
                    {completed.length > 4 && (
                      <div className="px-3 py-2">
                        <Link
                          href={`/vendor/${params.fairSlug}/orders`}
                          className="text-neon-pink text-[0.65rem] font-semibold flex items-center gap-1 no-underline hover:underline"
                        >
                          View all {completed.length} <ChevronRight className="w-3 h-3" />
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile: single-lane based on active tab */}
        <div className="sm:hidden h-full overflow-y-auto p-3 space-y-3">
          {activeTab === 'incoming' && (
            incoming.length === 0
              ? <EmptyLane message="No incoming orders right now" />
              : incoming.map(order => (
                  <IncomingCard
                    key={order.id}
                    order={order}
                    onAccept={handleAccept}
                    onDecline={handleDecline}
                  />
                ))
          )}
          {activeTab === 'active' && (
            active.length === 0
              ? <EmptyLane message="No active orders" />
              : active.map(order => (
                  <ActiveCard
                    key={order.id}
                    order={order}
                    onStartPreparing={handleStartPreparing}
                    onMarkReady={handleMarkReady}
                  />
                ))
          )}
          {activeTab === 'ready' && (
            ready.length === 0
              ? <EmptyLane message="No orders staged for pickup" />
              : ready.map(order => (
                  <ReadyCard
                    key={order.id}
                    order={order}
                    onComplete={handleComplete}
                  />
                ))
          )}
        </div>
      </div>


    </div>
  )
}
