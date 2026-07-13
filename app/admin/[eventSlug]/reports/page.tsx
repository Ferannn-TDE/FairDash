'use client'

import { useState, useEffect, use } from 'react'
import { DollarSign, ShoppingBag, TrendingDown, Users } from 'lucide-react'

// ─── Types (mirror lib/admin-fair-reports FairReport — all cents) ─────────────
interface PayeeTakeHome { settledCents: number; estimatedCents: number }
interface VendorRow {
  vendorId: string; name: string; orders: number
  grossSliceCents: number; settledCents: number; estimatedCents: number
  refundedCents: number; avgPrepMinutes: number | null
}
interface Report {
  grossSalesCents: number; refundsCents: number; netSalesCents: number; platformFeeCents: number
  totalOrders: number; completedOrders: number; cancelledOrders: number; refundedOrders: number
  avgOrderValueCents: number
  vendorTakeHome: PayeeTakeHome; runnerTakeHome: PayeeTakeHome; organizerTakeHome: PayeeTakeHome
  vendors: VendorRow[]
}

// ONLY money math on this page: the ÷100 display format. Every figure is the server's
// ledger number rendered verbatim — the page does no aggregation that could drift.
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function StatCard({ label, value, sub, icon: Icon, tone = 'default' }: {
  label: string; value: string; sub?: string; icon: React.ElementType
  tone?: 'default' | 'gross' | 'net' | 'fee' | 'refund'
}) {
  const color = { default: 'text-neon-pink', gross: 'text-white', net: 'text-emerald-400', fee: 'text-neon-pink', refund: 'text-red-400' }[tone]
  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-5 flex items-start gap-4">
      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div className="min-w-0">
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold">{label}</p>
        <p className={`font-bebas text-3xl tracking-wide leading-tight tabular-nums ${color}`}>{value}</p>
        {sub && <p className="text-text-gray text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

/** Settled and estimated shown as TWO figures, never summed — an estimate is not cash. */
function TakeHomeRow({ label, t }: { label: string; t: PayeeTakeHome }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-4 bg-bg-card border border-white/10 rounded-xl px-4 py-3">
      <span className="text-sm text-white font-semibold">{label}</span>
      <span className="text-right">
        <span className="block font-bebas text-xl tabular-nums text-emerald-400 leading-none">{money(t.settledCents)}</span>
        <span className="text-[0.6rem] uppercase tracking-wide text-emerald-400/60">paid (settled)</span>
      </span>
      <span className="text-right min-w-[6rem]">
        <span className="block font-bebas text-xl tabular-nums text-amber-400 leading-none">~{money(t.estimatedCents)}</span>
        <span className="text-[0.6rem] uppercase tracking-wide text-amber-400/70">payable (est.)</span>
      </span>
    </div>
  )
}

export default function AdminReportsPage({ params: paramsPromise }: { params: Promise<{ eventSlug: string }> }) {
  const params = use(paramsPromise)
  const [report, setReport] = useState<Report | null>(null)
  const [fairName, setFairName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch(`/api/admin/events/${params.eventSlug}/reports`)
      .then(r => r.json())
      .then(json => {
        if (!active) return
        if (!json.success) { setError(json.error?.message ?? 'Failed to load report'); return }
        setReport(json.data.report as Report)
        setFairName(json.data.fair?.name ?? '')
      })
      .catch(() => { if (active) setError('Failed to load report') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [params.eventSlug])

  if (loading) return <div className="p-6 text-text-gray text-sm">Loading report…</div>
  if (error) return <div className="p-6 text-red-400 text-sm">{error}</div>
  if (!report) return null
  const r = report

  return (
    <div className="p-6 md:p-4 sm:p-3 max-w-[72rem] mx-auto">
      <div className="mb-6">
        <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight">
          Event <span className="text-neon-pink">Report</span>
        </h1>
        <p className="text-text-gray text-sm mt-0.5">{fairName} · figures from the ledger, live</p>
      </div>

      {/* Sales — CUSTOMER money. Gross and Net are distinct and labelled. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard label="Gross Sales" value={money(r.grossSalesCents)} sub={`${r.totalOrders} orders · what customers paid`} icon={ShoppingBag} tone="gross" />
        <StatCard label="Net Sales" value={money(r.netSalesCents)} sub="after refunds" icon={TrendingDown} tone="net" />
        <StatCard label="Platform Fee" value={money(r.platformFeeCents)} sub="FairSynq revenue (10%)" icon={DollarSign} tone="fee" />
        <StatCard label="Refunds" value={money(r.refundsCents)} sub={`${r.refundedOrders} order${r.refundedOrders === 1 ? '' : 's'} refunded`} icon={TrendingDown} tone="refund" />
      </div>

      {/* Order counts — no derived percentages (that would be UI math); raw counts only. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Orders" value={String(r.totalOrders)} icon={ShoppingBag} />
        <StatCard label="Completed" value={String(r.completedOrders)} sub={`of ${r.totalOrders}`} icon={ShoppingBag} />
        <StatCard label="Cancelled" value={String(r.cancelledOrders)} icon={ShoppingBag} />
        <StatCard label="Avg Order Value" value={money(r.avgOrderValueCents)} icon={DollarSign} />
      </div>

      {/* Take-home BY PAYEE — NOT the order gross. Settled vs estimated kept separate. */}
      <div className="mb-6">
        <h2 className="font-bebas text-xl tracking-wide text-white mb-1 flex items-center gap-2">
          <Users className="w-4 h-4 text-neon-pink" /> Take-home by payee
        </h2>
        <p className="text-text-gray text-xs mb-3">
          What each party keeps — vendors&apos; is their slice minus the Stripe fee, not the order gross.
          &quot;Paid&quot; is real money transferred; &quot;payable&quot; is accrued and not yet paid.
        </p>
        <div className="space-y-2">
          <TakeHomeRow label="Vendors" t={r.vendorTakeHome} />
          <TakeHomeRow label="Runners" t={r.runnerTakeHome} />
          <TakeHomeRow label="Organizer" t={r.organizerTakeHome} />
        </div>
      </div>

      {/* Per-vendor breakdown — sales (their gross slice) and take-home are DIFFERENT columns. */}
      <div>
        <h2 className="font-bebas text-xl tracking-wide text-white mb-3">Vendor breakdown</h2>
        {r.vendors.length === 0 ? (
          <p className="text-text-gray text-xs">No vendors for this fair yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[0.6rem] uppercase tracking-wide text-text-gray border-b border-white/10">
                  <th className="px-4 py-2.5 font-semibold">Vendor</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Orders</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Sales (gross)</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Take-home paid</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Payable (est.)</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Avg prep</th>
                </tr>
              </thead>
              <tbody>
                {r.vendors.map(v => (
                  <tr key={v.vendorId} className="border-b border-white/[0.04]">
                    <td className="px-4 py-3 text-white font-medium truncate max-w-[12rem]">{v.name}</td>
                    <td className="px-4 py-3 text-right text-text-gray tabular-nums">{v.orders}</td>
                    <td className="px-4 py-3 text-right text-white tabular-nums">{money(v.grossSliceCents)}</td>
                    <td className="px-4 py-3 text-right text-emerald-400 tabular-nums">{money(v.settledCents)}</td>
                    <td className="px-4 py-3 text-right text-amber-400 tabular-nums">~{money(v.estimatedCents)}</td>
                    <td className="px-4 py-3 text-right text-text-gray tabular-nums">{v.avgPrepMinutes != null ? `${v.avgPrepMinutes}m` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
