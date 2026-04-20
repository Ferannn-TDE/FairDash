'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ShoppingBag, DollarSign, Clock, CheckCircle, Bell, ChevronRight,
  Store, BarChart2, Settings, TruckIcon, AlertCircle, Home,
} from 'lucide-react'
import {
  mockIncomingOrders,
  mockActiveOrders,
  mockReadyOrders,
  mockCompletedOrders,
  mockVendorStats,
  type MockVendorOrder,
} from '@/lib/mock/vendor-dashboard'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtId(id: string) { return '#' + id.slice(-8).toUpperCase() }
function fmtItems(order: MockVendorOrder) {
  return order.orderItems.map(i => `${i.quantity}× ${i.menuItem.name}`).join(', ')
}
function fmtFulfillment(type: MockVendorOrder['fulfillmentType']) {
  return { BOOTH_PICKUP: 'Booth Pickup', CURBSIDE: 'Curbside', HOME_DELIVERY: 'Home Delivery' }[type]
}
function fmtDeliveryDetail(order: MockVendorOrder) {
  if (order.fulfillmentType === 'CURBSIDE') return `${order.vehicleColor} ${order.vehicleMake} · ${order.vehiclePlate}`
  if (order.fulfillmentType === 'HOME_DELIVERY') return `${order.deliveryStreet}, ${order.deliveryCity}`
  return null
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'pink' }: {
  label: string; value: string | number; sub?: string
  color?: 'pink' | 'blue' | 'emerald' | 'amber'
}) {
  const c = {
    pink:    { bg: 'bg-neon-pink/10',     text: 'text-neon-pink',    border: 'border-neon-pink/20'    },
    blue:    { bg: 'bg-blue-500/10',      text: 'text-blue-400',     border: 'border-blue-500/20'     },
    emerald: { bg: 'bg-emerald-500/10',   text: 'text-emerald-400',  border: 'border-emerald-500/20'  },
    amber:   { bg: 'bg-amber-500/10',     text: 'text-amber-400',    border: 'border-amber-500/20'    },
  }[color]
  return (
    <div className={`bg-bg-card rounded-2xl border ${c.border} p-5`}>
      <p className="text-[0.6875rem] uppercase tracking-wider text-text-gray font-semibold mb-2">{label}</p>
      <p className={`font-bebas text-3xl tracking-wide ${c.text}`}>{value}</p>
      {sub && <p className="text-text-gray text-xs mt-1">{sub}</p>}
    </div>
  )
}

// ─── Section Header ────────────────────────────────────────────────────────────

function SectionHeader({ label, count, pulse }: { label: string; count: number; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      {pulse && <span className="w-2 h-2 rounded-full bg-neon-pink animate-pulse shrink-0" />}
      <h2 className="font-bebas text-lg tracking-wide text-white">{label}</h2>
      {count > 0 && (
        <span className={`px-2 py-0.5 rounded-full text-[0.625rem] font-bold uppercase tracking-wider ${pulse ? 'bg-neon-pink/20 text-neon-pink' : 'bg-white/10 text-text-gray'}`}>
          {count}
        </span>
      )}
    </div>
  )
}

// ─── Incoming Order Card ───────────────────────────────────────────────────────

