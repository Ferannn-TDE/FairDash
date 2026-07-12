'use client'

import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue, startTransition } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { UserAvatar } from '../_components/VendorPortalShell'
import {
  CheckCircle, Bell, ChevronRight, AlertCircle, RefreshCw, Clock,
} from 'lucide-react'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { useVendorMeta } from '@/lib/contexts/VendorContext'
import { getFirebaseApp } from '@/lib/firebase-client'
import { StatusPill } from '@/components/ui/StatusPill'
import { EarningsBadge } from '@/app/_components/EarningsBadge'
import { isCompleted, isFailed } from '@/lib/order-status'
import { deriveOnlineState } from '@/lib/vendor-online-state'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrderItem {
  itemName: string
  quantity: number
  unitPrice: number
}

export type OrderStatus =
  | 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY'
  | 'RUNNER_COLLECTED' | 'COMPLETED' | 'DELIVERED'
  | 'CANCELLED' | 'DECLINED' | 'UNCOLLECTED' | 'UNDELIVERABLE'

export type FulfillmentType = 'BOOTH_PICKUP' | 'CURBSIDE' | 'HOME_DELIVERY'

export interface VendorOrder {
  id: string
  status: OrderStatus
  fulfillmentType: FulfillmentType
  customerName: string
  customerPhone: string
  // This vendor's own slice (sum of their items) — gross, kept for reference.
  vendorSubtotal: number
  // Take-home + honesty status from the shared earnings helper (what cards show).
  earnings?: number
  earningsStatus?: import('@/app/_components/EarningsBadge').EarningsStatus
  orderItems: OrderItem[]
  placedAt: string
  version?: number
  // curbside
  vehicleMake?: string | null
  vehicleColor?: string | null
  vehiclePlate?: string | null
  // delivery
  deliveryStreet?: string | null
  deliveryCity?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAge(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000)
  if (secs < 10)  return 'just now'
  if (secs < 60)  return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60)  return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

// ─── API helpers ──────────────────────────────────────────────────────────────

// /api/orders/[id] returns the FULL multi-vendor order (all vendors' items +
// order.total). For this vendor's dashboard card we must scope it down: keep
// only this vendor's items and compute THIS vendor's subtotal slice — never the
// full order total. Mirrors what /api/vendors/[id]/orders/active returns.
async function fetchFullOrder(orderId: string, vendorId: string): Promise<VendorOrder | null> {
  try {
    const res = await fetch(`/api/orders/${orderId}`)
    const json = await res.json()
    if (!json.success) return null
    const o = json.data
    const mine = (o.orderItems ?? []).filter((i: { vendorId?: string }) => i.vendorId === vendorId)
    const vendorSubtotal = parseFloat(
      mine.reduce((s: number, i: { unitPrice: number; quantity: number }) => s + i.unitPrice * i.quantity, 0).toFixed(2),
    )
    return {
      ...o,
      vendorSubtotal,
      orderItems: mine.map((i: { itemName: string; quantity: number; unitPrice: number }) => ({
        itemName: i.itemName, quantity: i.quantity, unitPrice: i.unitPrice,
      })),
    }
  } catch {
    return null
  }
}

