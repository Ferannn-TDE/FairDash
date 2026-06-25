'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Truck, DollarSign, CheckCircle, MapPin, Car, Bell, Package, WifiOff,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useRunner } from '../_context/RunnerContext'

const FULFILLMENT_LABEL: Record<string, string> = {
  CURBSIDE: 'Curbside', HOME_DELIVERY: 'Home Delivery', BOOTH_PICKUP: 'Booth Pickup',
}

interface DeliveryOrder {
  id: string
  status: string
  fulfillmentType: string
  runnerId: string | null
  vendor?: { name?: string | null } | null
  orderItems?: { quantity: number }[]
}
interface EarningsData { trackedToday: number; deliveriesToday: number; completionRate: number }

/* ─── Online toggle — wired to /api/runners/me status ─────────────────────── */
function OnlineToggle() {
  const { isOnline, setIsOnline } = useRunner()
  const [busy, setBusy] = useState(false)

  async function toggle() {
    setBusy(true)
    const next = !isOnline
    try {
      const res = await fetch('/api/runners/me', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next ? 'ACTIVE' : 'OFFLINE' }),
      })
      if ((await res.json()).success) setIsOnline(next)
      else toast.error('Could not update status')
    } catch { toast.error('Network error') } finally { setBusy(false) }
  }

  return (
    <div className={`rounded-2xl p-5 border transition-all ${isOnline ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-white/[0.03] border-white/10'}`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">Status</p>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-gray-400'}`} />
            <span className={`font-bebas text-xl tracking-wide ${isOnline ? 'text-emerald-400' : 'text-gray-500'}`}>{isOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
        <button type="button" role="switch" aria-checked={isOnline} disabled={busy} onClick={toggle}
          className={`relative w-16 h-8 rounded-full transition-colors cursor-pointer shrink-0 border-0 disabled:opacity-50 ${isOnline ? 'bg-emerald-500' : 'bg-gray-600'}`}>
          <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-md transition-all ${isOnline ? 'translate-x-[34px]' : 'translate-x-1'}`} />
        </button>
      </div>
      {!isOnline && <p className="text-gray-500 text-xs mt-3">Go online to start receiving deliveries.</p>}
    </div>
  )
}

function TodayStats({ stats }: { stats: EarningsData | null }) {
  const rows = [
    { icon: Truck, iconColor: 'text-neon-pink', bg: 'bg-neon-pink/10', label: 'Deliveries', value: String(stats?.deliveriesToday ?? 0), color: 'text-white' },
    { icon: DollarSign, iconColor: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Tracked', value: `$${(stats?.trackedToday ?? 0).toFixed(2)}`, color: 'text-emerald-400' },
    { icon: CheckCircle, iconColor: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Completion', value: `${Math.round((stats?.completionRate ?? 1) * 100)}%`, color: 'text-white' },
  ]
  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-5 space-y-4">
      <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold">Today</p>
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl ${r.bg} flex items-center justify-center shrink-0`}><r.icon className={`w-4 h-4 ${r.iconColor}`} /></div>
          <div className="flex-1 flex items-center justify-between">
            <span className="text-text-gray text-sm">{r.label}</span>
            <span className={`font-bebas text-xl tracking-wide ${r.color}`}>{r.value}</span>
          </div>
        </div>
      ))}
      <p className="text-amber-400/60 text-[0.6rem]">Tracked = earned, not yet paid out.</p>
    </div>
  )
}

