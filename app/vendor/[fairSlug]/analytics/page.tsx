'use client'

import { useState } from 'react'
import {
  CurrencyDollarIcon,
  ShoppingBagIcon,
  BanknotesIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import EarningsChart, { type ChartDataPoint, type ChartPeriod } from '@/app/_components/EarningsChart'

interface VendorStats {
  todayRevenue: number
  todayOrders: number
  avgOrderValue: number
  acceptanceRate: number
  cancellationRate: number
  pendingOrders: number
}

const MOCK_VENDOR = { id: 'vendor_001', name: 'Smoky Barrel BBQ' }

const MOCK_STATS: VendorStats = {
  todayRevenue: 487.50,
  todayOrders: 23,
  avgOrderValue: 21.20,
  acceptanceRate: 0.97,
  cancellationRate: 0.03,
  pendingOrders: 2,
}

function buildChartData(period: ChartPeriod): ChartDataPoint[] {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
  return Array.from({ length: days }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (days - 1 - i))
    return {
      date: d.toISOString().slice(0, 10),
      revenue: Math.round(300 + Math.random() * 400),
      orders: Math.round(10 + Math.random() * 20),
    }
  })
}

function StatCard({
  label,
  value,
  icon: Icon,
  accentColor = 'pink',
  loading,
}: {
  label: string
  value: string | number
  icon: React.ElementType
  accentColor?: 'pink' | 'blue' | 'emerald' | 'amber'
  loading?: boolean
}) {
  const accent = {
    pink:    { bg: 'bg-neon-pink/10',    border: 'border-neon-pink/20',    text: 'text-neon-pink' },
    blue:    { bg: 'bg-blue-500/10',     border: 'border-blue-500/20',     text: 'text-blue-400' },
    emerald: { bg: 'bg-emerald-500/10',  border: 'border-emerald-500/20',  text: 'text-emerald-400' },
    amber:   { bg: 'bg-amber-500/10',    border: 'border-amber-500/20',    text: 'text-amber-400' },
  }[accentColor]

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-5 hover:border-white/20 hover:-translate-y-0.5 transition-all duration-300">
      <div className="mb-4">
        <div className={`w-10 h-10 ${accent.bg} ${accent.border} border rounded-xl flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${accent.text}`} />
        </div>
      </div>
      {loading ? (
        <div className="h-8 w-24 bg-white/5 rounded-lg animate-pulse mb-1" />
      ) : (
        <div className="font-bebas text-[2rem] tracking-wide text-white leading-none mb-1">{value}</div>
      )}
      <div className="text-text-gray text-[0.6875rem] uppercase tracking-wide font-semibold">{label}</div>
    </div>
  )
}

export default function VendorAnalyticsPage() {
  const vendor = MOCK_VENDOR
  const stats = MOCK_STATS
  const [period, setPeriod] = useState<ChartPeriod>('7d')
  const chartData = buildChartData(period)

  const periodRevenue = chartData.reduce((s, d) => s + d.revenue, 0)
  const completionRate = ((1 - stats.cancellationRate) * 100).toFixed(1) + '%'

  return (
    <div className="p-6 md:p-4 sm:p-3 max-w-[78rem] mx-auto">

      {/* Header */}
      <div className="mb-8">
        <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight mb-1">
          Revenue <span className="text-neon-pink">Analytics</span>
        </h1>
        <p className="text-text-gray text-sm">{vendor.name}</p>
      </div>

      {/* Chart — full width */}
      <div className="mb-8 animate-fadeIn">
        <EarningsChart
          data={chartData}
          period={period}
          onPeriodChange={setPeriod}
          loading={chartLoading}
          title="Revenue Overview"
        />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 desktop:grid-cols-4 gap-4 mb-8 animate-fadeIn [animation-delay:0.1s]">
        <StatCard
          label={`${period} Revenue`}
          value={chartLoading ? '—' : `$${periodRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          icon={CurrencyDollarIcon}
          accentColor="pink"
          loading={chartLoading}
        />
        <StatCard
          label="Today's Orders"
          value={stats?.todayOrders ?? '—'}
          icon={ShoppingBagIcon}
          accentColor="blue"
          loading={!stats}
        />
        <StatCard
          label="Avg Order Value"
          value={stats ? `$${stats.avgOrderValue.toFixed(2)}` : '—'}
          icon={BanknotesIcon}
          accentColor="emerald"
          loading={!stats}
        />
        <StatCard
          label="Completion Rate"
          value={completionRate}
          icon={CheckCircleIcon}
          accentColor="amber"
          loading={!stats}
        />
      </div>

      {/* Today's snapshot */}
      {stats && (
        <div className="bg-bg-card border border-white/10 rounded-2xl p-6 animate-fadeIn [animation-delay:0.2s]">
          <h3 className="font-bebas text-xl tracking-wide text-white mb-5">Today&apos;s Snapshot</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            {[
              { label: "Today's Revenue", value: `$${stats.todayRevenue.toFixed(2)}` },
              { label: 'Today\'s Orders',  value: String(stats.todayOrders) },
              { label: 'Pending Orders',   value: String(stats.pendingOrders) },
              { label: 'Acceptance Rate',  value: `${(stats.acceptanceRate * 100).toFixed(1)}%` },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1">{label}</p>
                <p className="font-bebas text-2xl text-white tracking-wide">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
