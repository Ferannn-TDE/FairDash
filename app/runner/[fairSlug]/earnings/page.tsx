'use client'

import { useEffect, useState } from 'react'
import { DollarSign, Truck, TrendingUp, Clock } from 'lucide-react'

interface EarningRow { orderId: string; amount: number; status: string; at: string }
interface EarningsData {
  trackedTotal: number
  trackedToday: number
  deliveriesToday: number
  totalDeliveries: number
  completionRate: number
  recent: EarningRow[]
}

function StatCard({ label, value, sub, icon: Icon, color = 'text-neon-pink' }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color?: string
}) {
  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div>
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold">{label}</p>
        <p className="font-bebas text-2xl tracking-wide text-white leading-tight">{value}</p>
        {sub && <p className="text-text-gray text-xs">{sub}</p>}
      </div>
    </div>
  )
}

export default function RunnerEarningsPage() {
  const [data, setData] = useState<EarningsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/runners/me/earnings')
      .then(r => r.json())
      .then(j => { if (j.success) setData(j.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const fmt = (n: number) => `$${(n ?? 0).toFixed(2)}`

  return (
    <div className="max-w-3xl mx-auto px-5 py-6 space-y-6 pb-24">
      <h1 className="font-bebas text-[clamp(1.75rem,6vw,2.5rem)] tracking-wide text-white leading-tight">
        Your <span className="text-neon-pink">Earnings</span>
      </h1>

      {/* Honesty banner: these are TRACKED, not yet paid. */}
      <div className="flex items-start gap-2.5 bg-amber-500/[0.07] border border-amber-500/20 rounded-xl px-4 py-3">
        <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-amber-200/80 text-xs leading-relaxed">
          These are your <span className="font-semibold">tracked</span> earnings from completed deliveries —
          the delivery fee the customer paid on each order. Runner payouts are processed separately;
          this is what you’ve earned, not yet a transfer.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Tracked Today" value={loading ? '…' : fmt(data?.trackedToday ?? 0)} sub={`${data?.deliveriesToday ?? 0} deliveries`} icon={DollarSign} color="text-emerald-400" />
        <StatCard label="Tracked Total" value={loading ? '…' : fmt(data?.trackedTotal ?? 0)} sub="all completed" icon={TrendingUp} color="text-neon-pink" />
        <StatCard label="Deliveries" value={loading ? '…' : String(data?.totalDeliveries ?? 0)} icon={Truck} color="text-blue-400" />
        <StatCard label="Completion" value={loading ? '…' : `${Math.round((data?.completionRate ?? 1) * 100)}%`} icon={TrendingUp} color="text-amber-400" />
      </div>

      {/* Real delivery history (from RunnerEarning) */}
      <div>
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-3">Delivery History</p>
        <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-6 text-center text-text-gray text-sm">Loading…</div>
          ) : (data?.recent.length ?? 0) === 0 ? (
            <div className="p-6 text-center text-text-gray text-sm">No completed deliveries yet.</div>
          ) : data!.recent.map((e, i) => (
            <div key={e.orderId} className={`flex items-center gap-3 px-4 py-3.5 ${i < data!.recent.length - 1 ? 'border-b border-white/5' : ''}`}>
              <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                <Truck className="w-4 h-4 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold">#{e.orderId.slice(-8).toUpperCase()}</p>
                <p className="text-text-gray text-xs">{new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-white text-sm font-semibold tabular-nums">{fmt(e.amount)}</p>
                <p className="text-amber-400/70 text-[0.6rem] uppercase tracking-wide font-semibold">tracked</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