/* ─── Claimable deliveries (real) ─────────────────────────────────────────── */
function DeliveryFeed({ fairSlug }: { fairSlug: string }) {
  const router = useRouter()
  const { isOnline } = useRunner()
  const [orders, setOrders] = useState<DeliveryOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/runners/me/orders')
      const json = await res.json()
      if (json.success) { setOrders(json.data.orders ?? []); setOffline(false) }
    } catch { setOffline(true) } finally { setLoading(false) }
  }, [])

  // Reconnection: refetch on mount, on regaining focus, and on the browser's
  // online event — a runner crossing the fairgrounds drops WiFi constantly, and
  // a stale feed is a real failure. Light poll while online.
  useEffect(() => {
    load()
    const onFocus = () => load()
    const onOnline = () => { setOffline(false); load() }
    const onOffline = () => setOffline(true)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const t = setInterval(load, 15000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      clearInterval(t)
    }
  }, [load])

  async function claim(orderId: string) {
    setClaiming(orderId)
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RUNNER_COLLECTED' }),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        router.push(`/runner/${fairSlug}/delivery/${orderId}`)
      } else if (res.status === 409) {
        toast.error('Just claimed by another runner') // the atomic-claim loser path
        await load()
      } else {
        toast.error(json.error?.message ?? 'Could not claim')
        await load()
      }
    } catch { toast.error('Network error — check your connection') } finally { setClaiming(null) }
  }

  if (offline) {
    return (
      <div className="bg-amber-500/[0.07] border border-amber-500/20 rounded-2xl p-6 text-center">
        <WifiOff className="w-7 h-7 text-amber-400 mx-auto mb-2" />
        <p className="text-amber-200/80 text-sm font-semibold">Connection lost — reconnecting…</p>
        <p className="text-text-gray text-xs mt-1">Your delivery list will refresh automatically.</p>
      </div>
    )
  }
  if (!isOnline) {
    return <div className="bg-bg-card border border-white/10 rounded-2xl p-10 text-center"><p className="text-text-gray text-sm">Go online to start receiving deliveries.</p></div>
  }

  const claimable = orders.filter(o => o.status === 'READY' && !o.runnerId)
  const mine = orders.filter(o => o.status === 'RUNNER_COLLECTED' && o.runnerId)

  return (
    <div className="space-y-4">
      {mine.map(o => (
        <button key={o.id} onClick={() => router.push(`/runner/${fairSlug}/delivery/${o.id}`)}
          className="w-full text-left bg-blue-500/[0.07] border border-blue-500/30 rounded-2xl p-5 cursor-pointer">
          <p className="text-[0.6875rem] uppercase tracking-wide text-blue-400 font-semibold mb-1">Your Active Delivery</p>
          <p className="text-white font-semibold">#{o.id.slice(-8).toUpperCase()} · {FULFILLMENT_LABEL[o.fulfillmentType]}</p>
          <p className="text-text-gray text-xs mt-1">{o.vendor?.name ?? 'Vendor'} — tap to continue →</p>
        </button>
      ))}

      {loading && claimable.length === 0 && mine.length === 0 ? (
        <div className="bg-bg-card border border-white/10 rounded-2xl p-10 text-center"><p className="text-text-gray text-sm">Loading…</p></div>
      ) : claimable.length === 0 && mine.length === 0 ? (
        <div className="bg-bg-card border border-white/10 rounded-2xl p-10 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-white/[0.03] flex items-center justify-center mb-4"><Package className="w-8 h-8 text-gray-600" /></div>
          <p className="text-white font-semibold text-sm mb-1">Waiting for orders</p>
          <p className="text-text-gray text-xs">New deliveries appear here automatically.</p>
        </div>
      ) : claimable.map(o => {
        const items = (o.orderItems ?? []).reduce((s, i) => s + i.quantity, 0)
        return (
          <div key={o.id} className="bg-neon-pink/[0.06] border border-neon-pink/40 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3"><Bell className="w-4 h-4 text-neon-pink" /><p className="text-[0.6875rem] uppercase tracking-wide text-neon-pink font-semibold">Available Delivery</p></div>
            <p className="text-white font-semibold text-lg">#{o.id.slice(-8).toUpperCase()}</p>
            <div className="flex items-center gap-1 text-text-gray text-sm mt-1">
              {o.fulfillmentType === 'CURBSIDE' ? <Car className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
              <span>{FULFILLMENT_LABEL[o.fulfillmentType]}</span>
              <span className="text-text-gray/60">· {o.vendor?.name ?? 'Vendor'} · {items} item{items !== 1 ? 's' : ''}</span>
            </div>
            <button onClick={() => claim(o.id)} disabled={claiming === o.id}
              className="mt-4 w-full h-12 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)] cursor-pointer disabled:opacity-60">
              {claiming === o.id ? 'Claiming…' : 'Claim Delivery'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default function RunnerDashboard() {
  const params = useParams()
  const fairSlug = params.fairSlug as string
  const { setIsOnline } = useRunner()
  const [stats, setStats] = useState<EarningsData | null>(null)

  // Hydrate online status + today stats from the real APIs.
  useEffect(() => {
    fetch('/api/runners/me').then(r => r.json()).then(j => {
      if (j.success) setIsOnline(j.data.runner?.status === 'ACTIVE')
    }).catch(() => {})
    fetch('/api/runners/me/earnings').then(r => r.json()).then(j => {
      if (j.success) setStats({ trackedToday: j.data.trackedToday, deliveriesToday: j.data.deliveriesToday, completionRate: j.data.completionRate })
    }).catch(() => {})
  }, [setIsOnline])

  return (
    <div className="px-4 sm:px-6 py-6 pb-24 lg:pb-8 max-w-5xl mx-auto">
      {/* Mobile-first: single column; status + feed stacked. Sidebar only on lg+. */}
      <div className="lg:hidden mb-4"><OnlineToggle /></div>
      <div className="flex flex-col lg:flex-row gap-5">
        <aside className="hidden lg:block w-72 shrink-0 space-y-4">
          <OnlineToggle />
          <TodayStats stats={stats} />
        </aside>
        <main className="flex-1 min-w-0 space-y-5">
          <div className="lg:hidden"><TodayStats stats={stats} /></div>
          <DeliveryFeed fairSlug={fairSlug} />
        </main>
      </div>
    </div>
  )
}
