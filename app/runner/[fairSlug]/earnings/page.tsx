'use client'

import { useEffect, useState } from 'react'
import { DollarSign, Truck, TrendingUp, Info } from 'lucide-react'

interface EarningRow {
  orderId: string
  amount: number
  feeShare: number
  tip: number
  status: 'pending' | 'held' | 'paid' | 'cancelled'
  at: string
  paidAt: string | null
}
interface EarningsData {
  earnedTotal: number
  earnedToday: number
  paidTotal: number
  pendingTotal: number
  heldTotal: number
  deliveriesToday: number
  totalDeliveries: number
  completionRate: number
  recent: EarningRow[]
}

// Status chips: paid is the only green; pending/held are amber/blue claims-in-waiting;
// cancelled renders struck-through and never sums.
const STATUS_CHIP: Record<EarningRow['status'], { label: string; cls: string }> = {
  paid:      { label: 'paid',      cls: 'text-emerald-400' },
  pending:   { label: 'pending',   cls: 'text-amber-400/80' },
  held:      { label: 'held',      cls: 'text-blue-400/80' },
  cancelled: { label: 'cancelled', cls: 'text-red-400/70' },
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
  const [range, setRange] = useState<'today' | 'all'>('today')

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

      {/* What the number IS: the runner's share of the fee + 100% of tips — from the same
          ledger the payout executor pays. Never described as "the fee the customer paid":
          the organizer holds the other share of that fee. */}
      <div className="flex items-start gap-2.5 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3">
        <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-text-gray text-xs leading-relaxed">
          Each delivery earns you <span className="text-white font-semibold">your share of the delivery fee</span> plus{' '}
          <span className="text-white font-semibold">100% of the tip</span>.{' '}
          <span className="text-amber-300/90">Pending</span> amounts transfer automatically after the order&rsquo;s refund
          window closes; <span className="text-emerald-300/90">paid</span> means the transfer went out.
        </p>
      </div>

      {/* Today / All-time toggle — the earned + deliveries figures switch scope; completion
          rate is inherently all-time (delivered / collected across the runner's history). */}
      <div className="flex gap-2" role="tablist">
        {(['today', 'all'] as const).map(r => (
          <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)}
            className={`flex-1 h-9 rounded-lg text-xs font-semibold transition-colors cursor-pointer border ${
              range === r ? 'bg-neon-pink text-white border-neon-pink' : 'bg-white/5 text-text-gray border-white/10 hover:bg-white/10'
            }`}>
            {r === 'today' ? 'Today' : 'All-time'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {range === 'today' ? (
          <>
            <StatCard label="Earned Today" value={loading ? '…' : fmt(data?.earnedToday ?? 0)} sub={`${data?.deliveriesToday ?? 0} deliveries`} icon={DollarSign} color="text-emerald-400" />
            <StatCard label="Deliveries Today" value={loading ? '…' : String(data?.deliveriesToday ?? 0)} icon={Truck} color="text-blue-400" />
          </>
        ) : (
          <>
            <StatCard label="Earned Total" value={loading ? '…' : fmt(data?.earnedTotal ?? 0)} sub={loading ? undefined : `${fmt(data?.paidTotal ?? 0)} paid · ${fmt((data?.pendingTotal ?? 0) + (data?.heldTotal ?? 0))} to come`} icon={TrendingUp} color="text-neon-pink" />
            <StatCard label="Deliveries" value={loading ? '…' : String(data?.totalDeliveries ?? 0)} icon={Truck} color="text-blue-400" />
          </>
        )}
        <StatCard label="Completion" value={loading ? '…' : `${Math.round((data?.completionRate ?? 1) * 100)}%`} icon={TrendingUp} color="text-amber-400" />
      </div>

      {/* Per-delivery breakdown, straight off the ledger */}
      <div>
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-3">Delivery History</p>
        <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-6 text-center text-text-gray text-sm">Loading…</div>
          ) : (data?.recent.length ?? 0) === 0 ? (
            <div className="p-8 text-center">
              <p className="text-white text-sm font-semibold mb-1">No completed deliveries yet</p>
              <p className="text-text-gray text-xs">Your first delivery&rsquo;s earnings will appear here with its fee-share and tip breakdown.</p>
            </div>
          ) : data!.recent.map((e, i) => {
            const chip = STATUS_CHIP[e.status] ?? STATUS_CHIP.pending
            const cancelled = e.status === 'cancelled'
            return (
              <div key={e.orderId} className={`flex items-center gap-3 px-4 py-3.5 ${i < data!.recent.length - 1 ? 'border-b border-white/5' : ''} ${cancelled ? 'opacity-60' : ''}`}>
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                  <Truck className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-semibold">#{e.orderId.slice(-8).toUpperCase()}</p>
                  <p className="text-text-gray text-xs">
                    {fmt(e.feeShare)} fee share{e.tip > 0 && <> + {fmt(e.tip)} tip</>}
                    <span className="text-text-gray/50"> · {new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-semibold tabular-nums ${cancelled ? 'text-text-gray line-through' : 'text-white'}`}>{fmt(e.amount)}</p>
                  <p className={`text-[0.6rem] uppercase tracking-wide font-semibold ${chip.cls}`}>{chip.label}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
