'use client'

import { useState, useEffect } from 'react'
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  PauseIcon,
} from '@heroicons/react/24/outline'
import {
  mockAdminDashboard,
  mockAdminVendors,
  mockFulfillmentConfig,
  computeGoLiveChecklist,
} from '@/lib/mock/admin'

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
  onConfirm,
  onClose,
}: {
  checklist: ReturnType<typeof computeGoLiveChecklist>
  onConfirm: () => void
  onClose: () => void
}) {
  const items = [
    { label: 'At least 1 active vendor', pass: checklist.hasActiveVendor },
    { label: 'At least 1 vendor with Stripe verified', pass: checklist.hasStripeVendor },
    { label: 'Fulfillment config has ≥1 mode enabled', pass: checklist.hasFulfillmentMode },
    { label: 'Event location coordinates set', pass: checklist.hasCoords },
  ]

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
        </div>
        <div className="p-6 pt-0 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm font-semibold text-white hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={checklist.canGoLive ? onConfirm : undefined}
            disabled={!checklist.canGoLive}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors
              ${checklist.canGoLive
                ? 'bg-[#FF0077] text-white hover:bg-[#e0006b]'
                : 'bg-white/5 text-[#555] cursor-not-allowed'
              }`}
          >
            {checklist.canGoLive ? 'Go Live' : 'Fix Issues First'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Pause Confirmation Modal ─────────────────────────────────────────────────

function PauseModal({
  isPaused,
  onConfirm,
  onClose,
}: {
  isPaused: boolean
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
            </div>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm font-semibold text-white hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors
              ${isPaused
                ? 'bg-green-600 text-white hover:bg-green-500'
                : 'bg-yellow-600 text-white hover:bg-yellow-500'
              }`}
          >
            {isPaused ? 'Resume Orders' : 'Pause Orders'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminDashboardPage({ params }: { params: { eventSlug: string } }) {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [eventStatus, setEventStatus] = useState<EventStatus>('UPCOMING')
  const [isPaused, setIsPaused] = useState(false)
  const [showGoLive, setShowGoLive] = useState(false)
  const [showPause, setShowPause] = useState(false)

  // Fetch real dashboard data; fall back to mock if unavailable (dev without DB)
  useEffect(() => {
    fetch(`/api/admin/events/${params.eventSlug}/dashboard`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) return
        setDashboardData(json.data)
        setEventStatus(json.data.event.status)
        setIsPaused(json.data.event.isPaused)
      })
      .catch(() => {})
  }, [params.eventSlug])

  // Use real data when available, otherwise fall back to mock for dev
  const stats = dashboardData?.stats ?? mockAdminDashboard
  const vendorGrid = dashboardData?.vendorGrid ?? mockAdminVendors
  const eventName = dashboardData?.event.name ?? params.eventSlug
  const eventDates = dashboardData
    ? `${new Date(dashboardData.event.startDate).toLocaleDateString()} – ${new Date(dashboardData.event.endDate).toLocaleDateString()}`
    : ''

  const checklist = computeGoLiveChecklist(
    null,
    null,
    mockAdminVendors,
    mockFulfillmentConfig
  )

  const handleGoLive = () => {
    setEventStatus('ACTIVE')
    setShowGoLive(false)
  }

  const handleTogglePause = () => {
    setIsPaused(p => !p)
    setShowPause(false)
  }

  return (
    <>
      {/* Go Live checklist modal */}
      {showGoLive && (
        <GoLiveChecklist
          checklist={checklist}
          onConfirm={handleGoLive}
          onClose={() => setShowGoLive(false)}
        />
      )}

      {/* Pause modal */}
      {showPause && (
        <PauseModal
          isPaused={isPaused}
          onConfirm={handleTogglePause}
          onClose={() => setShowPause(false)}
        />
      )}

      <div>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="font-bebas text-3xl text-white tracking-wide">{eventName}</h1>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase
                ${eventStatus === 'ACTIVE' ? 'bg-green-500/15 text-green-400' :
                  eventStatus === 'UPCOMING' ? 'bg-sky-500/15 text-sky-400' :
                  'bg-white/5 text-[#888]'}`}>
                {eventStatus}
              </span>
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
                onClick={() => setShowPause(true)}
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
                onClick={() => setShowGoLive(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#FF0077] text-white text-sm font-semibold rounded-xl hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
              >
                <PlayIcon className="w-4 h-4" />
                Go Live
              </button>
            )}

            {/* Close Event — when ACTIVE */}
            {eventStatus === 'ACTIVE' && (
              <button
                onClick={() => setEventStatus('INACTIVE')}
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
