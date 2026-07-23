'use client'

import { useState, useMemo, useEffect, use, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, ChevronDown, ChevronUp, Package, User, Store, Clock, ArrowUpDown } from 'lucide-react'
import { STRAND_THRESHOLDS_MS } from '@/lib/constants'

// ─── Types (the real /api/admin/events/[id]/orders shape) ─

type AdminOrderStatus =
  | 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'RUNNER_COLLECTED'
  | 'COMPLETED' | 'DELIVERED' | 'CANCELLED' | 'UNCOLLECTED' | 'UNDELIVERABLE'
  | 'REFUNDED'

interface AdminOrderItem { id?: string; name: string; quantity: number }

interface AdminOrder {
  id: string
  status: AdminOrderStatus
  fulfillmentType: string
  customerName: string
  vendorName: string
  total: number
  placedAt: string
  items: AdminOrderItem[]
  cancellationReason?: string | null
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PLACED:           { label: 'New',           cls: 'bg-neon-pink/10 text-neon-pink border-neon-pink/20' },
  ACCEPTED:         { label: 'Accepted',      cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  PREPARING:        { label: 'Preparing',     cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  READY:            { label: 'Ready',         cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  RUNNER_COLLECTED: { label: 'En Route',      cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  COMPLETED:        { label: 'Completed',     cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  DELIVERED:        { label: 'Delivered',     cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  CANCELLED:        { label: 'Cancelled',     cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  UNCOLLECTED:      { label: 'Uncollected',   cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
  UNDELIVERABLE:    { label: 'Undeliverable', cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
  REFUNDED:         { label: 'Refunded',      cls: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
}

const FULFILLMENT_LABEL: Record<string, string> = {
  BOOTH_PICKUP:  'Booth Pickup',
  CURBSIDE:      'Curbside',
  HOME_DELIVERY: 'Home Delivery',
}

/**
 * The "this looks stuck" threshold. Read from the SAME constant the reconciler's strand clocks
 * use (lib/constants) — not a second number invented for this page, which would drift from the
 * one that actually flags orders. This surface only COLOURS a number; timers flag, humans decide
 * (PROJECT_INVARIANTS), so nothing here acts on an order.
 */
const STUCK_AFTER_MS = STRAND_THRESHOLDS_MS.claimedNotCollected

/** Whole minutes since an order was placed — "stuck" without the arithmetic. */
function minutesSince(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60_000))
}

function formatAge(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  return h < 24 ? `${h}h ${mins % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}

/**
 * Day bucket for grouping. An order's placedAt is an INSTANT, so it groups by the VIEWER's
 * local day — the day the person reading the log lived through. (Fair start/end dates are the
 * other kind and render zone-fixed via lib/event-date; see that module for why they differ.)
 */
function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabel(iso: string, nowMs: number): string {
  const d = new Date(iso)
  if (dayKey(iso) === dayKey(new Date(nowMs).toISOString())) return 'Today'
  if (dayKey(iso) === dayKey(new Date(nowMs - 86_400_000).toISOString())) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const FILTER_TABS = [
  { value: 'all',       label: 'All' },
  { value: 'active',    label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'REFUNDED',  label: 'Refunded' },
] as const

/** The server's hard ceiling (lib/fair-orders clamps take to 100). Named so the "showing the
 *  most recent N" copy and the request can never disagree. */
const PAGE_TAKE = 100

const ACTIVE_STATUSES = new Set(['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED'])
const COMPLETED_STATUSES = new Set(['COMPLETED', 'DELIVERED'])

// Map a filter tab to the set of order statuses it should show.
function matchesTab(status: string, tab: string): boolean {
  if (tab === 'all') return true
  if (tab === 'active') return ACTIVE_STATUSES.has(status)
  if (tab === 'COMPLETED') return COMPLETED_STATUSES.has(status)
  return status === tab
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AdminOrderStatus }) {
  const meta = STATUS_META[status] ?? { label: status, cls: 'bg-white/10 text-text-gray border-white/20' }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[0.6875rem] font-semibold border ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

function OrderRow({ order, nowMs }: { order: AdminOrder; nowMs: number }) {
  const [expanded, setExpanded] = useState(false)
  const placedTime = new Date(order.placedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  // Age is shown for ACTIVE orders only: on a finished order the number answers nothing, and a
  // 6-day-old completed row glowing amber would train the eye to ignore the colour that matters.
  const isActive = ACTIVE_STATUSES.has(order.status)
  const ageMins = isActive ? minutesSince(order.placedAt, nowMs) : null
  const stuck = ageMins !== null && ageMins * 60_000 >= STUCK_AFTER_MS

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden bg-bg-card">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.02] transition-colors text-left cursor-pointer"
      >
        <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
          <span className="font-bold text-white text-sm">#{order.id.slice(-8).toUpperCase()}</span>
          <StatusBadge status={order.status} />
          <span className="text-xs text-text-gray hidden sm:inline">{FULFILLMENT_LABEL[order.fulfillmentType] ?? order.fulfillmentType}</span>
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
        {ageMins !== null && (
          <span
            title={`Placed ${formatAge(ageMins)} ago`}
            className={`shrink-0 tabular-nums text-xs font-semibold px-2 py-0.5 rounded-md ${
              stuck ? 'bg-orange-500/15 text-orange-300' : 'bg-white/5 text-text-gray'
            }`}
          >
            {formatAge(ageMins)}
          </span>
        )}
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
              <p className="text-white">{FULFILLMENT_LABEL[order.fulfillmentType] ?? order.fulfillmentType}</p>
            </div>
          </div>

          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-2">Items</p>
            <div className="space-y-1">
              {order.items.map((item, i) => (
                <p key={item.id ?? i} className="text-sm text-white">
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

export default function AdminOrdersPage({ params: paramsPromise }: { params: Promise<{ eventSlug: string }> }) {
  const params = use(paramsPromise)
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Filter state lives in the URL ────────────────────────────────────────────
  // A fair-day view ("Randy's, delivery, active") survives a refresh, can be kept open in a
  // tab, and can be sent to someone else. Reading FROM the URL means there is one copy of the
  // state, not a local mirror that drifts out of sync with the address bar.
  const router = useRouter()
  const sp = useSearchParams()
  const filter     = sp.get('tab') ?? 'all'
  const search     = sp.get('q') ?? ''
  const vendorFilt = sp.get('vendor') ?? 'all'
  const fulfilFilt = sp.get('type') ?? 'all'
  const sortNewest = sp.get('sort') !== 'oldest'

  const setParam = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || v === 'all') next.delete(k)
      else next.set(k, v)
    }
    const qs = next.toString()
    router.replace(qs ? `?${qs}` : '?', { scroll: false })
  }, [router, sp])

  // One clock for every age in the list, ticking each minute — so all rows agree, and a row
  // does not silently age only when React happens to re-render it.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    // NOTE: the shared query hard-caps take at 100 (lib/fair-orders). During an 8-day fair this
    // log WILL truncate; the header says so plainly rather than implying a total. Cursor
    // pagination exists server-side (nextCursor) and is the proposed follow-up.
    fetch(`/api/admin/events/${params.eventSlug}/orders?take=${PAGE_TAKE}`)
      .then((r) => r.json())
      .then((json) => {
        if (!active) return
        if (!json.success) { setError(json.error?.message ?? 'Failed to load orders'); return }
        setOrders((json.data.orders ?? []) as AdminOrder[])
      })
      .catch(() => { if (active) setError('Failed to load orders') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [params.eventSlug])

  const atCap = orders.length >= PAGE_TAKE

  const tabCounts = useMemo(() => ({
    all:       orders.length,
    active:    orders.filter((o) => ACTIVE_STATUSES.has(o.status)).length,
    COMPLETED: orders.filter((o) => COMPLETED_STATUSES.has(o.status)).length,
    CANCELLED: orders.filter((o) => o.status === 'CANCELLED').length,
    REFUNDED:  orders.filter((o) => o.status === 'REFUNDED').length,
  }), [orders])

  // Vendor options come from the loaded rows — no second source, no invented list.
  const vendorOptions = useMemo(
    () => [...new Set(orders.map(o => o.vendorName))].sort((a, b) => a.localeCompare(b)),
    [orders]
  )

  const filtered = useMemo(() => {
    let list = orders.filter((o) => matchesTab(o.status, filter))
    if (vendorFilt !== 'all') list = list.filter(o => o.vendorName === vendorFilt)
    if (fulfilFilt !== 'all') list = list.filter(o => o.fulfillmentType === fulfilFilt)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      // o.id.includes(q) is what makes the SHORT CODE work: "26685PS7" is the tail of the cuid,
      // so a code read aloud at the tent matches without a separate index.
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
  }, [orders, filter, search, sortNewest, vendorFilt, fulfilFilt])

  // Day buckets, in the order the sort produced them.
  const grouped = useMemo(() => {
    const out: { key: string; label: string; orders: AdminOrder[] }[] = []
    for (const o of filtered) {
      const k = dayKey(o.placedAt)
      const last = out[out.length - 1]
      if (last && last.key === k) last.orders.push(o)
      else out.push({ key: k, label: dayLabel(o.placedAt, nowMs), orders: [o] })
    }
    return out
  }, [filtered, nowMs])

  return (
    <div className="p-6 md:p-4 sm:p-3 max-w-[64rem] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight">
            Order <span className="text-neon-pink">Log</span>
          </h1>
          <p className="text-text-gray text-sm mt-0.5">
            {loading
              ? 'Loading…'
              : atCap
                ? `Showing the ${orders.length} most recent orders`
                : `${orders.length} order${orders.length === 1 ? '' : 's'}`}
            {!loading && filtered.length !== orders.length && (
              <span className="text-white/50"> · {filtered.length} shown</span>
            )}
          </p>
        </div>
        <button
          onClick={() => setParam({ sort: sortNewest ? 'oldest' : null })}
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
          onChange={(e) => setParam({ q: e.target.value })}
          placeholder="Search order code (e.g. 26685PS7), customer, or vendor…"
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
              onClick={() => setParam({ tab: tab.value })}
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

      {/* Vendor + fulfillment filters — "is one vendor falling behind" and "how many
          deliveries are open" are two of the three questions this page exists to answer. */}
      <div className="flex gap-2 flex-wrap mb-5">
        <select
          value={vendorFilt}
          onChange={(e) => setParam({ vendor: e.target.value })}
          className="bg-bg-card border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-neon-pink transition-colors cursor-pointer"
        >
          <option value="all">All vendors</option>
          {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select
          value={fulfilFilt}
          onChange={(e) => setParam({ type: e.target.value })}
          className="bg-bg-card border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-neon-pink transition-colors cursor-pointer"
        >
          <option value="all">All fulfillment</option>
          {Object.entries(FULFILLMENT_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {(vendorFilt !== 'all' || fulfilFilt !== 'all' || filter !== 'all' || search) && (
          <button
            onClick={() => setParam({ vendor: null, type: null, tab: null, q: null })}
            className="px-3 py-2 rounded-xl text-xs font-semibold text-text-gray hover:text-white bg-white/5 border border-white/10 transition-colors cursor-pointer"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Order list */}
      {error ? (
        <div className="bg-bg-card border border-red-500/20 rounded-2xl py-16 text-center">
          <Package className="w-10 h-10 text-red-400/40 mx-auto mb-3" />
          <p className="text-white font-semibold text-sm mb-1">Couldn’t load orders</p>
          <p className="text-text-gray text-xs">{error}</p>
        </div>
      ) : loading ? (
        <div className="bg-bg-card border border-white/10 rounded-2xl py-16 text-center">
          <Package className="w-10 h-10 text-white/10 mx-auto mb-3 animate-pulse" />
          <p className="text-text-gray text-xs">Loading orders…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-bg-card border border-white/10 rounded-2xl py-16 text-center">
          <Package className="w-10 h-10 text-white/10 mx-auto mb-3" />
          <p className="text-white font-semibold text-sm mb-1">No orders found</p>
          <p className="text-text-gray text-xs">Try adjusting your filter or search query.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Grouped by day with a sticky header: over an 8-day fair a bare "18:02" does not
              say WHICH day, and scrolling loses the answer. */}
          {grouped.map((group) => (
            <div key={group.key}>
              <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-[#0a0a0a]/95 backdrop-blur-sm flex items-baseline gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70 font-inter">{group.label}</h2>
                <span className="text-[0.625rem] text-text-gray tabular-nums">
                  {group.orders.length} order{group.orders.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="space-y-2.5 mt-1">
                {group.orders.map((order) => (
                  <OrderRow key={order.id} order={order} nowMs={nowMs} />
                ))}
              </div>
            </div>
          ))}

          {atCap && (
            <p className="text-center text-[0.6875rem] text-text-gray py-3">
              Showing the {PAGE_TAKE} most recent orders — older ones are not loaded yet.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
