'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Truck, Clock, DollarSign, CheckCircle,
  MapPin, Car, Bell, Package,
} from 'lucide-react'
import { mockDeliveryRequest, mockRunnerStats, mockRecentDeliveries } from '@/lib/mock/runner'
import { useRunner } from '../_context/RunnerContext'

const FULFILLMENT_LABEL: Record<string, string> = {
  CURBSIDE:      'Curbside',
  HOME_DELIVERY: 'Home Delivery',
  BOOTH_PICKUP:  'Booth Pickup',
}

/* ─── Toggle ─────────────────────────────────────────────────────────────── */

function OnlineToggle() {
  const { isOnline, setIsOnline } = useRunner()

  return (
    <div className={`rounded-2xl p-5 border transition-all duration-200 ease-in-out ${
      isOnline ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-white/[0.03] border-white/10'
    }`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">
            Status
          </p>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ease-in-out ${
              isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-gray-400'
            }`} />
            <span className={`font-bebas text-xl tracking-wide transition-colors duration-200 ease-in-out ${
              isOnline ? 'text-emerald-400' : 'text-gray-500'
            }`}>
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>

        {/* Controlled toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={isOnline}
          onClick={() => setIsOnline(!isOnline)}
          className={`relative w-16 h-8 rounded-full transition-colors duration-200 ease-in-out cursor-pointer shrink-0 border-0 ${
            isOnline ? 'bg-emerald-500' : 'bg-gray-600'
          }`}
        >
          <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-200 ease-in-out ${
            isOnline ? 'translate-x-[34px]' : 'translate-x-1'
          }`} />
        </button>
      </div>

      {!isOnline && (
        <p className="text-gray-500 text-xs mt-3">Go online to start receiving deliveries.</p>
      )}
    </div>
  )
}

/* ─── Stats sidebar cards ─────────────────────────────────────────────────── */

function TodayStats() {
  const stats = mockRunnerStats
  const rows = [
    { icon: Truck,       iconColor: 'text-neon-pink',   bg: 'bg-neon-pink/10',    label: 'Deliveries', value: String(stats.deliveriesToday),         color: 'text-white' },
    { icon: DollarSign,  iconColor: 'text-emerald-400', bg: 'bg-emerald-500/10',  label: 'Earned',     value: `$${stats.earningsToday.toFixed(2)}`,   color: 'text-emerald-400' },
    { icon: CheckCircle, iconColor: 'text-blue-400',    bg: 'bg-blue-500/10',     label: 'Completion', value: `${Math.round(stats.completionRate * 100)}%`, color: 'text-white' },
  ]

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-5">
      <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-4">
        Today&apos;s Stats
      </p>
      <div className="space-y-4">
        {rows.map(({ icon: Icon, iconColor, bg, label, value, color }, i) => (
          <div key={label}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
                  <Icon className={`w-4 h-4 ${iconColor}`} />
                </div>
                <span className="text-sm text-text-gray">{label}</span>
              </div>
              <span className={`text-xl font-bebas ${color}`}>{value}</span>
            </div>
            {i < rows.length - 1 && <div className="h-px bg-white/[0.04] mt-4" />}
          </div>
        ))}
      </div>
    </div>
  )
}

function ActiveEvent() {
  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-5">
      <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-3">
        Active Event
      </p>
      <p className="text-sm text-white font-medium">Springfield State Fair</p>
      <p className="text-xs text-text-gray mt-1">June 15–22, 2026</p>
      <div className="flex items-center gap-1.5 mt-1">
        <Clock className="w-3 h-3 text-text-gray" />
        <p className="text-xs text-text-gray">10:00 AM – 10:00 PM</p>
      </div>
    </div>
  )
}

function TipsToday() {
  const recent = mockRecentDeliveries
  const total = recent.reduce((s, e) => s + e.tip, 0)
  const tipped = recent.filter(e => e.tip > 0).length
  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-5">
      <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-3">
        Tips Today
      </p>
      <p className="text-2xl font-bebas text-emerald-400">${total.toFixed(2)}</p>
      <p className="text-xs text-text-gray mt-1">
        From {tipped} of {recent.length} deliveries
      </p>
    </div>
  )
}

/* ─── Sidebar (desktop sticky) ────────────────────────────────────────────── */

function Sidebar() {
  return (
    <aside className="lg:w-64 lg:shrink-0 lg:sticky lg:top-6 lg:self-start space-y-4">
      <OnlineToggle />
      <TodayStats />
      <ActiveEvent />
      <TipsToday />
    </aside>
  )
}

/* ─── Main feed ──────────────────────────────────────────────────────────── */

