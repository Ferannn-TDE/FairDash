'use client'

import { useState, useEffect, useCallback, use } from 'react'
import OrganizerControl, { type OrganizerState } from '../../_components/OrganizerControl'
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  PauseIcon,
} from '@heroicons/react/24/outline'
import type { GoLiveChecklist } from '@/lib/go-live-checklist'

// ─── API response types ───────────────────────────────────────────────────────

interface DashboardStats {
  liveOrders: number
  ordersToday: number
  revenueToday: number
  platformFeeToday: number
  activeVendors: number
  totalVendors: number
  activeRunners: number
}

// Zero-state until the dashboard fetch resolves — replaces the old mock fallback.
const ZERO_STATS: DashboardStats = {
  liveOrders: 0, ordersToday: 0, revenueToday: 0, platformFeeToday: 0,
  activeVendors: 0, totalVendors: 0, activeRunners: 0,
}
const EMPTY_CHECKLIST: GoLiveChecklist = {
  hasActiveVendor: false, hasStripeVendor: false, hasFulfillmentMode: false, hasCoords: false, canGoLive: false,
}

interface DashboardEvent {
  id: string
  name: string
  urlSlug: string
  status: EventStatus
  isPaused: boolean
  startDate: string
  endDate: string
}

interface VendorGridItem {
  id: string
  name: string
  cuisineType: string
  boothNumber: string | null
  status: string
  isOffline: boolean
  isBusy: boolean
  stripeVerified: boolean
  lastHeartbeat: number
  connectionStatus: 'CONNECTED' | 'DISCONNECTED'
  liveStatus: string
  ordersToday?: number
  revenueToday?: number
  avgPrepTime?: number
}

interface DashboardData {
  event: DashboardEvent
  stats: DashboardStats
  vendorGrid: VendorGridItem[]
  organizer?: OrganizerState | null
  checklist: GoLiveChecklist
}

// ─── Types ────────────────────────────────────────────────────────────────────

type EventStatus = 'ACTIVE' | 'UPCOMING' | 'INACTIVE'

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div className="bg-[#111111] rounded-xl border border-white/5 p-4 sm:p-5">
      <p className="text-xs text-[#666] font-inter uppercase tracking-wider">{label}</p>
      <p className={`mt-2 text-2xl sm:text-3xl font-bebas ${accent ? 'text-[#FF0077]' : 'text-white'}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-[#666] font-inter">{sub}</p>}
    </div>
  )
}

function VendorStatusBadge({ vendor }: { vendor: VendorGridItem }) {
  const isConnected = vendor.connectionStatus === 'CONNECTED'
  const liveStatus = vendor.liveStatus

  const styles: Record<string, string> = {
    ACTIVE: 'bg-green-500/15 text-green-400',
    BUSY: 'bg-yellow-500/15 text-yellow-400',
    OFFLINE: 'bg-red-500/15 text-red-400',
    PENDING: 'bg-sky-500/15 text-sky-400',
    INACTIVE: 'bg-white/5 text-[#888]',
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${styles[liveStatus] ?? styles.INACTIVE}`}>
        {liveStatus}
      </span>
      <span className={`flex items-center gap-1 text-[10px] font-inter ${isConnected ? 'text-green-400' : 'text-[#555]'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400' : 'bg-[#444]'}`} />
        {isConnected ? 'Live' : 'Offline'}
      </span>
    </div>
  )
}

// ─── Go Live Checklist Modal ──────────────────────────────────────────────────

