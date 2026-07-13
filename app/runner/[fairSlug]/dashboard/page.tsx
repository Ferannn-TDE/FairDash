'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Truck, DollarSign, CheckCircle, MapPin, Car, Bell, Package, WifiOff, Clock, Ban,
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

/* ─── Approval banner — honest "why is my toggle dead" UX ──────────────────── */
// Backend truth is the gate (see /api/runners/me + /api/orders/[id]/status); this
// only explains WHY an unapproved runner can't go online.
function ApprovalBanner({ approvalStatus }: { approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' }) {
  if (approvalStatus === 'APPROVED') return null
  const rejected = approvalStatus === 'REJECTED'
  return (
    <div className={`rounded-2xl p-4 border flex items-start gap-3 ${rejected ? 'bg-red-500/10 border-red-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
      {rejected ? <Ban className="w-5 h-5 text-red-400 shrink-0 mt-0.5" /> : <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />}
      <div>
        <p className={`font-semibold text-sm ${rejected ? 'text-red-300' : 'text-amber-300'}`}>
          {rejected ? 'Your runner application was not approved' : 'Your account is awaiting admin approval'}
        </p>
        <p className="text-text-gray text-xs mt-0.5">
          {rejected
            ? 'You can’t go online or claim deliveries. Contact the event organizer if you think this is a mistake.'
            : 'You’ll be able to go online and claim deliveries once an admin approves your account.'}
        </p>
      </div>
    </div>
  )
}

/* ─── Online toggle — wired to /api/runners/me status ─────────────────────── */
function OnlineToggle() {
  const { isOnline, setIsOnline, approvalStatus } = useRunner()
  const [busy, setBusy] = useState(false)
  const approved = approvalStatus === 'APPROVED'

  async function toggle() {
    setBusy(true)
    const next = !isOnline
    try {
      const res = await fetch('/api/runners/me', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next ? 'ACTIVE' : 'OFFLINE' }),
      })
      const json = await res.json()
      if (json.success) setIsOnline(next)
      else if (json.error?.code === 'RUNNER_NOT_APPROVED') toast.error('Your runner account is awaiting admin approval')
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
        <button type="button" role="switch" aria-checked={isOnline} disabled={busy || !approved} onClick={toggle}
          title={!approved ? 'Awaiting admin approval' : undefined}
          className={`relative w-16 h-8 rounded-full transition-colors shrink-0 border-0 disabled:opacity-50 disabled:cursor-not-allowed ${!approved ? 'cursor-not-allowed' : 'cursor-pointer'} ${isOnline ? 'bg-emerald-500' : 'bg-gray-600'}`}>
          {/* Knob: anchored 4px inset (top-1/left-1); slides by pill − knob − 2·inset = 64 − 24 − 8 = 32px (translate-x-8). Symmetric, stays inside the pill. */}
          <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${isOnline ? 'translate-x-8' : 'translate-x-0'}`} />
        </button>
      </div>
      {!approved
        ? <p className="text-amber-400/70 text-xs mt-3">Go-online is locked until your account is approved.</p>
        : !isOnline && <p className="text-gray-500 text-xs mt-3">Go online to start receiving deliveries.</p>}
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
  const { setIsOnline, approvalStatus, setApprovalStatus } = useRunner()
  const [stats, setStats] = useState<EarningsData | null>(null)

  // Hydrate online status + approval state + today stats from the real APIs.
  useEffect(() => {
    fetch('/api/runners/me').then(r => r.json()).then(j => {
      if (j.success) {
        setIsOnline(j.data.runner?.status === 'ACTIVE')
        if (j.data.runner?.approvalStatus) setApprovalStatus(j.data.runner.approvalStatus)
      }
    }).catch(() => {})
    fetch('/api/runners/me/earnings').then(r => r.json()).then(j => {
      if (j.success) setStats({ trackedToday: j.data.trackedToday, deliveriesToday: j.data.deliveriesToday, completionRate: j.data.completionRate })
    }).catch(() => {})
  }, [setIsOnline, setApprovalStatus])

  return (
    <div className="px-4 sm:px-6 py-6 pb-24 lg:pb-8 max-w-5xl mx-auto">
      {/* Only once the real status has loaded — null means "not known yet", which must show
          neither the approved UI nor the pending banner (no flash of either). */}
      {approvalStatus && approvalStatus !== 'APPROVED' && <div className="mb-4"><ApprovalBanner approvalStatus={approvalStatus} /></div>}
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
