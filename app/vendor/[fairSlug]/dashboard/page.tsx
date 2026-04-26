'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { UserAvatar } from '../_components/VendorPortalShell'
import {
  ShoppingBag, Clock, CheckCircle, Bell, ChevronRight,
  Store, BarChart2, Settings, AlertCircle,
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

function IncomingCard({ order, onAccept, onDecline, accepting, declining }: {
  order: MockVendorOrder
  onAccept: (id: string) => void
  onDecline: (id: string) => void
  accepting: boolean
  declining: boolean
}) {
  const countdown = '1:42'
  const detail = fmtDeliveryDetail(order)

  return (
    <div className="bg-bg-card border border-neon-pink/30 rounded-xl p-3.5 shadow-[0_0_20px_rgba(255,0,119,0.07)]">
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5">
          <Bell className="w-3.5 h-3.5 text-neon-pink shrink-0" />
          <span className="font-bold text-white text-xs">{fmtId(order.id)}</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded-lg shrink-0">
          <Clock className="w-2.5 h-2.5 text-red-400" />
          <span className="text-red-400 font-mono text-[0.65rem] font-bold">{countdown}</span>
        </div>
      </div>
      <p className="text-[0.6875rem] text-text-gray mb-0.5">{fmtFulfillment(order.fulfillmentType)}</p>
      <p className="text-white/80 text-xs mb-1 leading-snug">{fmtItems(order)}</p>
      {detail && <p className="text-text-gray text-[0.65rem] mb-2.5">{detail}</p>}
      <div className="flex items-center justify-between mt-2.5">
        <span className="font-bold text-neon-pink text-sm">${order.total.toFixed(2)}</span>
        <div className="flex gap-1.5">
          <button
            onClick={() => onDecline(order.id)}
            disabled={declining}
            className="px-3 py-1.5 bg-white/5 border border-white/10 text-text-gray rounded-lg text-[0.65rem] font-semibold hover:border-red-500/30 hover:text-red-400 transition-all disabled:opacity-50 cursor-pointer"
          >
            Decline
          </button>
          <button
            onClick={() => onAccept(order.id)}
            disabled={accepting}
            className="px-3 py-1.5 bg-neon-pink text-white rounded-lg text-[0.65rem] font-semibold hover:bg-[#e0006b] transition-all shadow-[0_2px_10px_rgba(255,0,119,0.3)] disabled:opacity-50 cursor-pointer"
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
    <div className="bg-bg-card border border-amber-500/20 rounded-xl p-3.5">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-white text-xs">{fmtId(order.id)}</span>
          <span className={`px-1.5 py-0.5 rounded-full text-[0.6rem] font-bold border ${
            order.status === 'ACCEPTED'
              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
          }`}>{order.status === 'ACCEPTED' ? 'Accepted' : 'Preparing'}</span>
        </div>
        <span className="text-text-gray text-[0.65rem] shrink-0">{fmtFulfillment(order.fulfillmentType)}</span>
      </div>
      <p className="text-white/70 text-xs mb-1 leading-snug">{fmtItems(order)}</p>
      {detail && <p className="text-text-gray text-[0.65rem] mb-2">{detail}</p>}
      <div className="flex items-center justify-between mt-2.5">
        <span className="text-neon-pink font-bold text-sm">${order.total.toFixed(2)}</span>
        <button
          onClick={() => onMarkReady(order.id)}
          disabled={patching}
          className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg text-[0.65rem] font-semibold hover:bg-amber-500/20 transition-all disabled:opacity-50 cursor-pointer"
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
        <span className="text-text-gray text-xs">Waiting ~2 min</span>
        <button
          onClick={() => onComplete(order.id)}
          disabled={patching}
          className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-[0.65rem] font-semibold hover:bg-emerald-500/20 transition-all disabled:opacity-50 cursor-pointer"
        >
          {patching ? '…' : 'Mark Picked Up'}
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
  const [isOnline, setIsOnline] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('incoming')

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

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'incoming', label: 'Incoming', count: incoming.length },
    { id: 'active',   label: 'Preparing', count: active.length },
    { id: 'ready',    label: 'Ready',    count: ready.length },
  ]

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">

      {/* Top bar — header + stats */}
      <div className="shrink-0 px-4 sm:px-5 pt-4 pb-3 border-b border-white/[0.04]">
        <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
          <div>
            <h1 className="font-bebas text-2xl tracking-wide text-white leading-none">
              Vendor <span className="text-neon-pink">Dashboard</span>
            </h1>
            <p className="text-text-gray text-[0.6875rem] mt-0.5">Springfield State Fair · Today</p>
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
          <StatCard label="Orders Today" value={mockVendorStats.todayOrders} color="blue" />
          <StatCard label="Revenue" value={`$${mockVendorStats.todayRevenue.toFixed(0)}`} color="pink" />
          <StatCard label="Avg Prep" value={`${mockVendorStats.avgPrepTime}m`} color="emerald" />
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
              {incoming.length === 0
                ? <EmptyLane message="No incoming orders" />
                : incoming.map(order => (
                    <IncomingCard
                      key={order.id}
                      order={order}
                      onAccept={handleAccept}
                      onDecline={handleDecline}
                      accepting={patching.has(order.id)}
                      declining={patching.has(order.id)}
                    />
                  ))
              }
            </div>
          </div>

          {/* Preparing lane */}
          <div className="flex flex-col h-full overflow-hidden">
            <LaneHeader label="Preparing" count={active.length} />
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {active.length === 0
                ? <EmptyLane message="No active orders" />
                : active.map(order => (
                    <ActiveCard
                      key={order.id}
                      order={order}
                      onMarkReady={handleMarkReady}
                      patching={patching.has(order.id)}
                    />
                  ))
              }
            </div>
          </div>

          {/* Ready lane */}
          <div className="flex flex-col h-full overflow-hidden">
            <LaneHeader label="Ready for Pickup" count={ready.length} />
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {ready.length === 0
                ? <EmptyLane message="No orders staged" />
                : ready.map(order => (
                    <ReadyCard
                      key={order.id}
                      order={order}
                      onComplete={handleComplete}
                      patching={patching.has(order.id)}
                    />
                  ))
              }
              {/* Completed summary at bottom of ready lane */}
              {completed.length > 0 && (
                <div className="mt-4 pt-4 border-t border-white/[0.04]">
                  <p className="text-[0.65rem] uppercase tracking-wider text-text-gray font-semibold mb-2">
                    Completed Today — {completed.length}
                  </p>
                  <div className="bg-bg-card border border-white/5 rounded-xl divide-y divide-white/5 overflow-hidden">
                    {completed.slice(0, 4).map(order => (
                      <div key={order.id} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <span className="text-xs font-medium text-white">{fmtId(order.id)}</span>
                          <p className="text-text-gray text-[0.6rem] mt-0.5 truncate max-w-[120px]">{fmtItems(order)}</p>
                        </div>
                        <span className="text-emerald-400 font-bold text-xs">${order.total.toFixed(2)}</span>
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
                    accepting={patching.has(order.id)}
                    declining={patching.has(order.id)}
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
                    onMarkReady={handleMarkReady}
                    patching={patching.has(order.id)}
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
                    patching={patching.has(order.id)}
                  />
                ))
          )}
        </div>
      </div>

      {/* Bottom quick-nav — mobile only (desktop has sidebar) */}
      <div className="shrink-0 border-t border-white/[0.04] px-4 py-3 lg:hidden">
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Orders',    href: 'orders',    icon: ShoppingBag },
            { label: 'Menu',      href: 'menu',      icon: Store },
            { label: 'Analytics', href: 'analytics', icon: BarChart2 },
            { label: 'Settings',  href: 'settings',  icon: Settings },
          ].map(({ label, href, icon: Icon }) => (
            <Link
              key={label}
              href={`/vendor/${params.fairSlug}/${href}`}
              className="bg-bg-card border border-white/[0.06] rounded-xl p-3 flex flex-col items-center gap-1.5 no-underline hover:border-white/15 transition-all group"
            >
              <Icon className="w-4 h-4 text-text-gray group-hover:text-neon-pink transition-colors" />
              <span className="text-[0.6rem] font-medium text-text-gray group-hover:text-white transition-colors">{label}</span>
            </Link>
          ))}
        </div>
      </div>

    </div>
  )
}