function GoLiveChecklist({
  checklist,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  checklist: GoLiveChecklist
  busy: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  const items = [
    { label: 'At least 1 active vendor', pass: checklist.hasActiveVendor },
    { label: 'At least 1 vendor with Stripe verified', pass: checklist.hasStripeVendor },
    { label: 'Fulfillment config has ≥1 mode enabled', pass: checklist.hasFulfillmentMode },
    { label: 'Event location coordinates set', pass: checklist.hasCoords },
  ]
  const canGo = checklist.canGoLive && !busy

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-[#161616] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-6 border-b border-white/5">
          <h2 className="font-bebas text-2xl text-white tracking-wide">Go Live Checklist</h2>
          <p className="text-sm text-[#666] font-inter mt-1">All conditions must pass before the event can go live.</p>
        </div>
        <div className="p-6 space-y-3">
          {items.map(item => (
            <div key={item.label} className="flex items-center gap-3">
              {item.pass
                ? <CheckCircleIcon className="w-5 h-5 text-green-400 shrink-0" />
                : <XCircleIcon className="w-5 h-5 text-red-400 shrink-0" />
              }
              <span className={`text-sm font-inter ${item.pass ? 'text-white' : 'text-[#666]'}`}>{item.label}</span>
            </div>
          ))}
          {error && <p className="text-sm text-red-400 font-inter pt-1">{error}</p>}
        </div>
        <div className="p-6 pt-0 flex gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm font-semibold text-white hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={canGo ? onConfirm : undefined}
            disabled={!canGo}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors
              ${canGo
                ? 'bg-[#FF0077] text-white hover:bg-[#e0006b]'
                : 'bg-white/5 text-[#555] cursor-not-allowed'
              }`}
          >
            {busy ? 'Going Live…' : checklist.canGoLive ? 'Go Live' : 'Fix Issues First'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Pause Confirmation Modal ─────────────────────────────────────────────────

function PauseModal({
  isPaused,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  isPaused: boolean
  busy: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-[#161616] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-yellow-500/15 flex items-center justify-center shrink-0">
              <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <h2 className="font-bebas text-xl text-white tracking-wide mb-1">
                {isPaused ? 'Resume Ordering?' : 'Pause Ordering?'}
              </h2>
              <p className="text-sm text-[#888] font-inter leading-relaxed">
                {isPaused
                  ? 'Customers will be able to place new orders immediately.'
                  : 'This will block all new orders. Orders currently in progress will continue to completion.'
                }
              </p>
              {error && <p className="text-sm text-red-400 font-inter mt-2">{error}</p>}
            </div>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm font-semibold text-white hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50
              ${isPaused
                ? 'bg-green-600 text-white hover:bg-green-500'
                : 'bg-yellow-600 text-white hover:bg-yellow-500'
              }`}
          >
            {busy ? 'Working…' : isPaused ? 'Resume Orders' : 'Pause Orders'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Close Event Modal ────────────────────────────────────────────────────────
// Closing (→ INACTIVE) is the Part B event-close trigger: it fires the per-event
// organizer payout batch. Confirmed here so an admin knows money will move.

function CloseModal({
  busy,
  error,
  onConfirm,
  onClose,
}: {
  busy: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-[#161616] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
              <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h2 className="font-bebas text-xl text-white tracking-wide mb-1">Close this event?</h2>
              <p className="text-sm text-[#888] font-inter leading-relaxed">
                This ends the fair — no new orders can be placed. It also triggers the
                organizer’s per-event payout batch (their accrued share is paid out).
                This can’t be undone from here.
              </p>
              {error && <p className="text-sm text-red-400 font-inter mt-2">{error}</p>}
            </div>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm font-semibold text-white hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
          >
            {busy ? 'Closing…' : 'Close Event'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminDashboardPage({ params: paramsPromise }: { params: Promise<{ eventSlug: string }> }) {
  const params = use(paramsPromise)
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  // null until the real status loads — never a default that looks real. 'UPCOMING' as a
  // seed would flash the wrong badge AND the wrong action button (Go Live) for an already-
  // ACTIVE fair before the fetch resolves. Same class as the slug-as-name flash.
  const [eventStatus, setEventStatus] = useState<EventStatus | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [showGoLive, setShowGoLive] = useState(false)
  const [showPause, setShowPause] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Fetch real dashboard data. A FAILURE MUST BE VISIBLE — the old handler swallowed every
  // error (`if (!success) return` + empty `.catch`), so a 504/timeout left an eternal
  // skeleton + fake zeros, indistinguishable from an empty fair. That is exactly how a prod
  // timeout hid as "the dashboard shows nothing". Now a non-ok response, a non-JSON body
  // (Vercel's 504 page is HTML — .json() throws), or !success all surface as loadError.
  const load = useCallback(() => {
    setLoadError(null)
    fetch(`/api/admin/events/${params.eventSlug}/dashboard`)
      .then(async (r) => {
        if (!r.ok) throw new Error(
          r.status === 504 || r.status === 502
            ? 'The dashboard timed out loading (server took too long). Retry, or check the deployment.'
            : `Dashboard request failed (${r.status})`)
        const json = await r.json()
        if (!json.success) throw new Error(json.error?.message ?? 'Dashboard failed to load')
        setDashboardData(json.data)
        setEventStatus(json.data.event.status)
        setIsPaused(json.data.event.isPaused)
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Dashboard failed to load'))
  }, [params.eventSlug])
  useEffect(() => { load() }, [load])

  // Real data only — zero/empty state until the fetch resolves (no mock).
  const stats = dashboardData?.stats ?? ZERO_STATS
  const vendorGrid = dashboardData?.vendorGrid ?? []
  // NEVER fall back to the slug — a URL fragment ("springfield-state-fair-2026") rendered as
  // the fair's name is a plausible-but-WRONG value that flashes before the real name loads.
  // null until we know the truth; the render shows a skeleton, not a lie.
  const eventName = dashboardData?.event.name ?? null
  const eventDates = dashboardData
    ? `${new Date(dashboardData.event.startDate).toLocaleDateString()} – ${new Date(dashboardData.event.endDate).toLocaleDateString()}`
    : ''

  // Go-live readiness — the SAME checklist the status route enforces (server-computed).
  const checklist = dashboardData?.checklist ?? EMPTY_CHECKLIST

  // ── Real platform-control actions ──────────────────────────────────────────
  // Each awaits the secured admin endpoint (through the chokepoint) and reflects
  // the TRUE returned state — never an optimistic flip. Errors surface the reason.

  // Go Live / Close → PATCH /status. The server ENFORCES the go-live checklist
  // (409 GO_LIVE_CHECKLIST_FAILED) — the same core the dashboard displays.
  async function patchStatus(status: 'ACTIVE' | 'INACTIVE'): Promise<boolean> {
    setActionBusy(true); setActionError(null)
    try {
      const res = await fetch(`/api/admin/events/${params.eventSlug}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error?.message ?? 'Action failed'); return false }
      setEventStatus(json.data.event.status)
      setIsPaused(json.data.event.isPaused)
      return true
    } catch {
      setActionError('Network error — please retry')
      return false
    } finally {
      setActionBusy(false)
    }
  }

  const handleGoLive = async () => { if (await patchStatus('ACTIVE'))  setShowGoLive(false) }
  const handleClose  = async () => { if (await patchStatus('INACTIVE')) setShowClose(false) }

  // Pause / Resume → PATCH /pause. Reflects the true isPaused from the response.
  async function handleTogglePause() {
    setActionBusy(true); setActionError(null)
    try {
      const res = await fetch(`/api/admin/events/${params.eventSlug}/pause`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPaused: !isPaused }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error?.message ?? 'Action failed'); return }
      setIsPaused(json.data.event.isPaused)
      setShowPause(false)
    } catch {
      setActionError('Network error — please retry')
    } finally {
      setActionBusy(false)
    }
  }

  function openModal(which: 'golive' | 'pause' | 'close') {
    setActionError(null)
    if (which === 'golive') setShowGoLive(true)
    if (which === 'pause')  setShowPause(true)
    if (which === 'close')  setShowClose(true)
  }

  return (
    <>
      {/* Go Live checklist modal */}
      {showGoLive && (
        <GoLiveChecklist
          checklist={checklist}
          busy={actionBusy}
          error={actionError}
          onConfirm={handleGoLive}
          onClose={() => setShowGoLive(false)}
        />
      )}

      {/* Pause modal */}
      {showPause && (
        <PauseModal
          isPaused={isPaused}
          busy={actionBusy}
          error={actionError}
          onConfirm={handleTogglePause}
          onClose={() => setShowPause(false)}
        />
      )}

      {/* Close modal — closing fires the per-event organizer payout batch (Part B) */}
      {showClose && (
        <CloseModal
          busy={actionBusy}
          error={actionError}
          onConfirm={handleClose}
          onClose={() => setShowClose(false)}
        />
      )}

      <div>
        {/* Load failure — surfaced, not swallowed. Without this, a 504/timeout looks like an
            empty fair (eternal skeleton + zeros). Now it says what actually went wrong, with
            a retry, and suppresses the misleading skeleton/zero cards below. */}
        {loadError && !dashboardData && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/25 rounded-2xl flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-red-300 text-sm font-semibold">Couldn&apos;t load the dashboard</p>
              <p className="text-red-300/80 text-xs mt-0.5">{loadError}</p>
            </div>
            <button
              onClick={() => load()}
              className="shrink-0 px-3.5 py-2 bg-red-500/15 border border-red-500/25 text-red-300 text-xs font-semibold rounded-xl hover:bg-red-500/25 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {eventName
                ? <h1 className="font-bebas text-3xl text-white tracking-wide">{eventName}</h1>
                : loadError
                  ? <h1 className="font-bebas text-3xl text-white/40 tracking-wide">Unavailable</h1>
                  : <span className="inline-block h-8 w-56 rounded bg-white/5 animate-pulse" aria-label="Loading fair name" />}
              {eventStatus ? (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase
                  ${eventStatus === 'ACTIVE' ? 'bg-green-500/15 text-green-400' :
                    eventStatus === 'UPCOMING' ? 'bg-sky-500/15 text-sky-400' :
                    'bg-white/5 text-[#888]'}`}>
                  {eventStatus}
                </span>
              ) : (
                <span className="inline-block h-4 w-16 rounded-full bg-white/5 animate-pulse" aria-label="Loading status" />
              )}
              {isPaused && eventStatus === 'ACTIVE' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-yellow-500/15 text-yellow-400">
                  PAUSED
                </span>
              )}
            </div>
            <p className="text-sm text-[#666] font-inter">{eventDates}</p>
          </div>

          {/* Platform controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Pause / Resume — only when event is ACTIVE */}
            {eventStatus === 'ACTIVE' && (
              <button
                onClick={() => openModal('pause')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors
                  ${isPaused
                    ? 'bg-green-600/20 border border-green-600/30 text-green-400 hover:bg-green-600/30'
                    : 'bg-yellow-600/20 border border-yellow-600/30 text-yellow-400 hover:bg-yellow-600/30'
                  }`}
              >
                {isPaused
                  ? <><PlayIcon className="w-4 h-4" /> Resume Orders</>
                  : <><PauseIcon className="w-4 h-4" /> Pause Orders</>
                }
              </button>
            )}

            {/* Go Live — only when UPCOMING */}
            {eventStatus === 'UPCOMING' && (
              <button
                onClick={() => openModal('golive')}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#FF0077] text-white text-sm font-semibold rounded-xl hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
              >
                <PlayIcon className="w-4 h-4" />
                Go Live
              </button>
            )}

            {/* Close Event — when ACTIVE */}
            {eventStatus === 'ACTIVE' && (
              <button
                onClick={() => openModal('close')}
                className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-semibold rounded-xl hover:bg-red-500/20 transition-colors"
              >
                Close Event
              </button>
            )}
          </div>
        </div>

        {/* Pause banner */}
        {isPaused && eventStatus === 'ACTIVE' && (
          <div className="mb-6 flex items-center gap-3 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
            <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400 shrink-0" />
            <p className="text-sm text-yellow-300 font-inter">
              <span className="font-semibold">Ordering is paused.</span> New orders are blocked. All in-progress orders continue normally.
            </p>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Live Orders" value={String(stats.liveOrders)} sub="in progress now" accent />
          <StatCard label="Orders Today" value={String(stats.ordersToday)} />
          <StatCard label="Revenue Today" value={`$${Number(stats.revenueToday).toLocaleString()}`} sub={`$${Number(stats.platformFeeToday).toFixed(2)} platform fee`} />
          <StatCard label="Active Vendors" value={`${stats.activeVendors}/${stats.totalVendors}`} sub={`${stats.activeRunners} runners active`} />
        </div>

        {/* A6 kill-switch — organizer suspension control (admin-only mutating action) */}
        {dashboardData?.organizer && (
          <div className="mb-8">
            <OrganizerControl organizer={dashboardData.organizer} />
          </div>
        )}

        {/* Vendor status grid */}
        <section>
          <h2 className="font-bebas text-xl text-white tracking-wide mb-4">Vendor Status</h2>
          <div className="bg-[#111111] rounded-xl border border-white/5 divide-y divide-white/5">
            {vendorGrid.map(vendor => (
              <div key={vendor.id} className="flex items-center justify-between gap-3 p-4 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-lg bg-[#FF0077]/10 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bebas text-[#FF0077]">{vendor.name[0]}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-inter font-medium text-white truncate">{vendor.name}</p>
                    <p className="text-xs text-[#666] font-inter">
                      {vendor.cuisineType}
                      {vendor.boothNumber && ` · Booth ${vendor.boothNumber}`}
                    </p>
                  </div>
                </div>

                {/* Live status + connection */}
                <div className="shrink-0">
                  <VendorStatusBadge vendor={vendor} />
                </div>

                {/* Today stats */}
                <div className="hidden sm:flex items-center gap-4 shrink-0 text-right">
                  <div>
                    <p className="text-sm font-inter text-white tabular-nums">{vendor.ordersToday ?? '—'}</p>
                    <p className="text-[10px] text-[#555] font-inter">orders</p>
                  </div>
                  <div>
                    <p className="text-sm font-inter text-white tabular-nums">${(vendor.revenueToday ?? 0).toFixed(0)}</p>
                    <p className="text-[10px] text-[#555] font-inter">revenue</p>
                  </div>
                  {(vendor.avgPrepTime ?? 0) > 0 && (
                    <div>
                      <p className={`text-sm font-inter tabular-nums ${(vendor.avgPrepTime ?? 0) <= 10 ? 'text-green-400' : (vendor.avgPrepTime ?? 0) <= 15 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {vendor.avgPrepTime}m
                      </p>
                      <p className="text-[10px] text-[#555] font-inter">avg prep</p>
                    </div>
                  )}
                </div>

                {/* Stripe badge */}
                <div className="hidden md:flex items-center gap-1 shrink-0">
                  {vendor.stripeVerified
                    ? <span className="px-2 py-0.5 bg-green-500/15 text-green-400 text-[10px] font-semibold rounded uppercase">Stripe ✓</span>
                    : <span className="px-2 py-0.5 bg-white/5 text-[#555] text-[10px] font-semibold rounded uppercase">No Stripe</span>
                  }
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