function DeliveryRequest({ fairSlug }: { fairSlug: string }) {
  const router = useRouter()
  const { isOnline } = useRunner()
  const [hasRequest, setHasRequest] = useState(true)
  const request = mockDeliveryRequest

  if (!isOnline) {
    return (
      <div className="bg-bg-card border border-white/10 rounded-2xl p-10 text-center">
        <p className="text-text-gray text-sm">Go online to start receiving deliveries.</p>
      </div>
    )
  }

  if (!hasRequest) {
    return (
      <div className="bg-bg-card border border-white/10 rounded-2xl p-10 text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-white/[0.03] flex items-center justify-center mb-4">
          <Package className="w-8 h-8 text-gray-600" />
        </div>
        <p className="text-white font-semibold text-sm mb-1">Waiting for orders</p>
        <p className="text-text-gray text-xs">You&apos;ll be notified when a delivery is available.</p>
        <div className="mt-6 flex items-center justify-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-neon-pink/40 animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 rounded-full bg-neon-pink/40 animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 rounded-full bg-neon-pink/40 animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-neon-pink/[0.06] border border-neon-pink/40 rounded-2xl p-5 animate-[pulse-border_2s_ease-in-out_infinite]">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-4 h-4 text-neon-pink" />
        <p className="text-[0.6875rem] uppercase tracking-wide text-neon-pink font-semibold">
          New Delivery Request
        </p>
      </div>

      <div className="mb-4 space-y-1.5">
        <p className="text-white font-semibold text-lg">Order #{request.id.slice(-8).toUpperCase()}</p>
        <div className="flex items-center gap-1 text-text-gray text-sm">
          {request.fulfillmentType === 'CURBSIDE'
            ? <Car className="w-3.5 h-3.5" />
            : <MapPin className="w-3.5 h-3.5" />}
          <span>{FULFILLMENT_LABEL[request.fulfillmentType]}</span>
          {request.fulfillmentType === 'CURBSIDE' && request.curbsideZone && (
            <span className="text-text-gray/60">· {request.curbsideZone}</span>
          )}
        </div>
        <p className="text-text-gray text-sm">
          {request.vendorStops.length} vendor stop{request.vendorStops.length !== 1 ? 's' : ''} ·{' '}
          {request.vendorStops.reduce((s, v) => s + v.items.reduce((a, i) => a + i.quantity, 0), 0)} items ·{' '}
          <span className="text-neon-pink font-semibold">${request.total.toFixed(2)}</span>
        </p>
        <p className="text-text-gray text-xs">
          Vendors: {request.vendorStops.map(v => v.vendorName).join(', ')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setHasRequest(false)}
          className="h-11 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 transition-colors cursor-pointer"
        >
          Decline
        </button>
        <button
          onClick={() => {
            setHasRequest(false)
            router.push(`/runner/${fairSlug}/delivery/${request.id}`)
          }}
          className="h-11 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)] cursor-pointer"
        >
          Accept
        </button>
      </div>
    </div>
  )
}

function RecentDeliveries() {
  const recent = mockRecentDeliveries
  return (
    <div>
      <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-3">
        Recent Deliveries
      </p>
      <div className="bg-bg-card border border-white/10 rounded-2xl divide-y divide-white/[0.04]">
        {recent.slice(0, 5).map(entry => (
          <div
            key={entry.orderId}
            className="flex items-center gap-3 px-4 sm:px-5 py-4 hover:bg-white/[0.02] transition-colors"
          >
            <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
              {entry.fulfillmentType === 'HOME_DELIVERY'
                ? <MapPin className="w-4 h-4 text-blue-400" />
                : <Car className="w-4 h-4 text-amber-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-semibold truncate">
                #{entry.orderId.slice(-8).toUpperCase()}
              </p>
              <p className="text-text-gray text-xs">{entry.vendorName} · {entry.completedAt}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-emerald-400 text-sm font-semibold">
                ${(entry.basePay + entry.tip).toFixed(2)}
              </p>
              {entry.tip > 0 && (
                <p className="text-text-gray text-[0.625rem]">+${entry.tip.toFixed(2)} tip</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RunnerMain({ fairSlug }: { fairSlug: string }) {
  return (
    <div className="flex-1 min-w-0 space-y-6">
      <DeliveryRequest fairSlug={fairSlug} />
      <RecentDeliveries />
    </div>
  )
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function RunnerDashboard() {
  const params = useParams()
  const fairSlug = params.fairSlug as string

  return (
    <div className="px-5 sm:px-8 py-6 sm:py-8">

      {/* Mobile: status toggle above the feed */}
      <div className="lg:hidden mb-5">
        <OnlineToggle />
      </div>

      {/* Desktop: sidebar + main  |  Mobile: single column */}
      <div className="flex flex-col lg:flex-row gap-6 max-w-6xl mx-auto">
        <Sidebar />
        <RunnerMain fairSlug={fairSlug} />
      </div>

    </div>
  )
}
