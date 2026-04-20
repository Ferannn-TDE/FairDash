'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { DollarSign, Truck, TrendingUp, MapPin, Car } from 'lucide-react'
import { mockRunnerStats, mockRecentDeliveries, mockWeeklyEarnings } from '@/lib/mock/runner'

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

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1A1A1A] border border-white/10 rounded-xl px-3 py-2 text-sm shadow-xl">
      <p className="text-text-gray text-xs mb-1">{label}</p>
      <p className="text-white font-semibold">${payload[0]?.value?.toFixed(2)}</p>
      <p className="text-text-gray text-xs">{payload[1]?.value} deliveries</p>
    </div>
  )
}

export default function RunnerEarningsPage() {
  const stats = mockRunnerStats
  const recent = mockRecentDeliveries
  const weekly = mockWeeklyEarnings

  const totalTips = recent.reduce((s, e) => s + e.tip, 0)
  const weekTotal = weekly.reduce((s, d) => s + d.earnings, 0)

  return (
    <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6 sm:py-8 space-y-6">

      <h1 className="font-bebas text-[clamp(1.75rem,5vw,2.5rem)] tracking-wide text-white leading-tight">
        Earnings <span className="text-neon-pink">Summary</span>
      </h1>

      {/* Top stats row — 2 cols mobile, 4 cols desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="Earned Today"
          value={`$${stats.earningsToday.toFixed(2)}`}
          sub={`${stats.deliveriesToday} deliveries`}
          icon={DollarSign}
          color="text-emerald-400"
        />
        <StatCard
          label="Tips Today"
          value={`$${totalTips.toFixed(2)}`}
          sub={`avg $${(totalTips / recent.length).toFixed(2)}/delivery`}
          icon={TrendingUp}
          color="text-neon-pink"
        />
        <StatCard
          label="Deliveries"
          value={String(stats.deliveriesToday)}
          sub={`${Math.round(stats.completionRate * 100)}% completion`}
          icon={Truck}
          color="text-blue-400"
        />
        <StatCard
          label="This Week"
          value={`$${weekTotal.toFixed(2)}`}
          sub={`${weekly.reduce((s, d) => s + d.deliveries, 0)} deliveries`}
          icon={DollarSign}
          color="text-amber-400"
        />
      </div>

      {/* 2-column on desktop: chart (2/3) + breakdown (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Weekly chart — takes 2/3 */}
        <div className="lg:col-span-2 bg-bg-card border border-white/10 rounded-2xl p-5 sm:p-6">
          <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-4">Weekly Earnings</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weekly} barCategoryGap="30%">
              <XAxis
                dataKey="day"
                tick={{ fill: '#A1A1A1', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="earnings" radius={[4, 4, 0, 0]}>
                {weekly.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={i === weekly.length - 1 ? '#FF0077' : 'rgba(255,0,119,0.35)'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-text-gray text-xs text-center mt-1">Last 7 days · Today highlighted</p>
        </div>

        {/* Delivery breakdown — 1/3 */}
        <div className="bg-bg-card border border-white/10 rounded-2xl p-5 sm:p-6">
          <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-5">Delivery Breakdown</p>
          <div className="space-y-5">
            {[
              { label: 'Booth Pickup', count: 18, total: 34, color: 'bg-neon-pink' },
              { label: 'Curbside',     count: 11, total: 34, color: 'bg-blue-500' },
              { label: 'Home Delivery', count: 5, total: 34, color: 'bg-emerald-500' },
            ].map(({ label, count, total, color }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-text-gray">{label}</span>
                  <span className="text-sm text-white tabular-nums">{count}</span>
                </div>
                <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden">
                  <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.round((count / total) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Delivery history */}
      <div>
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-3">Delivery History</p>
        <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
          {recent.map((entry, i) => (
            <div key={entry.orderId} className={`flex items-center gap-3 px-4 py-3.5 ${i < recent.length - 1 ? 'border-b border-white/5' : ''}`}>
              <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                {entry.fulfillmentType === 'HOME_DELIVERY'
                  ? <MapPin className="w-4 h-4 text-blue-400" />
                  : <Car className="w-4 h-4 text-amber-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold">#{entry.orderId.slice(-8).toUpperCase()}</p>
                <p className="text-text-gray text-xs">{entry.vendorName} · {entry.completedAt} · {entry.distanceMi} mi</p>
              </div>
              <div className="text-right shrink-0 space-y-0.5">
                <p className="text-white text-sm font-semibold">${(entry.basePay + entry.tip).toFixed(2)}</p>
                <div className="flex items-center gap-1 justify-end">
                  <span className="text-text-gray text-[0.625rem]">${entry.basePay.toFixed(2)}</span>
                  {entry.tip > 0 && (
                    <span className="text-emerald-400 text-[0.625rem] bg-emerald-500/10 rounded-full px-1.5 py-0.5">
                      +${entry.tip.toFixed(2)} tip
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
