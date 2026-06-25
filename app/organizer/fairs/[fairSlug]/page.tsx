'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  BuildingStorefrontIcon,
  ShoppingBagIcon,
  CurrencyDollarIcon,
  BoltIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import { OrganizerBreadcrumb } from '../../_components/Breadcrumb'
import { getFirebaseApp } from '@/lib/firebase-client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventInfo {
  id: string
  name: string
  urlSlug: string
  status: string
  isPaused: boolean
  startDate: string
  endDate: string
}

interface Stats {
  liveOrders: number
  ordersToday: number
  revenueToday: number
  platformFee: number
  activeVendors: number
  totalVendors: number
}

interface VendorRow {
  id: string
  name: string
  slug: string
  cuisineType: string
  boothNumber: string | null
  status: string
  isOffline: boolean
  isBusy: boolean
  stripeVerified: boolean
  connected: boolean
  ordersToday: number
}

interface RecentOrder {
  id: string
  status: string
  total: number
  placedAt: string
  customerName: string
  vendorId: string
  vendorName: string
  itemSummary: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 30_000

const ORDER_STATUS_STYLES: Record<string, string> = {
  PLACED:           'bg-yellow-500/10 text-yellow-400',
  ACCEPTED:         'bg-yellow-500/10 text-yellow-400',
  PREPARING:        'bg-blue-500/10 text-blue-400',
  READY:            'bg-green-500/10 text-green-400',
  RUNNER_COLLECTED: 'bg-green-500/10 text-green-400',
  COMPLETED:        'bg-white/5 text-[#555]',
  DELIVERED:        'bg-white/5 text-[#555]',
  CANCELLED:        'bg-red-500/10 text-red-400',
  UNCOLLECTED:      'bg-orange-500/10 text-orange-400',
}

const VENDOR_STATUS_STYLES: Record<string, string> = {
  ACTIVE:    'text-green-400',
  PENDING:   'text-yellow-400',
  PAUSED:    'text-sky-400',
  SUSPENDED: 'text-orange-400',
  REJECTED:  'text-red-400',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  loading,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
  accent: 'pink' | 'blue' | 'emerald' | 'amber'
  loading?: boolean
}) {
  const colors = {
    pink:    { ring: 'bg-[#FF0077]/10 border-[#FF0077]/20', icon: 'text-[#FF0077]' },
    blue:    { ring: 'bg-blue-500/10 border-blue-500/20',    icon: 'text-blue-400'  },
    emerald: { ring: 'bg-emerald-500/10 border-emerald-500/20', icon: 'text-emerald-400' },
    amber:   { ring: 'bg-amber-500/10 border-amber-500/20',  icon: 'text-amber-400' },
  }[accent]

  return (
    <div className="bg-[#111111] rounded-2xl border border-white/5 p-5 hover:border-white/10 transition-all">
      <div className={`w-9 h-9 rounded-xl border flex items-center justify-center mb-4 ${colors.ring}`}>
        <Icon className={`w-4 h-4 ${colors.icon}`} />
      </div>
      {loading ? (
        <div className="h-8 w-24 bg-white/5 rounded-lg animate-pulse mb-1" />
      ) : (
        <p className="font-bebas text-[2rem] text-white leading-none mb-1">{value}</p>
      )}
      <p className="text-[#555] text-[0.6rem] uppercase tracking-wider font-semibold">{label}</p>
      {sub && <p className="text-[#444] text-[0.6rem] mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function FairDashboardPage() {
  const params = useParams<{ fairSlug: string }>()
  const { fairSlug } = params

  const [event, setEvent] = useState<EventInfo | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [vendors, setVendors] = useState<VendorRow[]>([])
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  // Live heartbeats from Firebase — overlaid on top of DB vendor status
  const [heartbeats, setHeartbeats] = useState<Record<string, number>>({})
  const firebaseCleanupRef = useRef<(() => void) | null>(null)

  // ── Data fetch ─────────────────────────────────────────────────────────────

  const fetchDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const res  = await fetch(`/api/organizer/fairs/${fairSlug}/dashboard`)
      const json = await res.json()
      if (!json.data) return
      setEvent(json.data.event)
      setStats(json.data.stats)
      setVendors(json.data.vendorGrid)
      setRecentOrders(json.data.recentOrders)
      setLastRefreshed(new Date())
    } catch {
      // silently fail on background refresh
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [fairSlug])

  // Initial load
  useEffect(() => { void fetchDashboard(false) }, [fetchDashboard])

  // 30s polling
  useEffect(() => {
    const id = setInterval(() => { void fetchDashboard(true) }, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [fetchDashboard])

  // ── Firebase heartbeats (live vendor connectivity) ─────────────────────────
  useEffect(() => {
    if (!event?.id) return
    const app = getFirebaseApp()
    if (!app) return

    let cleanupFn: (() => void) | null = null

    import('firebase/database').then(({ getDatabase, ref, onValue, off }) => {
      const db = getDatabase(app)
      const hbRef = ref(db, `fairs/${event.id}/heartbeats`)
      const handler = onValue(hbRef, snap => {
        const val = snap.val() as Record<string, number> | null
        if (val) setHeartbeats(val)
      })
      cleanupFn = () => off(hbRef, 'value', handler)
      firebaseCleanupRef.current = cleanupFn
    }).catch(() => {})

    return () => { cleanupFn?.() }
  }, [event?.id])

  // ── Derived vendor status (DB + Firebase overlay) ─────────────────────────
  const now = Date.now()
  const enrichedVendors = vendors.map(v => {
    const fbHeartbeat = heartbeats[v.id]
    const isConnected = fbHeartbeat
      ? now - fbHeartbeat < 60_000
      : v.connected
    return { ...v, connected: isConnected }
  })

  const onlineVendors  = enrichedVendors.filter(v => v.status === 'ACTIVE' && !v.isOffline)
  const offlineVendors = enrichedVendors.filter(v => v.status === 'ACTIVE' && v.isOffline)
  const pendingVendors = enrichedVendors.filter(v => v.status === 'PENDING')

  // ── Not found ──────────────────────────────────────────────────────────────

  if (!loading && !event) {
    return (
      <div className="text-center py-20">
        <p className="text-[#666] font-inter text-sm">Fair not found or access denied.</p>
        <Link href="/organizer/fairs" className="mt-4 inline-block text-[#FF0077] text-sm hover:underline">← Back to Fairs</Link>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      {event && (
        <OrganizerBreadcrumb crumbs={[
          { label: 'My Fairs', href: '/organizer/fairs' },
          { label: event.name },
        ]} />
      )}

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          {loading ? (
            <>
              <div className="h-8 w-56 bg-white/5 rounded-lg animate-pulse mb-2" />
              <div className="h-4 w-40 bg-white/5 rounded animate-pulse" />
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-bebas text-3xl text-white tracking-wide leading-none">{event?.name}</h1>
                {event && (
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider
                    ${event.status === 'ACTIVE'   ? 'bg-green-500/15 text-green-400' :
                      event.status === 'UPCOMING' ? 'bg-sky-500/15 text-sky-400' :
                                                     'bg-white/5 text-[#666]'}`}>
                    {event.isPaused ? 'PAUSED' : event.status}
                  </span>
                )}
              </div>
              {event && (
                <p className="text-[#555] text-sm font-inter mt-1">
                  {formatDate(event.startDate)} – {formatDate(event.endDate)}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {lastRefreshed && !loading && (
            <span className="text-[#444] text-xs font-inter hidden sm:block">
              Updated {timeAgo(lastRefreshed.toISOString())}
            </span>
          )}
          <button
            onClick={() => { void fetchDashboard(true) }}
            disabled={refreshing}
            className="p-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <ArrowPathIcon className={`w-4 h-4 text-[#666] ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Active Vendors"
          value={loading ? '—' : String(stats?.activeVendors ?? 0)}
          sub={loading ? undefined : `of ${stats?.totalVendors ?? 0} total`}
          icon={BuildingStorefrontIcon}
          accent="pink"
          loading={loading}
        />
        <StatCard
          label="Live Orders"
          value={loading ? '—' : String(stats?.liveOrders ?? 0)}
          sub="in progress"
          icon={BoltIcon}
          accent="amber"
          loading={loading}
        />
        <StatCard
          label="Revenue Today"
          value={loading ? '—' : `$${(stats?.revenueToday ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          sub={loading ? undefined : `$${(stats?.platformFee ?? 0).toFixed(2)} platform fee`}
          icon={CurrencyDollarIcon}
          accent="emerald"
          loading={loading}
        />
        <StatCard
          label="Orders Today"
          value={loading ? '—' : String(stats?.ordersToday ?? 0)}
          icon={ShoppingBagIcon}
          accent="blue"
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">

        {/* ── Vendor status grid (3 cols) ─────────────────────────── */}
        <div className="xl:col-span-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bebas text-xl text-white tracking-wide">Vendor Status</h2>
            {pendingVendors.length > 0 && (
              <Link
                href={`/organizer/fairs/${fairSlug}/vendors?tab=PENDING`}
                className="text-xs text-yellow-400 hover:underline font-inter"
              >
                {pendingVendors.length} pending approval
              </Link>
            )}
          </div>

          {loading ? (
            <div className="bg-[#111111] rounded-2xl border border-white/5 divide-y divide-white/5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-4 animate-pulse">
                  <div className="w-8 h-8 rounded-lg bg-white/5 shrink-0" />
                  <div className="flex-1">
                    <div className="h-4 w-32 bg-white/5 rounded mb-1.5" />
                    <div className="h-3 w-20 bg-white/5 rounded" />
                  </div>
                  <div className="h-4 w-12 bg-white/5 rounded" />
                </div>
              ))}
            </div>
          ) : enrichedVendors.length === 0 ? (
            <div className="bg-[#111111] rounded-2xl border border-white/5 p-8 text-center">
              <BuildingStorefrontIcon className="w-8 h-8 mx-auto mb-3 text-[#333]" />
              <p className="text-[#555] font-inter text-sm">No vendors yet.</p>
              <Link
                href={`/organizer/fairs/${fairSlug}/vendors`}
                className="text-xs text-[#FF0077] hover:underline font-inter mt-2 inline-block"
              >
                Manage vendors →
              </Link>
            </div>
          ) : (
            <div className="bg-[#111111] rounded-2xl border border-white/5 divide-y divide-white/5">
              {/* Online first, then offline, then pending */}
              {[...onlineVendors, ...offlineVendors, ...pendingVendors].map(vendor => (
                <Link
                  key={vendor.id}
                  href={`/organizer/fairs/${fairSlug}/vendors/${vendor.slug}`}
                  className="flex items-center gap-3 p-4 hover:bg-white/[0.02] transition-colors"
                >
                  {/* Online dot */}
                  <div className="relative shrink-0">
                    <div className="w-8 h-8 rounded-lg bg-[#FF0077]/10 flex items-center justify-center">
                      <span className="font-bebas text-[#FF0077] text-sm">{vendor.name[0]}</span>
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#111111]
                      ${vendor.isOffline ? 'bg-[#444]' : vendor.connected ? 'bg-green-400' : 'bg-yellow-400'}`}
                    />
                  </div>

                  {/* Name + cuisine */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-inter font-medium truncate">{vendor.name}</p>
                    <p className="text-xs font-inter truncate">
                      <span className={VENDOR_STATUS_STYLES[vendor.status] ?? 'text-[#555]'}>
                        {vendor.isOffline ? 'Offline' : vendor.isBusy ? 'Busy' : vendor.status}
                      </span>
                      {vendor.boothNumber && (
                        <span className="text-[#444] ml-1">· Booth {vendor.boothNumber}</span>
                      )}
                    </p>
                  </div>

                  {/* Orders today */}
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bebas text-white tabular-nums">{vendor.ordersToday}</p>
                    <p className="text-[10px] text-[#444] font-inter">orders</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* ── Recent orders (2 cols) ─────────────────────────────── */}
        <div className="xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bebas text-xl text-white tracking-wide">Recent Orders</h2>
            <Link
              href={`/organizer/fairs/${fairSlug}/orders`}
              className="text-xs text-[#FF0077] hover:underline font-inter"
            >
              View all →
            </Link>
          </div>

          {loading ? (
            <div className="bg-[#111111] rounded-2xl border border-white/5 divide-y divide-white/5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3 p-4 animate-pulse">
                  <div>
                    <div className="h-4 w-20 bg-white/5 rounded mb-1.5" />
                    <div className="h-3 w-32 bg-white/5 rounded" />
                  </div>
                  <div className="h-4 w-12 bg-white/5 rounded" />
                </div>
              ))}
            </div>
          ) : recentOrders.length === 0 ? (
            <div className="bg-[#111111] rounded-2xl border border-white/5 p-8 text-center">
              <ShoppingBagIcon className="w-8 h-8 mx-auto mb-3 text-[#333]" />
              <p className="text-[#555] font-inter text-sm">No orders yet.</p>
            </div>
          ) : (
            <div className="bg-[#111111] rounded-2xl border border-white/5 divide-y divide-white/5">
              {recentOrders.map(order => (
                <div key={order.id} className="flex items-center justify-between gap-3 p-4 hover:bg-white/[0.02] transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-xs text-white font-inter font-semibold">
                        #{order.id.slice(-6).toUpperCase()}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${ORDER_STATUS_STYLES[order.status] ?? ''}`}>
                        {order.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#555] font-inter truncate">
                      {order.vendorName} · {timeAgo(order.placedAt)}
                    </p>
                    {order.itemSummary && (
                      <p className="text-[10px] text-[#3a3a3a] font-inter truncate mt-0.5">{order.itemSummary}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm text-white font-inter font-semibold tabular-nums">
                      ${(order.total ?? 0).toFixed(2)}
                    </p>
                    <p className="text-[10px] text-[#444] font-inter truncate max-w-[80px]">{order.customerName}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