function IncomingCard({ order, onAccept, onDecline, accepting, declining }: {
  order: MockVendorOrder
  onAccept: (id: string) => void
  onDecline: (id: string) => void
  accepting: boolean
  declining: boolean
}) {
  // Mock static countdown — 1m 42s left (would be calculated from placedAt + 120s in real impl)
  const countdown = '1:42'
  const detail = fmtDeliveryDetail(order)

  return (
    <div className="bg-bg-card border border-neon-pink/30 rounded-2xl p-4 shadow-[0_0_24px_rgba(255,0,119,0.08)] animate-fadeIn">
      {/* Top row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-neon-pink shrink-0" />
          <span className="font-bold text-white text-sm">{fmtId(order.id)}</span>
          <span className="text-text-gray text-xs">· {fmtFulfillment(order.fulfillmentType)}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 border border-red-500/20 rounded-lg shrink-0">
          <Clock className="w-3 h-3 text-red-400" />
          <span className="text-red-400 font-mono text-xs font-bold">{countdown}</span>
        </div>
      </div>

      {/* Items */}
      <p className="text-white/80 text-sm mb-1 leading-snug">{fmtItems(order)}</p>
      {detail && <p className="text-text-gray text-xs mb-3">{detail}</p>}

      {/* Footer */}
      <div className="flex items-center justify-between mt-3">
        <span className="font-bold text-neon-pink text-base">${order.total.toFixed(2)}</span>
        <div className="flex gap-2">
          <button
            onClick={() => onDecline(order.id)}
            disabled={declining}
            className="px-4 py-2 bg-white/5 border border-white/10 text-text-gray rounded-xl text-xs font-semibold hover:border-red-500/30 hover:text-red-400 transition-all disabled:opacity-50 cursor-pointer"
          >
            Decline
          </button>
          <button
            onClick={() => onAccept(order.id)}
            disabled={accepting}
            className="px-4 py-2 bg-neon-pink text-white rounded-xl text-xs font-semibold hover:bg-[#e0006b] transition-all shadow-[0_2px_12px_rgba(255,0,119,0.3)] disabled:opacity-50 cursor-pointer"
          >
            {accepting ? '…' : '✓ Accept'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Active Order Card ─────────────────────────────────────────────────────────

function ActiveCard({ order, onMarkReady, patching }: {
  order: MockVendorOrder
  onMarkReady: (id: string) => void
  patching: boolean
}) {
  const label = order.status === 'ACCEPTED' ? 'Start Preparing' : 'Mark Ready'
  const detail = fmtDeliveryDetail(order)

  return (
    <div className="bg-bg-card border border-amber-500/20 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <span className="font-bold text-white text-sm">{fmtId(order.id)}</span>
          <span className={`ml-2 px-2 py-0.5 rounded-full text-[0.625rem] font-bold border ${
            order.status === 'ACCEPTED'
              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
          }`}>{order.status === 'ACCEPTED' ? 'Accepted' : 'Preparing'}</span>
        </div>
        <span className="text-text-gray text-xs shrink-0">{fmtFulfillment(order.fulfillmentType)}</span>
      </div>
      <p className="text-white/70 text-xs mb-1">{fmtItems(order)}</p>
      {detail && <p className="text-text-gray text-xs mb-2">{detail}</p>}
      <div className="flex items-center justify-between mt-3">
        <span className="text-neon-pink font-bold text-sm">${order.total.toFixed(2)}</span>
        <button
          onClick={() => onMarkReady(order.id)}
          disabled={patching}
          className="px-4 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl text-xs font-semibold hover:bg-amber-500/20 transition-all disabled:opacity-50 cursor-pointer"
        >
          {patching ? '…' : label}
        </button>
      </div>
    </div>
  )
}

// ─── Ready Card ────────────────────────────────────────────────────────────────

function ReadyCard({ order, onComplete, patching }: {
  order: MockVendorOrder
  onComplete: (id: string) => void
  patching: boolean
}) {
  const detail = fmtDeliveryDetail(order)

  return (
    <div className="bg-bg-card border border-blue-500/20 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <span className="font-bold text-white text-sm">{fmtId(order.id)}</span>
          <span className="ml-2 px-2 py-0.5 rounded-full text-[0.625rem] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            Ready
          </span>
        </div>
        <span className="text-text-gray text-xs shrink-0">{fmtFulfillment(order.fulfillmentType)}</span>
      </div>
      <p className="text-white/70 text-xs mb-1">{fmtItems(order)}</p>
      {detail && <p className="text-text-gray text-xs mb-2">{detail}</p>}
      <div className="flex items-center justify-between mt-3">
        <span className="text-text-gray text-xs">Waiting ~2 min</span>
        <button
          onClick={() => onComplete(order.id)}
          disabled={patching}
          className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-semibold hover:bg-emerald-500/20 transition-all disabled:opacity-50 cursor-pointer"
        >
          {patching ? '…' : 'Mark Picked Up'}
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function VendorDashboardPage() {
  const params = useParams<{ fairSlug: string }>()
  const [isOnline, setIsOnline] = useState(true)

  const [incoming, setIncoming] = useState(mockIncomingOrders)
  const [active, setActive]     = useState(mockActiveOrders)
  const [ready, setReady]       = useState(mockReadyOrders)
  const [completed, setCompleted] = useState(mockCompletedOrders)

  const [patching, setPatching] = useState<Set<string>>(new Set())

  function setPatch(id: string, on: boolean) {
    setPatching(prev => { const s = new Set(prev); on ? s.add(id) : s.delete(id); return s })
  }

  function handleAccept(id: string) {
    setPatch(id, true)
    setTimeout(() => {
      const order = incoming.find(o => o.id === id)
      if (order) {
        setIncoming(prev => prev.filter(o => o.id !== id))
        setActive(prev => [{ ...order, status: 'ACCEPTED' as const }, ...prev])
      }
      setPatch(id, false)
    }, 600)
  }

  function handleDecline(id: string) {
    setPatch(id, true)
    setTimeout(() => {
      setIncoming(prev => prev.filter(o => o.id !== id))
      setPatch(id, false)
    }, 400)
  }

  function handleMarkReady(id: string) {
    setPatch(id, true)
    setTimeout(() => {
      const order = active.find(o => o.id === id)
      if (order && order.status === 'PREPARING') {
        setActive(prev => prev.filter(o => o.id !== id))
        setReady(prev => [{ ...order, status: 'READY' as const }, ...prev])
      } else if (order) {
        setActive(prev => prev.map(o => o.id === id ? { ...o, status: 'PREPARING' as const } : o))
      }
      setPatch(id, false)
    }, 500)
  }

  function handleComplete(id: string) {
    setPatch(id, true)
    setTimeout(() => {
      const order = ready.find(o => o.id === id)
      if (order) {
        setReady(prev => prev.filter(o => o.id !== id))
        setCompleted(prev => [{ ...order, status: 'COMPLETED' as const }, ...prev])
      }
      setPatch(id, false)
    }, 500)
  }

  return (
    <div className="p-5 md:p-4 sm:p-3 max-w-[72rem] mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3vw,2.25rem)] tracking-wide text-white leading-none">
            Vendor <span className="text-neon-pink">Dashboard</span>
          </h1>
          <p className="text-text-gray text-xs mt-0.5">Springfield State Fair · Today</p>
        </div>
        {/* Online / Offline toggle */}
        <button
          onClick={() => setIsOnline(v => !v)}
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border font-semibold text-sm transition-all cursor-pointer ${
            isOnline
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/15'
              : 'bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/15'
          }`}
        >
          <span className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          {isOnline ? 'Online' : 'Offline'}
        </button>
      </div>

      {/* Offline overlay */}
      {!isOnline && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <p className="text-red-300 text-sm font-medium">
            Your store is offline. Customers cannot place orders. Go online to start receiving orders.
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="Orders Today" value={mockVendorStats.todayOrders} color="blue" />
        <StatCard label="Revenue Today" value={`$${mockVendorStats.todayRevenue.toFixed(2)}`} color="pink" />
        <StatCard label="Avg Prep Time" value={`${mockVendorStats.avgPrepTime} min`} color="emerald" />
      </div>

      {/* INCOMING ORDERS */}
      <div className="mb-6">
        <SectionHeader label="Incoming Orders" count={incoming.length} pulse />
        {incoming.length === 0 ? (
          <div className="bg-bg-card border border-white/5 rounded-2xl p-6 text-center">
            <CheckCircle className="w-8 h-8 text-emerald-400/40 mx-auto mb-2" />
            <p className="text-text-gray text-sm">No incoming orders right now.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {incoming.map(order => (
              <IncomingCard
                key={order.id}
                order={order}
                onAccept={handleAccept}
                onDecline={handleDecline}
                accepting={patching.has(order.id)}
                declining={patching.has(order.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ACTIVE ORDERS */}
      <div className="mb-6">
        <SectionHeader label="Active Orders" count={active.length} />
        {active.length === 0 ? (
          <div className="bg-bg-card border border-white/5 rounded-2xl p-5 text-center">
            <p className="text-text-gray text-sm">No active orders.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {active.map(order => (
              <ActiveCard
                key={order.id}
                order={order}
                onMarkReady={handleMarkReady}
                patching={patching.has(order.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* READY FOR PICKUP */}
      <div className="mb-6">
        <SectionHeader label="Ready for Pickup" count={ready.length} />
        {ready.length === 0 ? (
          <div className="bg-bg-card border border-white/5 rounded-2xl p-5 text-center">
            <p className="text-text-gray text-sm">No orders staged for pickup.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ready.map(order => (
              <ReadyCard
                key={order.id}
                order={order}
                onComplete={handleComplete}
                patching={patching.has(order.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* COMPLETED TODAY */}
      <div className="mb-6">
        <SectionHeader label="Completed Today" count={completed.length} />
        <div className="bg-bg-card border border-white/5 rounded-2xl divide-y divide-white/5 overflow-hidden">
          {completed.slice(0, 5).map(order => (
            <div key={order.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <span className="text-sm font-medium text-white">{fmtId(order.id)}</span>
                <span className="ml-2 text-text-gray text-xs">{order.customerName}</span>
                <p className="text-text-gray text-xs mt-0.5">{fmtItems(order)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-emerald-400 font-bold text-sm">${order.total.toFixed(2)}</p>
                <p className="text-text-gray text-[0.6875rem]">Completed</p>
              </div>
            </div>
          ))}
          {completed.length > 5 && (
            <div className="px-4 py-3">
              <Link
                href={`/vendor/${params.fairSlug}/orders`}
                className="text-neon-pink text-xs font-semibold hover:underline flex items-center gap-1 no-underline"
              >
                View all {completed.length} completed orders <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Orders',    href: 'orders',    icon: ShoppingBag },
          { label: 'Menu',      href: 'menu',      icon: Store },
          { label: 'Analytics', href: 'analytics', icon: BarChart2 },
          { label: 'Settings',  href: 'settings',  icon: Settings },
        ].map(({ label, href, icon: Icon }) => (
          <Link
            key={label}
            href={`/vendor/${params.fairSlug}/${href}`}
            className="bg-bg-card border border-white/10 rounded-xl p-4 flex items-center gap-3 no-underline hover:border-white/20 hover:-translate-y-0.5 transition-all group"
          >
            <Icon className="w-4 h-4 text-text-gray group-hover:text-neon-pink transition-colors shrink-0" />
            <span className="text-sm font-medium text-white">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
