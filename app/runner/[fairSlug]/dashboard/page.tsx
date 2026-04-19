'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { TruckIcon, CheckCircleIcon, ClockIcon, MapPinIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { getDatabase, ref as dbRef, onValue, off } from 'firebase/database'
import toast from 'react-hot-toast'
import { getFirebaseApp } from '@/lib/firebase-client'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface RunnerRecord {
  id: string
  status: 'OFFLINE' | 'ACTIVE' | 'ON_DELIVERY'
  totalCompleted: number
  completionRate: number
  event: { id: string; name: string; urlSlug: string }
}

interface DeliveryOrder {
  id: string
  status: 'READY' | 'RUNNER_COLLECTED'
  fulfillmentType: 'HOME_DELIVERY' | 'CURBSIDE'
  runnerId: string | null
  customerName: string
  subtotal: number
  total: number
  deliveryFee: number | null
  deliveryStreet: string | null
  deliveryCity: string | null
  vehicleColor: string | null
  vehicleMake: string | null
  readyAt: string | null
  vendor: { name: string; boothNumber: string | null }
  orderItems: { menuItem: { name: string }; quantity: number }[]
}

const STATUS_CONFIG = {
  OFFLINE:     { label: 'Offline',     color: 'text-text-gray',   dot: 'bg-text-gray' },
  ACTIVE:      { label: 'Active',      color: 'text-emerald-400', dot: 'bg-emerald-400' },
  ON_DELIVERY: { label: 'On Delivery', color: 'text-amber-400',   dot: 'bg-amber-400' },
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function RunnerDashboard() {
  const params = useParams()
  const router = useRouter()
  const fairSlug = params.fairSlug as string

  const [runner, setRunner] = useState<RunnerRecord | null>(null)
  const [orders, setOrders] = useState<DeliveryOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const rtdbUnsub = useRef<(() => void) | null>(null)

  // ── Fetch runner + orders ────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [runnerRes, ordersRes] = await Promise.all([
        fetch('/api/runners/me'),
        fetch('/api/runners/me/orders'),
      ])
      const [runnerJson, ordersJson] = await Promise.all([
        runnerRes.json(),
        ordersRes.json(),
      ])

      if (runnerJson.success) setRunner(runnerJson.data.runner)
      if (ordersJson.success) setOrders(ordersJson.data.orders ?? [])
    } catch {
      toast.error('Could not load runner data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ── Firebase RTDB: listen for new dispatch assignments ────────────────────────

  useEffect(() => {
    if (!runner) return

    const app = getFirebaseApp()
    if (!app) return

    const db = getDatabase(app)
    const dispatchPath = `fairs/${runner.event.id}/runnerDispatches/${runner.id}`
    const dispatchRef = dbRef(db, dispatchPath)

    const handleDispatch = () => {
      // Reload orders when a new dispatch arrives
      loadData()
    }

    onValue(dispatchRef, handleDispatch)
    rtdbUnsub.current = () => off(dispatchRef)

    return () => {
      rtdbUnsub.current?.()
    }
  }, [runner, loadData])

  // ── Status toggle ────────────────────────────────────────────────────────────

  const toggleStatus = async () => {
    if (!runner || toggling) return
    const newStatus = runner.status === 'ACTIVE' ? 'OFFLINE' : 'ACTIVE'
    setToggling(true)
    try {
      const res = await fetch('/api/runners/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message || 'Failed to update status')
      setRunner(json.data.runner)
      toast.success(newStatus === 'ACTIVE' ? 'You are now active' : 'You are now offline')
    } catch (err: any) {
      toast.error(err.message || 'Could not update status')
    } finally {
      setToggling(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-dark text-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <TruckIcon className="w-10 h-10 text-text-gray mx-auto animate-pulse" />
          <p className="text-text-gray text-sm">Loading dashboard…</p>
        </div>
      </div>
    )
  }

  if (!runner) {
    return (
      <div className="min-h-screen bg-bg-dark text-white flex items-center justify-center">
        <p className="text-text-gray">Runner record not found.</p>
      </div>
    )
  }

  const statusCfg = STATUS_CONFIG[runner.status] ?? STATUS_CONFIG.OFFLINE
  const activeDelivery = orders.find(o => o.status === 'RUNNER_COLLECTED')
  const pendingOrders  = orders.filter(o => o.status === 'READY')
  const completionPct  = Math.round(runner.completionRate * 100)

  return (
    <div className="min-h-screen bg-bg-dark text-white pb-16">
      <div className="max-w-[640px] mx-auto px-[6%] sm:px-5 py-8 space-y-5">

        {/* Status card */}
        <div className="bg-bg-card border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1">
                Status
              </p>
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${statusCfg.dot}`} />
                <span className={`font-bebas text-xl tracking-wide ${statusCfg.color}`}>
                  {statusCfg.label}
                </span>
              </div>
            </div>

            {runner.status !== 'ON_DELIVERY' && (
              <button
                onClick={toggleStatus}
                disabled={toggling}
                className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors cursor-pointer border-0 ${
                  runner.status === 'ACTIVE'
                    ? 'bg-white/5 border border-white/10 text-white hover:bg-white/10'
                    : 'bg-neon-pink text-white hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)]'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {toggling ? '…' : runner.status === 'ACTIVE' ? 'Go Offline' : 'Go Active'}
              </button>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-6 text-sm">
            <div>
              <p className="text-text-gray text-xs">Completed today</p>
              <p className="text-white font-semibold">{runner.totalCompleted}</p>
            </div>
            <div>
              <p className="text-text-gray text-xs">Completion rate</p>
              <p className={`font-semibold ${completionPct >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {completionPct}%
              </p>
            </div>
            <div className="ml-auto">
              <button
                onClick={loadData}
                className="p-1.5 rounded-lg text-text-gray hover:text-white hover:bg-white/5 transition-colors cursor-pointer bg-transparent border-0"
                title="Refresh"
              >
                <ArrowPathIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Active delivery */}
        {activeDelivery && (
          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-2">
              Active Delivery
            </p>
            <OrderCard
              order={activeDelivery}
              fairSlug={fairSlug}
              highlight
              onClick={() => router.push(`/runner/${fairSlug}/delivery/${activeDelivery.id}`)}
            />
          </div>
        )}

        {/* Pending orders ready for pickup */}
        {runner.status === 'ACTIVE' && pendingOrders.length > 0 && (
          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-2">
              Ready for Pickup ({pendingOrders.length})
            </p>
            <div className="space-y-3">
              {pendingOrders.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  fairSlug={fairSlug}
                  onClick={() => router.push(`/runner/${fairSlug}/delivery/${order.id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty states */}
        {runner.status === 'OFFLINE' && !activeDelivery && (
          <div className="bg-bg-card border border-white/10 rounded-2xl p-10 text-center">
            <TruckIcon className="w-10 h-10 text-text-gray/30 mx-auto mb-3" />
            <p className="text-text-gray text-sm">Go active to start receiving delivery requests.</p>
          </div>
        )}

        {runner.status === 'ACTIVE' && pendingOrders.length === 0 && !activeDelivery && (
          <div className="bg-bg-card border border-white/10 rounded-2xl p-10 text-center">
            <CheckCircleIcon className="w-10 h-10 text-emerald-400/30 mx-auto mb-3" />
            <p className="text-text-gray text-sm">No deliveries waiting right now. Check back soon.</p>
          </div>
        )}

      </div>
    </div>
  )
}

// ─── Order Card ────────────────────────────────────────────────────────────────

function OrderCard({
  order,
  fairSlug,
  highlight = false,
  onClick,
}: {
  order: DeliveryOrder
  fairSlug: string
  highlight?: boolean
  onClick: () => void
}) {
  const itemCount = order.orderItems.reduce((s, i) => s + i.quantity, 0)
  const isDelivery = order.fulfillmentType === 'HOME_DELIVERY'

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-bg-card rounded-2xl p-4 border transition-colors cursor-pointer ${
        highlight
          ? 'border-neon-pink/40 hover:border-neon-pink/60'
          : 'border-white/10 hover:border-white/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="text-white font-semibold text-sm">{order.customerName}</p>
          <p className="text-text-gray text-xs">
            {order.vendor.name}
            {order.vendor.boothNumber ? ` · Booth ${order.vendor.boothNumber}` : ''}
          </p>
        </div>
        <span className={`shrink-0 text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full border ${
          isDelivery
            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
        }`}>
          {isDelivery ? 'Delivery' : 'Curbside'}
        </span>
      </div>

      <p className="text-text-gray text-xs mb-2">
        {itemCount} item{itemCount !== 1 ? 's' : ''} · ${order.total.toFixed(2)}
      </p>

      {isDelivery && order.deliveryStreet && (
        <div className="flex items-center gap-1 text-xs text-text-gray">
          <MapPinIcon className="w-3 h-3 shrink-0" />
          <span className="truncate">{order.deliveryStreet}, {order.deliveryCity}</span>
        </div>
      )}

      {!isDelivery && order.vehicleMake && (
        <div className="flex items-center gap-1 text-xs text-text-gray">
          <TruckIcon className="w-3 h-3 shrink-0" />
          <span>{order.vehicleColor} {order.vehicleMake}</span>
        </div>
      )}

      {order.readyAt && (
        <div className="flex items-center gap-1 text-xs text-text-gray mt-1">
          <ClockIcon className="w-3 h-3 shrink-0" />
          <span>Ready at {new Date(order.readyAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}
    </button>
  )
}
