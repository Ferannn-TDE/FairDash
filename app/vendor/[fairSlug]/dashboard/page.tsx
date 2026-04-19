'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  CurrencyDollarIcon,
  ShoppingBagIcon,
  BanknotesIcon,
  ClockIcon,
  CheckCircleIcon,
  BellIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  Squares2X2Icon,
  ChartBarIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { getFirebaseApp } from '@/lib/firebase-client'
import { ADMIN_HEARTBEAT_INTERVAL_MS } from '@/lib/constants'

// ── Types ──────────────────────────────────────────────────────────────────────

interface VendorOrder {
  id: string
  customer: string
  items: string
  total: number
  status: string
  time: string
  fulfillmentType: string
}

interface VendorStats {
  todayRevenue: number
  todayOrders: number
  avgOrderValue: number
  pendingOrders: number
  cancellationRate?: number
  acceptanceRate?: number
}

interface RevenuePoint {
  day: string
  revenue: number
}

interface Vendor {
  id: string
  name: string
  eventId: string
  isOffline?: boolean
  isBusy?: boolean
  menuItems?: unknown[]
}

// ── Constants ──────────────────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizeRestOrder(o: any): VendorOrder {
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

function normalizeFirebaseOrder(data: any): VendorOrder {
  return {
    id: data.orderId,
    customer: data.customerName ?? '—',
    items: data.itemSummary ?? '—',
    total: data.total ?? 0,
    status: data.status,
    time: new Date(data.placedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    fulfillmentType: data.fulfillmentType,
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[0.6875rem] font-semibold border ${STATUS_STYLES[status] ?? STATUS_STYLES.PLACED}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

function StatCard({
  label, value, trend, trendUp, icon: Icon, accentColor = 'pink', loading,
}: {
  label: string
  value: string | number
  trend?: string
  trendUp?: boolean
  icon: React.ElementType
  accentColor?: 'pink' | 'amber' | 'emerald' | 'blue'
  loading?: boolean
}) {
  const accent = {
    pink:    { bg: 'bg-neon-pink/10',    border: 'border-neon-pink/20',    text: 'text-neon-pink' },
    amber:   { bg: 'bg-amber-500/10',    border: 'border-amber-500/20',    text: 'text-amber-400' },
    emerald: { bg: 'bg-emerald-500/10',  border: 'border-emerald-500/20',  text: 'text-emerald-400' },
    blue:    { bg: 'bg-blue-500/10',     border: 'border-blue-500/20',     text: 'text-blue-400' },
  }[accentColor]

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-5 transition-all duration-300 hover:border-white/20 hover:-translate-y-0.5">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 ${accent.bg} ${accent.border} border rounded-xl flex items-center justify-center shrink-0`}>
          <Icon className={`w-5 h-5 ${accent.text}`} />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-semibold ${trendUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {trendUp ? <ArrowTrendingUpIcon className="w-3.5 h-3.5" /> : <ArrowTrendingDownIcon className="w-3.5 h-3.5" />}
            {trend}
          </div>
        )}
      </div>
      {loading ? (
        <div className="h-8 w-24 bg-white/5 rounded-lg animate-pulse mb-1" />
      ) : (
        <div className="font-bebas text-[2rem] tracking-wide text-white leading-none mb-1">{value}</div>
      )}
      <div className="text-text-gray text-[0.6875rem] uppercase tracking-wide font-semibold">{label}</div>
    </div>
  )
}

function EarningsChart({
  data, period, onPeriodChange, loading,
}: {
  data: RevenuePoint[]
  period: string
  onPeriodChange: (p: string) => void
  loading: boolean
}) {
  const max = Math.max(...data.map((d) => d.revenue).filter((v) => v > 0), 1)
  const total = data.reduce((s, d) => s + d.revenue, 0)

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 flex flex-col">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="font-bebas text-xl tracking-wide text-white mb-0.5">Revenue Overview</h3>
          <p className="text-text-gray text-sm">
            <span className="text-white font-semibold">
              ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>{' '}
            this period
          </p>
        </div>
        <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5">
          {['7d', '30d', '90d'].map((p) => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 border-0 uppercase ${
                period === p ? 'bg-neon-pink text-white shadow-[0_2px_8px_rgba(255,0,119,0.3)]' : 'bg-transparent text-text-gray hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-end gap-2 flex-1 min-h-0" style={{ height: '8rem' }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full">
              <div className="w-full rounded-t-md bg-white/5 animate-pulse" style={{ height: `${20 + (i * 13) % 60}%` }} />
              <div className="w-6 h-2 bg-white/5 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-end gap-2 flex-1 min-h-0" style={{ height: '8rem' }}>
          {data.map((item, i) => {
            const isLast = i === data.length - 1
            const heightPct = Math.max((item.revenue / max) * 100, 3)
            return (
              <div key={`${item.day}-${i}`} className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full group">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-bg-dark border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-semibold whitespace-nowrap pointer-events-none mb-1">
                  ${item.revenue.toFixed(0)}
                </div>
                <div
                  className={`w-full rounded-t-md transition-all duration-700 ${
                    isLast
                      ? 'bg-neon-pink/20 border border-neon-pink/30 border-b-0'
                      : 'bg-gradient-to-t from-neon-pink to-[#ff6eb7] group-hover:from-[#e0006b] group-hover:to-neon-pink'
                  }`}
                  style={{ height: `${heightPct}%` }}
                />
                <span className={`text-[0.5625rem] font-semibold uppercase tracking-wide ${isLast ? 'text-neon-pink' : 'text-text-gray'}`}>
                  {item.day}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/5">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-gradient-to-t from-neon-pink to-[#ff6eb7]" />
          <span className="text-text-gray text-[0.625rem] font-semibold uppercase tracking-wide">Past Days</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-neon-pink/20 border border-neon-pink/30" />
          <span className="text-text-gray text-[0.625rem] font-semibold uppercase tracking-wide">Today</span>
        </div>
      </div>
    </div>
  )
}

function LiveOrderQueue({
  orders, onUpdateStatus, updatingIds,
}: {
  orders: VendorOrder[]
  onUpdateStatus: (id: string, status: string) => void
  updatingIds: Set<string>
}) {
  const active = orders.filter((o) => ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status))

  const queueBg: Record<string, string> = {
    PLACED:    'border-neon-pink/30 bg-neon-pink/5',
    ACCEPTED:  'border-amber-500/30 bg-amber-500/5',
    PREPARING: 'border-amber-500/30 bg-amber-500/5',
    READY:     'border-blue-500/30 bg-blue-500/5',
  }

  const actionStyle: Record<string, string> = {
    PLACED:    'bg-neon-pink hover:bg-[#e0006b] shadow-[0_2px_8px_rgba(255,0,119,0.3)]',
    ACCEPTED:  'bg-amber-500 hover:bg-amber-600 shadow-[0_2px_8px_rgba(245,158,11,0.3)]',
    PREPARING: 'bg-amber-500 hover:bg-amber-600 shadow-[0_2px_8px_rgba(245,158,11,0.3)]',
    READY:     'bg-blue-500 hover:bg-blue-600 shadow-[0_2px_8px_rgba(59,130,246,0.3)]',
  }

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-bebas text-xl tracking-wide text-white">Live Queue</h3>
        {active.length > 0 && (
          <span className="bg-neon-pink text-white text-xs font-bold px-2.5 py-1 rounded-full animate-pulse">
            {active.length} active
          </span>
        )}
      </div>

      {active.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
          <CheckCircleIcon className="w-12 h-12 text-emerald-400/30 mb-3" />
          <p className="text-white font-semibold text-sm mb-1">All caught up!</p>
          <p className="text-text-gray text-xs">No active orders right now.</p>
        </div>
      ) : (
        <div className="space-y-3 overflow-y-auto flex-1">
          {active.map((order) => {
            const isUpdating = updatingIds.has(order.id)
            return (
              <div
                key={order.id}
                className={`p-4 rounded-xl border transition-all duration-200 ${queueBg[order.status] ?? 'border-white/10 bg-white/5'}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-white text-sm">#{order.id.slice(-8).toUpperCase()}</span>
                  <StatusBadge status={order.status} />
                </div>
                <p className="text-text-gray text-xs mb-0.5">{order.customer}</p>
                <p className="text-white/60 text-xs mb-3 truncate">{order.items}</p>
                <div className="flex items-center justify-between">
                  <span className="text-neon-pink font-bold text-sm">${order.total.toFixed(2)}</span>
                  {ORDER_NEXT_STATUS[order.status] && (
                    <button
                      disabled={isUpdating}
                      onClick={() => onUpdateStatus(order.id, ORDER_NEXT_STATUS[order.status])}
                      className={`px-3 py-1.5 text-white rounded-lg text-xs font-semibold cursor-pointer border-0 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${actionStyle[order.status]}`}
                    >
                      {isUpdating ? '…' : ORDER_ACTION_LABEL[order.status]}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function OrdersTable({
  orders, onUpdateStatus, updatingIds,
}: {
  orders: VendorOrder[]
  onUpdateStatus: (id: string, status: string) => void
  updatingIds: Set<string>
}) {
  const [filter, setFilter] = useState('all')
  const filtered = filter === 'all' ? orders : orders.filter((o) => o.status === filter)

  const filterOptions = [
    { value: 'all',       label: `All (${orders.length})` },
    { value: 'PLACED',    label: 'New' },
    { value: 'PREPARING', label: 'Preparing' },
    { value: 'READY',     label: 'Ready' },
    { value: 'COMPLETED', label: 'Completed' },
    { value: 'CANCELLED', label: 'Cancelled' },
  ]

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-white/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-bebas text-xl tracking-wide text-white">All Orders</h3>
            <p className="text-text-gray text-xs">{orders.length} orders today</p>
          </div>
          <div className="flex gap-1.5 flex-wrap">
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
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-text-gray text-sm">No orders match this filter.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Order ID', 'Customer', 'Items', 'Total', 'Status', 'Time', 'Action'].map((h) => (
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
                    <td className="px-6 py-4 text-sm text-white/70 max-w-[200px] truncate">{order.items}</td>
                    <td className="px-6 py-4 text-sm font-bold text-neon-pink whitespace-nowrap">${order.total.toFixed(2)}</td>
                    <td className="px-6 py-4 whitespace-nowrap"><StatusBadge status={order.status} /></td>
                    <td className="px-6 py-4 text-xs text-text-gray whitespace-nowrap">{order.time}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {ORDER_NEXT_STATUS[order.status] ? (
                        <button
                          disabled={isUpdating}
                          onClick={() => onUpdateStatus(order.id, ORDER_NEXT_STATUS[order.status])}
                          className="px-3 py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-neon-pink/10 hover:border-neon-pink/30 hover:text-neon-pink transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isUpdating ? '…' : ORDER_ACTION_LABEL[order.status]}
                        </button>
                      ) : (
                        <span className="text-text-gray/40 text-xs">—</span>
                      )}
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
        ) : (
          filtered.map((order) => {
            const isUpdating = updatingIds.has(order.id)
            return (
              <div key={order.id} className="p-4 hover:bg-white/[0.02] transition-colors">
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
                      onClick={() => onUpdateStatus(order.id, ORDER_NEXT_STATUS[order.status])}
                      className="px-3 py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-neon-pink/10 hover:border-neon-pink/30 hover:text-neon-pink transition-all duration-200 disabled:opacity-50"
                    >
                      {isUpdating ? '…' : ORDER_ACTION_LABEL[order.status]}
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function VendorDashboardPage() {
  const params = useParams<{ fairSlug: string }>()

  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [vendorLoading, setVendorLoading] = useState(true)
  const [stats, setStats] = useState<VendorStats | null>(null)
  const [revenueData, setRevenueData] = useState<RevenuePoint[]>([])
  const [revenuePeriod, setRevenuePeriod] = useState('7d')
  const [revenueLoading, setRevenueLoading] = useState(false)
  const [orders, setOrders] = useState<VendorOrder[]>([])
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set())
  const [isStoreOpen, setIsStoreOpen] = useState(true)
  const [isBusy, setIsBusy] = useState(false)

  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 1. Fetch vendor on mount
  useEffect(() => {
    fetch('/api/vendors/me')
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) { setVendorLoading(false); return }
        const v = json.data.vendor as Vendor
        setVendor(v)
        setIsStoreOpen(!v.isOffline)
        setIsBusy(v.isBusy ?? false)
        setVendorLoading(false)
      })
      .catch(() => setVendorLoading(false))
  }, [])

  // 2. Load stats + today's orders when vendor is known
  useEffect(() => {
    if (!vendor) return

    fetch(`/api/vendors/${vendor.id}/stats`)
      .then((r) => r.json())
      .then((json) => { if (json.success) setStats(json.data) })
      .catch(() => {})

    fetch(`/api/vendors/${vendor.id}/orders`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setOrders(json.data.orders.map(normalizeRestOrder))
      })
      .catch(() => {})
  }, [vendor?.id])

  // 3. Revenue chart — refetch when period changes
  useEffect(() => {
    if (!vendor) return
    setRevenueLoading(true)
    fetch(`/api/vendors/${vendor.id}/revenue?period=${revenuePeriod}`)
      .then((r) => r.json())
      .then((json) => { if (json.success) setRevenueData(json.data.data) })
      .catch(() => {})
      .finally(() => setRevenueLoading(false))
  }, [vendor?.id, revenuePeriod])

  // 4. Firebase RTDB listener + heartbeat
  useEffect(() => {
    if (!vendor?.id || !vendor?.eventId) return

    const app = getFirebaseApp()
    if (!app) return

    let unsubAdded: (() => void) | null = null
    let unsubChanged: (() => void) | null = null

    import('firebase/database').then(({ getDatabase, ref, onChildAdded, onChildChanged, off, set }) => {
      const db = getDatabase(app)
      const ordersRef = ref(db, `fairs/${vendor.eventId}/orders/${vendor.id}`)

      unsubAdded = onChildAdded(ordersRef, (snap) => {
        const data = snap.val()
        if (!data) return
        if (data.status === 'PLACED') {
          try { new Audio('/sounds/order-alert.mp3').play() } catch (_) {}
        }
        setOrders((prev) => {
          if (prev.find((o) => o.id === data.orderId)) return prev
          return [normalizeFirebaseOrder(data), ...prev]
        })
      }) as unknown as () => void

      unsubChanged = onChildChanged(ordersRef, (snap) => {
        const data = snap.val()
        if (!data) return
        setOrders((prev) => prev.map((o) => o.id === data.orderId ? { ...o, status: data.status } : o))
      }) as unknown as () => void

      // Heartbeat
      const heartbeatRef_ = ref(db, `fairs/${vendor.eventId}/heartbeats/${vendor.id}`)
      const ping = () => set(heartbeatRef_, Date.now()).catch(() => {})
      ping()
      heartbeatRef.current = setInterval(ping, ADMIN_HEARTBEAT_INTERVAL_MS)

      return () => {
        off(ordersRef)
        if (heartbeatRef.current) clearInterval(heartbeatRef.current)
      }
    })

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }
  }, [vendor?.id, vendor?.eventId])

  // 5. Status update handler
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
      const labels: Record<string, string> = { ACCEPTED: 'Accepted', PREPARING: 'Preparing', READY: 'Marked ready', COMPLETED: 'Completed' }
      toast.success(`#${orderId.slice(-8).toUpperCase()} — ${labels[newStatus] ?? newStatus}`)
      if (newStatus === 'COMPLETED' && vendor) {
        fetch(`/api/vendors/${vendor.id}/stats`).then((r) => r.json()).then((j) => { if (j.success) setStats(j.data) }).catch(() => {})
      }
    } catch (err: any) {
      toast.error(err.message || 'Could not update order status')
    } finally {
      setUpdatingIds((prev) => { const s = new Set(prev); s.delete(orderId); return s })
    }
  }, [vendor?.id])

  const handleToggleStore = useCallback(async () => {
    if (!vendor) return
    const nextIsOffline = isStoreOpen
    try {
      const res = await fetch(`/api/vendors/${vendor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isOffline: nextIsOffline }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message || 'Update failed')
      setIsStoreOpen((prev) => { toast.success(prev ? 'Store marked closed' : "You're live!"); return !prev })
    } catch (err: any) {
      toast.error(err.message || 'Could not update store status')
    }
  }, [vendor?.id, isStoreOpen])

  const handleToggleBusy = useCallback(async () => {
    if (!vendor) return
    try {
      const res = await fetch(`/api/vendors/${vendor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isBusy: !isBusy }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message || 'Update failed')
      setIsBusy((prev) => { toast.success(prev ? 'No longer busy' : 'Busy mode on — new orders paused for 15 min'); return !prev })
    } catch (err: any) {
      toast.error(err.message || 'Could not update busy status')
    }
  }, [vendor?.id, isBusy])

  // ── Derived ───────────────────────────────────────────────────────────────────
  const pendingCount = orders.filter((o) => ['PLACED', 'ACCEPTED', 'PREPARING'].includes(o.status)).length
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  if (vendorLoading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-2 border-neon-pink border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-text-gray text-sm">Loading vendor dashboard…</p>
        </div>
      </div>
    )
  }

  if (!vendor) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <ExclamationTriangleIcon className="w-12 h-12 text-amber-400 mx-auto mb-4 opacity-60" />
          <h2 className="font-bebas text-2xl tracking-wide text-white mb-2">No vendor found</h2>
          <p className="text-text-gray text-sm mb-6">
            Your account is not linked to a vendor profile. Please complete vendor onboarding first.
          </p>
          <Link
            href="/become-vendor"
            className="inline-flex items-center gap-2 px-5 py-3 bg-neon-pink text-white rounded-xl font-semibold text-sm no-underline hover:opacity-90 transition-opacity"
          >
            Apply to become a vendor
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-4 sm:p-3 max-w-[78rem] mx-auto">

      {/* Page Header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight mb-1">
            Vendor <span className="text-neon-pink">Dashboard</span>
          </h1>
          <p className="text-text-gray text-sm">{dateStr}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
          <div className={`hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${isStoreOpen ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
            <span className={`w-2 h-2 rounded-full ${isStoreOpen ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            {isStoreOpen ? 'Open' : 'Closed'}
          </div>
          <button
            onClick={handleToggleStore}
            className={`hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all duration-200 ${isStoreOpen ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400' : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-emerald-500/10 hover:border-emerald-500/20 hover:text-emerald-400'}`}
          >
            {isStoreOpen ? 'Close Store' : 'Open Store'}
          </button>
          <button
            onClick={handleToggleBusy}
            className={`hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all duration-200 ${isBusy ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white'}`}
          >
            <ClockIcon className="w-3.5 h-3.5" />
            {isBusy ? 'Busy (15 min)' : 'Set Busy'}
          </button>
          <div className="relative hidden desktop:flex p-2 bg-bg-card border border-white/10 rounded-xl">
            <BellIcon className="w-5 h-5 text-white" />
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-neon-pink text-white text-[0.5rem] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-2 desktop:grid-cols-4 gap-4 mb-8 animate-fadeIn">
        <StatCard label="Today's Revenue" value={stats ? `$${stats.todayRevenue.toFixed(2)}` : '$0.00'} loading={!stats} icon={CurrencyDollarIcon} accentColor="pink" />
        <StatCard label="Today's Orders"  value={stats ? stats.todayOrders : '—'} loading={!stats} icon={ShoppingBagIcon} accentColor="blue" />
        <StatCard label="Avg Order Value" value={stats ? `$${stats.avgOrderValue.toFixed(2)}` : '$0.00'} loading={!stats} icon={BanknotesIcon} accentColor="emerald" />
        <StatCard
          label="Pending Orders"
          value={stats ? stats.pendingOrders : pendingCount}
          trend={pendingCount > 0 ? `${pendingCount} active` : undefined}
          trendUp={false}
          loading={!stats}
          icon={ClockIcon}
          accentColor="amber"
        />
      </div>

      {/* Chart + Live Queue */}
      <div className="grid grid-cols-1 desktop:grid-cols-[1fr_22rem] gap-5 mb-8 animate-fadeIn [animation-delay:0.1s]">
        <EarningsChart data={revenueData} period={revenuePeriod} onPeriodChange={setRevenuePeriod} loading={revenueLoading} />
        <LiveOrderQueue orders={orders} onUpdateStatus={handleUpdateStatus} updatingIds={updatingIds} />
      </div>

      {/* Orders Table */}
      <div className="mb-8 animate-fadeIn [animation-delay:0.2s]">
        <OrdersTable orders={orders} onUpdateStatus={handleUpdateStatus} updatingIds={updatingIds} />
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6 animate-fadeIn [animation-delay:0.3s]">
        {[
          { label: 'Manage Menu',      desc: 'Edit items & prices',  href: `/vendor/${params.fairSlug}/menu`,      icon: Squares2X2Icon },
          { label: 'View Analytics',   desc: 'Revenue & insights',   href: `/vendor/${params.fairSlug}/analytics`, icon: ChartBarIcon },
          { label: 'Account Settings', desc: 'Business profile',     href: `/vendor/${params.fairSlug}/settings`,  icon: Cog6ToothIcon },
        ].map(({ label, desc, href, icon: Icon }) => (
          <Link
            key={label}
            href={href}
            className="bg-bg-card border border-white/10 rounded-2xl p-5 no-underline hover:border-white/20 hover:-translate-y-0.5 transition-all duration-300 group"
          >
            <Icon className="w-5 h-5 text-text-gray group-hover:text-neon-pink transition-colors mb-3" />
            <p className="text-white font-semibold text-sm mb-0.5">{label}</p>
            <p className="text-text-gray text-xs">{desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