// 409 = already in target state (idempotent) — treat as success
async function transitionOrder(orderId: string, status: string): Promise<void> {
  const res = await fetch(`/api/orders/${orderId}/vendor-status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  if (!res.ok && res.status !== 409) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json?.error?.message ?? 'Status update failed')
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtId(id: string) { return '#' + id.slice(-8).toUpperCase() }
function fmtItems(order: VendorOrder) {
  return order.orderItems.map(i => `${i.quantity}× ${i.itemName}`).join(', ')
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

function StatCard({ label, value, color = 'pink', hint }: {
  label: string; value: string | number
  color?: 'pink' | 'blue' | 'emerald' | 'amber'
  hint?: string
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
      {hint && <p className="text-[0.6rem] text-amber-400/70 font-semibold mt-1">{hint}</p>}
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

function IncomingCard({ order, onAccept, onDecline, accepting }: {
  order: VendorOrder
  onAccept: (o: VendorOrder) => void
  onDecline: (o: VendorOrder) => void
  accepting?: boolean
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
        <EarningsBadge amount={order.earnings ?? order.vendorSubtotal} status={order.earningsStatus ?? 'estimated'} />
        <div className="flex gap-1.5">
          <button
            onClick={() => onDecline(order)}
            disabled={accepting}
            className="px-3 py-1.5 bg-white/5 border border-white/10 text-text-gray rounded-lg text-[0.65rem] font-semibold hover:border-red-500/30 hover:text-red-400 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Decline
          </button>
          <button
            onClick={() => onAccept(order)}
            disabled={accepting}
            className="px-3 py-1.5 bg-neon-pink text-white rounded-lg text-[0.65rem] font-semibold hover:bg-[#e0006b] transition-all shadow-[0_2px_10px_rgba(255,0,119,0.3)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {accepting ? 'Accepting…' : '✓ Accept'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Active Order Card ─────────────────────────────────────────────────────────

function ActiveCard({ order, onStartPreparing, onMarkReady, submitting }: {
  order: VendorOrder
  onStartPreparing: (o: VendorOrder) => void
  onMarkReady: (o: VendorOrder) => void
  submitting?: boolean
}) {
  const detail = fmtDeliveryDetail(order)
  const isAccepted = order.status === 'ACCEPTED'

  return (
    <div className="bg-bg-card border border-amber-500/20 rounded-xl p-3.5">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-white text-xs">{fmtId(order.id)}</span>
          <StatusPill status={order.status} />
        </div>
        <span className="text-text-gray text-[0.65rem] shrink-0">{fmtFulfillment(order.fulfillmentType)}</span>
      </div>
      <p className="text-white/70 text-xs mb-1 leading-snug">{fmtItems(order)}</p>
      {detail && <p className="text-text-gray text-[0.65rem] mb-2">{detail}</p>}
      <div className="flex items-center justify-between mt-2.5">
        <EarningsBadge amount={order.earnings ?? order.vendorSubtotal} status={order.earningsStatus ?? 'estimated'} />
        {isAccepted ? (
          <button
            onClick={() => onStartPreparing(order)}
            disabled={submitting}
            className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg text-[0.65rem] font-semibold hover:bg-blue-500/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Updating…' : 'Start Preparing'}
          </button>
        ) : (
          <button
            onClick={() => onMarkReady(order)}
            disabled={submitting}
            className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg text-[0.65rem] font-semibold hover:bg-amber-500/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Updating…' : 'Mark Ready'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Ready Card ────────────────────────────────────────────────────────────────

function ReadyCard({ order, onComplete, submitting }: {
  order: VendorOrder
  onComplete: (o: VendorOrder) => void
  submitting?: boolean
}) {
  const detail = fmtDeliveryDetail(order)

  return (
    <div className="bg-bg-card border border-emerald-500/20 rounded-xl p-3.5">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-white text-xs">{fmtId(order.id)}</span>
          <StatusPill status={order.status} />
        </div>
        <span className="text-text-gray text-[0.65rem] shrink-0">{fmtFulfillment(order.fulfillmentType)}</span>
      </div>
      <p className="text-white/70 text-xs mb-1 leading-snug">{fmtItems(order)}</p>
      {detail && <p className="text-text-gray text-[0.65rem] mb-2">{detail}</p>}
      <div className="flex items-center justify-between mt-2.5">
        <span className="text-text-gray text-xs">Waiting for pickup</span>
        <button
          onClick={() => onComplete(order)}
          disabled={submitting}
          className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-[0.65rem] font-semibold hover:bg-emerald-500/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Updating…' : 'Mark Picked Up'}
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

// ─── Completed Order Row ──────────────────────────────────────────────────────

function CompletedOrderRow({ order }: { order: VendorOrder }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="min-w-0 flex-1">
        <span className="text-xs font-semibold text-white">{fmtId(order.id)}</span>
        <p className="text-text-gray text-[0.6rem] mt-0.5 truncate max-w-[130px]">{fmtItems(order)}</p>
      </div>
      <span className="shrink-0 ml-2"><EarningsBadge amount={order.earnings ?? order.vendorSubtotal} status={order.earningsStatus ?? 'estimated'} /></span>
    </div>
  )
}

// ─── Declined Order Row ────────────────────────────────────────────────────────

function DeclinedOrderRow({ order }: { order: VendorOrder }) {
  const label = order.status === 'DECLINED' ? 'Declined'
    : order.status === 'CANCELLED' ? 'Cancelled'
    : order.status === 'UNCOLLECTED' ? 'Uncollected'
    : 'Failed'

  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="min-w-0 flex-1">
        <span className="text-xs font-semibold text-white/60">{fmtId(order.id)}</span>
        <p className="text-text-gray text-[0.6rem] mt-0.5 truncate max-w-[130px]">{fmtItems(order)}</p>
      </div>
      <span className="text-[0.6rem] font-semibold text-red-400 shrink-0 ml-2">{label}</span>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type Tab = 'incoming' | 'active' | 'ready' | 'done'

export default function VendorDashboardPage() {
  const params = useParams<{ fairSlug: string }>()
  const { vendorId, eventId, vendorName } = useVendorMeta()

  // The vendor's OWN choice to be open for orders. Defaults FALSE, not true: an
  // unapproved vendor must never render "Online", and even an approved one shouldn't be
  // claimed online before we know their real state. (This toggle is currently local-only —
  // it does not yet persist to Vendor.isOffline; that wiring is a separate follow-up. Its
  // job here is to stop LYING, which is the reported bug.)
  const [isOnline,          setIsOnline]          = useState(false)
  const [activeTab,         setActiveTab]         = useState<Tab>('incoming')
  // THE SELECTION IS A UI FACT, NOT A DATA FACT.
  //
  // activeTab drove BOTH the tab highlight and the panel content. Switching tabs unmounts
  // N order cards and mounts M — expensive — and React rendered that in the SAME pass as
  // the highlight, so the paint was blocked until the whole card list was reconciled. The
  // symptom was a ~500ms freeze and then everything snapping at once (a slow CSS
  // transition would have animated smoothly instead; the state setter is synchronous, so
  // it was never a late state update either).
  //
  // Split the two: `activeTab` is URGENT and paints the highlight immediately on click.
  // `deferredTab` lags by one render and drives the heavy panel, so the expensive work
  // happens in a background pass that cannot block the click feedback.
  const deferredTab = useDeferredValue(activeTab)
  const tabSwitchPending = deferredTab !== activeTab
  const [loading,           setLoading]           = useState(true)
  const [declineTarget,     setDeclineTarget]     = useState<VendorOrder | null>(null)
  const [todayOrders,       setTodayOrders]       = useState<number>(0)
  const [todayRevenue,      setTodayRevenue]      = useState<number>(0)
  const [todayEarned,       setTodayEarned]       = useState<number>(0)
  const [todayPending,      setTodayPending]      = useState<number>(0)
  const [statsLoading,      setStatsLoading]      = useState(false)
  const [lastVerifiedAt,    setLastVerifiedAt]    = useState<Date>(() => new Date())
  const [firebaseConnected, setFirebaseConnected] = useState(true)
  // The DEBOUNCED view of the above — what the UI is allowed to react to.
  //
  // Firebase's `.info/connected` fires FALSE first on every subscribe: it reports
  // disconnected until the socket actually completes its handshake, then flips true a few
  // hundred ms later. Rendering straight off firebaseConnected therefore flashed a
  // full-width amber "Live updates paused" bar on every load/refresh — for a connection
  // that was never broken. A warning that fires when nothing is wrong is worse than no
  // warning: it teaches the vendor to ignore the one that matters.
  //
  // So: only surface a disconnect that PERSISTS past the grace window, and clear it the
  // instant we reconnect. A real outage still shows the banner ~2s in; the handshake
  // blip never does.
  const [liveUpdatesDown, setLiveUpdatesDown] = useState(false)
  const [lastUpdated,       setLastUpdated]       = useState<Date>(() => new Date())
  // Grace window before a dropped connection is shown to the vendor (see liveUpdatesDown).
  const LIVE_DOWN_GRACE_MS = 2500
  useEffect(() => {
    if (firebaseConnected) {
      // Reconnected (or never really disconnected) — clear immediately, no grace.
      setLiveUpdatesDown(false)
      return
    }
    const t = setTimeout(() => setLiveUpdatesDown(true), LIVE_DOWN_GRACE_MS)
    return () => clearTimeout(t) // handshake blip resolves inside the window → never shown
  }, [firebaseConnected])

  // Ticker re-renders the "X ago" label without touching any order state.
  // Fires every 15s — cheap enough and keeps the label accurate.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  // ── Readiness gate ────────────────────────────────────────────────────────────
  // Reads the SAME readiness endpoint as the checklist (Phase 1 single source of
  // truth) — no parallel "is ready" computation here. Drives the "not live yet"
  // banner. Re-reads on focus so finishing setup removes the banner without reload.
  type RStep = { key: string; label: string; done: boolean; required: boolean; waiting?: boolean }
  const [readiness, setReadiness] = useState<{ ready: boolean; steps: RStep[] } | null>(null)
  useEffect(() => {
    if (!vendorId) return
    let cancelled = false
    const loadReadiness = async () => {
      try {
        const res = await fetch(`/api/vendors/${vendorId}/readiness`, { cache: 'no-store' })
        const json = await res.json()
        if (!cancelled && json.success) setReadiness(json.data)
      } catch { /* non-fatal — the banner just won't render */ }
    }
    loadReadiness()
    const onFocus = () => loadReadiness()
    const onVis = () => { if (document.visibilityState === 'visible') loadReadiness() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [vendorId])

  // ── Normalized order store ────────────────────────────────────────────────────
  // Single source of truth. Lanes are derived via useMemo — no duplicate state,
  // no multi-array fan-out. Any update (optimistic, rollback, or Firebase push)
  // is a single setOrdersById call.
  const [ordersById, setOrdersById] = useState<Record<string, VendorOrder>>({})

  const incoming     = useMemo(() => Object.values(ordersById).filter(o => o.status === 'PLACED'),                                   [ordersById])
  const active       = useMemo(() => Object.values(ordersById).filter(o => ['ACCEPTED', 'PREPARING'].includes(o.status)),            [ordersById])
  const ready        = useMemo(() => Object.values(ordersById).filter(o => ['READY', 'RUNNER_COLLECTED'].includes(o.status)),        [ordersById])
  const completed    = useMemo(() => Object.values(ordersById).filter(o => isCompleted(o.status)).sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime()), [ordersById])
  const failedOrders = useMemo(() => Object.values(ordersById).filter(o => isFailed(o.status)).sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime()),   [ordersById])
  const inQueue      = incoming.length + active.length + ready.length

  // ── Online status is GATED ON APPROVAL — the vendor twin of the runner approval gate ──
  // The bug: the badge showed a hardcoded "Online" next to an "Application under review"
  // banner — the screen contradicting itself. An unapproved vendor is not online, can't
  // take orders, and must not present as available. So the online control is LOCKED until
  // the organizer approves the application, driven by the SAME readiness the banner uses
  // (so the two can never disagree again).
  //
  // `awaitingApproval` is derived, not defaulted — and while readiness is still loading we
  // treat the vendor as NOT online (same "don't show the wrong thing while waiting"
  // discipline as the rest of this screen), so the badge never flashes Online on load.
  const { awaitingApproval, locked: onlineControlLocked, showOnline } = deriveOnlineState(readiness, isOnline)

  // ── In-flight guard ──────────────────────────────────────────────────────────
  const inFlightRef    = useRef<Set<string>>(new Set())
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())

  function startProcessing(id: string): boolean {
    if (inFlightRef.current.has(id)) return false
    inFlightRef.current.add(id)
    setProcessingIds(prev => new Set(prev).add(id))
    return true
  }
  function stopProcessing(id: string) {
    inFlightRef.current.delete(id)
    setProcessingIds(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  // Patch a single order's status in the map
  function patchStatus(id: string, status: VendorOrder['status'], extra?: Partial<VendorOrder>) {
    setOrdersById(prev => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], status, ...extra } }
    })
  }

  // Track Firebase order IDs we've already fetched
  const seenOrderIds = useRef<Set<string>>(new Set())

  // ── Data fetchers (stable refs so useEffect deps stay clean) ────────────────

  const refetchActiveOrders = useCallback(() => {
    if (!vendorId) return
    Promise.all([
      fetch(`/api/vendors/${vendorId}/orders/active`).then(r => r.json()),
      fetch(`/api/vendors/${vendorId}/orders/history?status=COMPLETED,DELIVERED,DECLINED,CANCELLED,UNCOLLECTED,UNDELIVERABLE&range=today&take=20`).then(r => r.json()),
    ])
      .then(([ordersJson, historyJson]) => {
        const activeOrders:    VendorOrder[] = ordersJson.data?.orders  ?? []
        const completedOrders: VendorOrder[] = historyJson.data?.orders ?? []
        const all = [...activeOrders, ...completedOrders]
        all.forEach(o => seenOrderIds.current.add(o.id))
        // Merge into map — preserves any orders that arrived via Firebase
        // after the last REST fetch and aren't in the fresh response yet.
        setOrdersById(prev => {
          const next = { ...prev }
          all.forEach(o => { next[o.id] = o })
          return next
        })
      })
      .catch(() => {})
  }, [vendorId])

  // ── Initial REST load ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!vendorId) return
    Promise.all([
      fetch(`/api/vendors/${vendorId}/orders/active`).then(r => r.json()),
      fetch(`/api/vendors/${vendorId}/analytics?range=today`).then(r => r.json()),
      fetch(`/api/vendors/${vendorId}/orders/history?status=COMPLETED,DELIVERED,DECLINED,CANCELLED,UNCOLLECTED,UNDELIVERABLE&range=today&take=20`).then(r => r.json()),
    ])
      .then(([ordersJson, analyticsJson, historyJson]) => {
        const activeOrders:    VendorOrder[] = ordersJson.data?.orders   ?? []
        const completedOrders: VendorOrder[] = historyJson.data?.orders  ?? []
        const all = [...activeOrders, ...completedOrders]
        all.forEach(o => seenOrderIds.current.add(o.id))
        setOrdersById(Object.fromEntries(all.map(o => [o.id, o])))

        if (analyticsJson.success) {
          setTodayOrders(analyticsJson.data.totalOrders  ?? 0)
          setTodayRevenue(analyticsJson.data.totalRevenue ?? 0)
          setTodayEarned(analyticsJson.data.earned ?? 0)
          setTodayPending(analyticsJson.data.pending ?? 0)
          setLastVerifiedAt(new Date())
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [vendorId])

  // ── Firebase connection state + browser online recovery ─────────────────────
  // .info/connected is a special Firebase path that mirrors the WebSocket state.
  // On reconnect we immediately refetch from Postgres to catch any orders or
  // status changes that arrived while the socket was down — Firebase queues
  // writes but child listeners don't replay missed events on reconnect.
  // The browser 'online' event covers the case where the device had no network
  // at all (WiFi drop, sleep) and Firebase never had a chance to detect it.

  useEffect(() => {
    if (!eventId || !vendorId) return
    const app = getFirebaseApp()
    if (!app) return

    let cleanupFn: (() => void) | null = null

    import('firebase/database').then(({ getDatabase, ref, onValue, off }) => {
      const db           = getDatabase(app)
      const connectedRef = ref(db, '.info/connected')

      const handler = onValue(connectedRef, (snap) => {
        const connected = snap.val() === true
        setFirebaseConnected(connected)
        if (connected) refetchActiveOrders()
      })

      cleanupFn = () => off(connectedRef, 'value', handler)
    }).catch(() => {})

    const handleBrowserOnline = () => refetchActiveOrders()
    window.addEventListener('online', handleBrowserOnline)

    return () => {
      cleanupFn?.()
      window.removeEventListener('online', handleBrowserOnline)
    }
  }, [eventId, vendorId, refetchActiveOrders])

  // ── Stats: Firebase live updates + 60s polling fallback ─────────────────────
  // Firebase listener on vendorStats/{vendorId} receives a push every time the
  // vendor-status route increments counts after a COMPLETED or DECLINED transition.
  // The 60s interval is a safety net: it re-syncs from Postgres if Firebase is
  // down or the push arrives out of order. Both sources write the same state,
  // so whichever fires last wins — both are authoritative Postgres-derived values.

  useEffect(() => {
    if (!vendorId) return
    const interval = setInterval(() => {
      fetch(`/api/vendors/${vendorId}/analytics?range=today`)
        .then(r => r.json())
        .then(json => {
          if (!json.success) return
          setTodayOrders(json.data.totalOrders  ?? 0)
          setTodayRevenue(json.data.totalRevenue ?? 0)
          setTodayEarned(json.data.earned ?? 0)
          setTodayPending(json.data.pending ?? 0)
          setLastVerifiedAt(new Date())
        })
        .catch(() => {})
    }, 60_000)
    return () => clearInterval(interval)
  }, [vendorId])

  useEffect(() => {
    if (!eventId || !vendorId) return
    const app = getFirebaseApp()
    if (!app) return

    type StatsPayload = { todayOrders?: number; todayRevenue?: number; updatedAt?: number }
    let cleanupFn: (() => void) | null = null

    import('firebase/database').then(({ getDatabase, ref, onValue, off }) => {
      const db       = getDatabase(app)
      const statsRef = ref(db, `fairs/${eventId}/vendorStats/${vendorId}`)
      const handler  = onValue(statsRef, (snapshot) => {
        const data = snapshot.val() as StatsPayload | null
        if (!data) return
        if (data.todayOrders  !== undefined) setTodayOrders(data.todayOrders)
        if (data.todayRevenue !== undefined) setTodayRevenue(data.todayRevenue)
        setLastVerifiedAt(new Date())
      })
      cleanupFn = () => off(statsRef, 'value', handler)
    }).catch(() => {})

    return () => { cleanupFn?.() }
  }, [eventId, vendorId])

  // ── Firebase RTDB listeners ──────────────────────────────────────────────────
  // onChildAdded  → new PLACED orders: fetch full REST shape, insert into map
  // onChildChanged → status changes: single patchStatus call, cross-tab sync

  useEffect(() => {
    if (!eventId || !vendorId) return
    const app = getFirebaseApp()
    if (!app) return

    type OrderPayload = { id?: string; status: string; updatedAt?: number; version?: number }
    let cleanupFn: (() => void) | null = null

    import('firebase/database').then(({ getDatabase, ref, onChildAdded, onChildChanged, off }) => {
      const db        = getDatabase(app)
      const ordersRef = ref(db, `fairs/${eventId}/orders/${vendorId}`)

      const addedHandler = onChildAdded(ordersRef, (snapshot) => {
        const data = snapshot.val() as OrderPayload | null
        if (!data || data.status !== 'PLACED') return
        const orderId = snapshot.key!
        if (seenOrderIds.current.has(orderId)) return
        if (inFlightRef.current.has(orderId)) return
        seenOrderIds.current.add(orderId)
        fetchFullOrder(orderId, vendorId).then(order => {
          if (!order) return
          startTransition(() => {
            setOrdersById(prev => prev[orderId] ? prev : { ...prev, [orderId]: order })
            setLastUpdated(new Date())
          })
        })
      })

      const changedHandler = onChildChanged(ordersRef, (snapshot) => {
        const data = snapshot.val() as OrderPayload | null
        if (!data?.status) return
        const orderId = snapshot.key!
        if (inFlightRef.current.has(orderId)) return
        startTransition(() => {
          setOrdersById(prev => {
            const existing = prev[orderId]
            if (!existing) return prev
            // Discard stale pushes — version is a DB integer, incremented on every transition
            if (data.version !== undefined && data.version <= (existing.version ?? 0)) return prev
            return { ...prev, [orderId]: { ...existing, status: data.status as VendorOrder['status'], version: data.version } }
          })
          setLastUpdated(new Date())
        })
      })

      cleanupFn = () => {
        off(ordersRef, 'child_added',   addedHandler)
        off(ordersRef, 'child_changed', changedHandler)
      }
    }).catch(() => {})

    return () => { cleanupFn?.() }
  }, [eventId, vendorId])

  // ── Transition handlers ──────────────────────────────────────────────────────

  const handleAccept = useCallback(async (order: VendorOrder) => {
    if (!startProcessing(order.id)) return
    patchStatus(order.id, 'ACCEPTED')
    try {
      await transitionOrder(order.id, 'ACCEPTED')
    } catch (err) {
      console.error('Accept failed:', err)
      patchStatus(order.id, order.status)
    } finally {
      stopProcessing(order.id)
    }
  }, [])

  const handleDecline = useCallback(async (order: VendorOrder) => {
    if (!startProcessing(order.id)) return
    patchStatus(order.id, 'DECLINED')
    try {
      await transitionOrder(order.id, 'DECLINED')
    } catch (err) {
      console.error('Decline failed:', err)
      patchStatus(order.id, order.status)
    } finally {
      stopProcessing(order.id)
    }
  }, [])

  const handleStartPreparing = useCallback(async (order: VendorOrder) => {
    if (!startProcessing(order.id)) return
    try {
      await transitionOrder(order.id, 'PREPARING')
      patchStatus(order.id, 'PREPARING')
    } catch (err) {
      console.error('Start preparing failed:', err)
    } finally {
      stopProcessing(order.id)
    }
  }, [])

  const handleMarkReady = useCallback(async (order: VendorOrder) => {
    if (!startProcessing(order.id)) return
    try {
      await transitionOrder(order.id, 'READY')
      patchStatus(order.id, 'READY')
    } catch (err) {
      console.error('Mark ready failed:', err)
    } finally {
      stopProcessing(order.id)
    }
  }, [])

  const handleComplete = useCallback(async (order: VendorOrder) => {
    if (!startProcessing(order.id)) return
    patchStatus(order.id, 'COMPLETED')
    try {
      await transitionOrder(order.id, 'COMPLETED')
    } catch (err) {
      console.error('Complete failed:', err)
      patchStatus(order.id, order.status)
    } finally {
      stopProcessing(order.id)
    }
  }, [])

  // ── Manual stats refresh ─────────────────────────────────────────────────────

  const refreshStats = useCallback(async () => {
    if (!vendorId || statsLoading) return
    setStatsLoading(true)
    try {
      const res  = await fetch(`/api/vendors/${vendorId}/analytics?range=today&bust=${Date.now()}`)
      const json = await res.json()
      if (json.success) {
        setTodayOrders(json.data.totalOrders   ?? 0)
        setTodayRevenue(json.data.totalRevenue ?? 0)
          setTodayEarned(json.data.earned ?? 0)
          setTodayPending(json.data.pending ?? 0)
        setLastVerifiedAt(new Date())
      }
    } catch { /* silent */ } finally {
      setStatsLoading(false)
    }
  }, [vendorId, statsLoading])

  // ── Render ───────────────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'incoming', label: 'Incoming',  count: incoming.length },
    { id: 'active',   label: 'Preparing', count: active.length   },
    { id: 'ready',    label: 'Ready',     count: ready.length    },
    { id: 'done',     label: 'Done',      count: completed.length + failedOrders.length },
  ]

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">

      {/* Firebase disconnection banner — driven by the DEBOUNCED flag, never the raw
          connection state, so the initial-handshake false-negative can't flash it. */}
      {liveUpdatesDown && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500/90 backdrop-blur-sm text-black text-xs text-center py-1.5 font-medium">
          ⚠️ Live updates paused — reconnecting…
        </div>
      )}

      {/* Readiness gate — only when NOT ready (a ready vendor sees no nag). Copy is
          about being LIVE/visible, not "completeness", so the not-yet-connected
          cohort understands they're invisible to customers until they finish. */}
      {readiness && !readiness.ready && (() => {
        const appStep = readiness.steps.find(s => s.key === 'application')
        const pending = Boolean(appStep?.waiting)
        const remaining = readiness.steps.filter(s => s.required && !s.done && !s.waiting)
        return (
          <div className="shrink-0 px-4 sm:px-5 pt-3">
            {pending ? (
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
                <Clock className="w-5 h-5 text-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-300">Application under review</p>
                  <p className="text-xs text-text-gray">You&apos;ll be able to finish setup and go live once the organizer approves you.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-neon-pink/10 border border-neon-pink/30">
                <AlertCircle className="w-5 h-5 text-neon-pink shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">You&apos;re not live yet</p>
                  <p className="text-xs text-text-gray">
                    Customers can&apos;t see or order from you until you finish setup
                    {remaining.length > 0 && (
                      <> — {remaining.length} step{remaining.length === 1 ? '' : 's'} left: {remaining.map(s => s.label).join(', ')}</>
                    )}.
                  </p>
                </div>
                <Link
                  href={`/vendor/${params.fairSlug}/onboarding`}
                  className="shrink-0 px-3.5 py-2 bg-neon-pink text-white text-xs font-semibold rounded-xl hover:bg-[#e0006b] transition-colors no-underline"
                >
                  Finish setup →
                </Link>
              </div>
            )}
          </div>
        )
      })()}

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
              onClick={() => { if (!onlineControlLocked) setIsOnline(v => !v) }}
              disabled={onlineControlLocked}
              title={awaitingApproval ? 'Locked until the organizer approves your application' : undefined}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border font-semibold text-xs transition-all ${
                onlineControlLocked
                  ? 'bg-white/5 border-white/10 text-text-gray cursor-not-allowed'
                  : showOnline
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/15 cursor-pointer'
                    : 'bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/15 cursor-pointer'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${showOnline ? 'bg-emerald-400 animate-pulse' : onlineControlLocked ? 'bg-text-gray' : 'bg-red-400'}`} />
              {awaitingApproval ? 'Offline · Awaiting approval' : showOnline ? 'Online' : 'Offline'}
            </button>
            <UserAvatar />
          </div>
        </div>

        {/* The manual "you chose to go offline" notice — only for an APPROVED vendor who
            toggled off. A vendor awaiting approval already has the amber review banner; a
            second "store is offline" line would be noise, and the reason isn't the toggle. */}
        {!showOnline && !onlineControlLocked && (
          <div className="mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-red-300 text-xs font-medium">
              Store is offline — customers cannot place orders.
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Orders Today" value={loading ? '…' : todayOrders} color="blue" />
          <div className="relative">
            <StatCard
              label="Earned Today"
              value={loading ? '…' : `$${(todayEarned ?? 0).toFixed(0)}`}
              color="emerald"
              hint={!loading && todayPending > 0 ? `~$${todayPending.toFixed(0)} pending` : undefined}
            />
            <button
              onClick={refreshStats}
              disabled={statsLoading}
              title="Refresh revenue"
              className="absolute top-2.5 right-2.5 text-white/20 hover:text-white/60 transition-colors cursor-pointer disabled:opacity-40 border-0 bg-transparent p-0"
            >
              <RefreshCw className={`w-3 h-3 ${statsLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <StatCard label="In Queue" value={loading ? '…' : inQueue} color="amber" />
        </div>

        <div className="flex items-center justify-between mt-2">
          <p className="text-[0.6rem] text-white/30">
            Revenue verified {formatAge(lastVerifiedAt)}
          </p>
          <p className="text-[0.6rem] text-white/30">
            {liveUpdatesDown
              ? '⚠️ Reconnecting…'
              : `Live · ${formatAge(lastUpdated)}`}
          </p>
        </div>
      </div>

      {/* Tab bar — shown at every width BELOW the four-lane board (see the board's note).
          A cramped four-lane board is worse than one full-width lane: at a fair the vendor
          is watching one lane at a time anyway (what's incoming, or what's ready), so
          letting them pick the lane and giving it the whole screen beats showing all four
          badly. */}
      <div className="xl:hidden flex border-b border-white/[0.04] shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            // THE WHITE BAR. The inactive state used to carry NO border class at all, so
            // its border-bottom fell back to Tailwind's PREFLIGHT DEFAULT — #e5e7eb, a
            // light grey that reads as white on #0F0F0F. `transition-all` then animated the
            // departing tab's border from neon-pink toward that default while its width
            // shrank 2px → 0, so the bar you just left visibly faded THROUGH WHITE. Both
            // bars did. Nothing was ever "white" on purpose; it was the un-overridden
            // default leaking in through the transition.
            //
            // Fix: give the inactive state an EXPLICIT `border-b-2 border-transparent`.
            // The width is now always 2px (so no width animation and no layout shift), and
            // the colour interpolates pink ↔ transparent — never through the default.
            // `transition-colors` (150ms) also stops `transition-all` from animating
            // anything else that happens to differ between the two states.
            className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-colors duration-150 cursor-pointer ${
              activeTab === tab.id
                ? 'text-neon-pink border-neon-pink'
                : 'text-text-gray border-transparent hover:text-white'
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

        {/* The four-lane board — TWO layouts only, no cramped middle ground.
              ≥ xl (1400px) → this board, four lanes side by side
              < xl          → the tabbed full-width single lane (below)

            WHY 1400 AND NOT ~1000. The lane width is NOT viewport ÷ 4: VendorPortalShell
            renders a FIXED sidebar from lg up (`lg:w-64 xl:w-72` — 256px, then 288px),
            which comes straight off the board. Actual per-lane widths:
              968px  →  (968 − 256) / 4 = 178px   ← unusable, crushes an order card
              1250px →  (1250 − 256) / 4 = 248px  ← still tight
              1400px →  (1400 − 288) / 4 = 278px  ← comfortable
              1509px →  (1509 − 288) / 4 = 305px  ← the width that looks right today
            Switching at ~968px would have produced a WORSE board than the one being
            replaced. 1400 is the first breakpoint where four lanes are genuinely readable.

            TO TUNE: this is one token. `xl:` → `desktop:` gives 248px lanes (board appears
            sooner, lanes tighter); anything below that is not worth having.

            Dividers are a 1px grid gap over the grid's own background rather than
            `divide-x`, which borders by DOM order and would misplace a line if the grid
            ever wrapped. Lanes carry min-h-0 so their overflow-y-auto scrolls instead of
            blowing out the row. */}
        <div className="hidden xl:grid xl:grid-cols-4 h-full gap-px bg-white/[0.04]">

          {/* Incoming lane */}
          <div className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden bg-bg-dark">
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
                    onDecline={(o) => setDeclineTarget(o)}
                    accepting={processingIds.has(order.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Preparing lane */}
          <div className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden bg-bg-dark">
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
                    submitting={processingIds.has(order.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Ready lane */}
          <div className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden bg-bg-dark">
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
                    submitting={processingIds.has(order.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Completed / Failed lane */}
          <div className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden bg-bg-dark">
            <LaneHeader label="Completed Today" count={completed.length + failedOrders.length} />
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-3 space-y-2">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-white/5 rounded-xl animate-pulse" />)}
                </div>
              ) : completed.length === 0 && failedOrders.length === 0 ? (
                <EmptyLane message="No completed orders yet" />
              ) : (
                <>
                  {completed.length > 0 && (
                    <div className="bg-bg-card border border-white/5 rounded-xl mx-3 mt-3 overflow-hidden">
                      {completed.map(order => (
                        <CompletedOrderRow key={order.id} order={order} />
                      ))}
                    </div>
                  )}
                  {failedOrders.length > 0 && (
                    <div className="mx-3 mt-3">
                      <p className="text-[0.6rem] uppercase tracking-wider text-text-gray font-semibold mb-2 px-1">
                        Declined / Cancelled
                      </p>
                      <div className="bg-bg-card border border-red-500/10 rounded-xl overflow-hidden">
                        {failedOrders.map(order => (
                          <DeclinedOrderRow key={order.id} order={order} />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="px-3 py-3">
                    <Link
                      href={`/vendor/${params.fairSlug}/orders`}
                      className="text-neon-pink text-[0.65rem] font-semibold flex items-center gap-1 no-underline hover:underline"
                    >
                      Full order history <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tabbed full-width single lane — everything below xl. Driven by DEFERRED tab, not
            activeTab: this panel is the expensive part (swapping the whole card list), and
            rendering it in the same pass as the highlight is what blocked the click paint.
            The one-frame lag is invisible; the blocked paint was not. A brief dim while the
            swap lands is honest feedback — it says "working", not "nothing happened". */}
        <div
          className={`xl:hidden h-full overflow-y-auto p-3 space-y-3 transition-opacity duration-150 ${
            tabSwitchPending ? 'opacity-60' : 'opacity-100'
          }`}
        >
          {deferredTab === 'incoming' && (
            incoming.length === 0
              ? <EmptyLane message="No incoming orders right now" />
              : incoming.map(order => (
                  <IncomingCard
                    key={order.id}
                    order={order}
                    onAccept={handleAccept}
                    onDecline={(o) => setDeclineTarget(o)}
                    accepting={processingIds.has(order.id)}
                  />
                ))
          )}
          {deferredTab === 'active' && (
            active.length === 0
              ? <EmptyLane message="No active orders" />
              : active.map(order => (
                  <ActiveCard
                    key={order.id}
                    order={order}
                    onStartPreparing={handleStartPreparing}
                    onMarkReady={handleMarkReady}
                    submitting={processingIds.has(order.id)}
                  />
                ))
          )}
          {deferredTab === 'ready' && (
            ready.length === 0
              ? <EmptyLane message="No orders staged for pickup" />
              : ready.map(order => (
                  <ReadyCard
                    key={order.id}
                    order={order}
                    onComplete={handleComplete}
                    submitting={processingIds.has(order.id)}
                  />
                ))
          )}
          {deferredTab === 'done' && (
            completed.length === 0 && failedOrders.length === 0
              ? <EmptyLane message="No completed orders yet" />
              : <>
                  {completed.length > 0 && (
                    <div className="bg-bg-card border border-white/5 rounded-xl overflow-hidden">
                      {completed.map(order => <CompletedOrderRow key={order.id} order={order} />)}
                    </div>
                  )}
                  {failedOrders.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[0.6rem] uppercase tracking-wider text-text-gray font-semibold mb-2 px-1">Declined / Cancelled</p>
                      <div className="bg-bg-card border border-red-500/10 rounded-xl overflow-hidden">
                        {failedOrders.map(order => <DeclinedOrderRow key={order.id} order={order} />)}
                      </div>
                    </div>
                  )}
                </>
          )}
        </div>
      </div>

      {declineTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-bebas text-xl text-white tracking-wide">Decline Order?</h3>
                <p className="text-white/40 text-xs">
                  #{declineTarget.id.slice(-8).toUpperCase()} · {declineTarget.orderItems?.[0]?.itemName ?? ''}
                </p>
              </div>
            </div>
            <p className="text-white/60 text-sm mb-6">
              The customer will be notified and a full refund will be issued automatically.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeclineTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/5 transition-colors cursor-pointer"
              >
                Keep Order
              </button>
              <button
                onClick={() => { handleDecline(declineTarget); setDeclineTarget(null) }}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-colors cursor-pointer"
              >
                Yes, Decline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
