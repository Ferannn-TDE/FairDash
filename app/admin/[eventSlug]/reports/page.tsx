'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { DollarSign, ShoppingBag, TrendingUp, XCircle, FileText, Mail } from 'lucide-react'
import { mockAdminReportSummary, mockAdminVendorBreakdown, mockAdminDashboard } from '@/lib/mock/admin'

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, color = 'text-neon-pink' }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color?: string
}) {
  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-5 flex items-start gap-4">
      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div>
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold">{label}</p>
        <p className="font-bebas text-3xl tracking-wide text-white leading-tight">{value}</p>
        {sub && <p className="text-text-gray text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

const FULFILLMENT_COLORS = ['#FF0077', '#3B82F6', '#10B981']
const fulfillmentData = [
  { name: 'Booth Pickup', value: 98 },
  { name: 'Curbside',     value: 31 },
  { name: 'Delivery',     value: 12 },
]

const CustomPieTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1A1A1A] border border-white/10 rounded-xl px-3 py-2 text-sm shadow-xl">
      <p className="text-white font-semibold">{payload[0].name}</p>
      <p className="text-text-gray text-xs">{payload[0].value} orders</p>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminReportsPage() {
  const summary = mockAdminReportSummary
  const vendors = mockAdminVendorBreakdown
  const completionRate = Math.round((summary.completedOrders / summary.totalOrders) * 100)

  return (
    <div className="p-6 md:p-4 sm:p-3 max-w-[72rem] mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight">
            Event <span className="text-neon-pink">Report</span>
          </h1>
          <p className="text-text-gray text-sm mt-0.5">Springfield State Fair · Today&apos;s Summary</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-1.5 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-semibold text-text-gray hover:text-white hover:border-white/20 transition-all cursor-pointer">
            <Mail className="w-3.5 h-3.5" />
            Email Report
          </button>
          <button className="flex items-center gap-1.5 px-4 py-2 bg-neon-pink text-white rounded-xl text-xs font-semibold hover:bg-[#e0006b] transition-all cursor-pointer shadow-[0_4px_12px_rgba(255,0,119,0.3)]">
            <FileText className="w-3.5 h-3.5" />
            Generate PDF
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Total Revenue"
          value={`$${summary.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          sub={`${summary.totalOrders} orders`}
          icon={DollarSign}
          color="text-emerald-400"
        />
        <StatCard
          label="Platform Fee"
          value={`$${summary.platformFee.toFixed(2)}`}
          sub={`${mockAdminDashboard.platformFeeToday > 0 ? '10%' : '—'} of revenue`}
          icon={TrendingUp}
          color="text-neon-pink"
        />
        <StatCard
          label="Vendor Payouts"
          value={`$${summary.vendorPayouts.toFixed(2)}`}
          sub="After platform fee"
          icon={ShoppingBag}
          color="text-blue-400"
        />
        <StatCard
          label="Cancellations"
          value={String(summary.cancelledOrders + summary.refundedOrders)}
          sub={`${summary.cancelledOrders} cancelled · ${summary.refundedOrders} refunded`}
          icon={XCircle}
          color="text-red-400"
        />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-bg-card border border-white/10 rounded-2xl p-4 text-center">
          <p className="font-bebas text-4xl tracking-wide text-white">{summary.totalOrders}</p>
          <p className="text-text-gray text-xs uppercase tracking-wide font-semibold mt-0.5">Total Orders</p>
        </div>
        <div className="bg-bg-card border border-white/10 rounded-2xl p-4 text-center">
          <p className="font-bebas text-4xl tracking-wide text-emerald-400">{completionRate}%</p>
          <p className="text-text-gray text-xs uppercase tracking-wide font-semibold mt-0.5">Completion Rate</p>
        </div>
        <div className="bg-bg-card border border-white/10 rounded-2xl p-4 text-center">
          <p className="font-bebas text-4xl tracking-wide text-neon-pink">${summary.avgOrderValue.toFixed(2)}</p>
          <p className="text-text-gray text-xs uppercase tracking-wide font-semibold mt-0.5">Avg Order Value</p>
        </div>
      </div>

      {/* Vendor breakdown + fulfillment chart */}
      <div className="grid lg:grid-cols-[1fr_280px] gap-5 mb-6">

        {/* Vendor breakdown table */}
        <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10">
            <h2 className="font-bebas text-xl tracking-wide text-white">Vendor Breakdown</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Vendor', 'Orders', 'Revenue', 'Payout', 'Avg Prep', 'Cancels'].map((h) => (
                    <th key={h} className="text-left text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold px-5 py-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vendors.map((v, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3.5 text-sm font-semibold text-white whitespace-nowrap">{v.vendorName}</td>
                    <td className="px-5 py-3.5 text-sm text-text-gray">{v.orders}</td>
                    <td className="px-5 py-3.5 text-sm text-neon-pink font-semibold">${v.revenue.toFixed(2)}</td>
                    <td className="px-5 py-3.5 text-sm text-emerald-400">${v.payout.toFixed(2)}</td>
                    <td className="px-5 py-3.5 text-sm text-text-gray">{v.avgPrepTime} min</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-semibold ${v.cancellations > 0 ? 'text-red-400' : 'text-text-gray'}`}>
                        {v.cancellations}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Fulfillment type pie chart */}
        <div className="bg-bg-card border border-white/10 rounded-2xl p-5">
          <h2 className="font-bebas text-xl tracking-wide text-white mb-4">Fulfillment Types</h2>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie
                data={fulfillmentData}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={70}
                paddingAngle={3}
                dataKey="value"
              >
                {fulfillmentData.map((_, i) => (
                  <Cell key={i} fill={FULFILLMENT_COLORS[i % FULFILLMENT_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomPieTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-3">
            {fulfillmentData.map((item, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: FULFILLMENT_COLORS[i] }} />
                  <span className="text-xs text-text-gray">{item.name}</span>
                </div>
                <span className="text-xs font-semibold text-white">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Payout summary */}
      <div className="bg-bg-card border border-white/10 rounded-2xl p-5">
        <h2 className="font-bebas text-xl tracking-wide text-white mb-4">Payout Summary</h2>
        <div className="space-y-2.5">
          {vendors.map((v, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-white font-semibold truncate">{v.vendorName}</p>
                  <p className="text-sm text-emerald-400 font-semibold shrink-0 ml-2">${v.payout.toFixed(2)}</p>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-neon-pink rounded-full"
                    style={{ width: `${(v.payout / summary.vendorPayouts) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
          <p className="text-text-gray text-sm">Total Payouts</p>
          <p className="text-white font-bold text-lg">${summary.vendorPayouts.toFixed(2)}</p>
        </div>
      </div>

    </div>
  )
}
