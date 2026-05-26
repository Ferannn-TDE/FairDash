'use client'

import { useState, useEffect } from 'react'
import {
  CurrencyDollarIcon,
  ShoppingBagIcon,
  BanknotesIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import EarningsChart, { type ChartDataPoint, type ChartPeriod } from '@/app/_components/EarningsChart'
import { useVendorMeta } from '@/lib/contexts/VendorContext'

interface AnalyticsData {
  chartData: ChartDataPoint[]
  totalRevenue: number
  totalOrders: number
  avgOrderValue: number
  completionRate: number
  totalItemsSold: number
}

function StatCard({
  label,
  value,
  icon: Icon,
  accentColor = 'pink',
  loading,
  note,
}: {
  label: string
  value: string | number
  icon: React.ElementType
  accentColor?: 'pink' | 'blue' | 'emerald' | 'amber'
  loading?: boolean
  note?: string
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
      {note && <p className="text-white/30 text-xs mt-1">{note}</p>}
    </div>
  )
}

export default function VendorAnalyticsPage() {
  const { vendorId, vendorName } = useVendorMeta()
  const [period, setPeriod] = useState<ChartPeriod>('7d')
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!vendorId) return
    setLoading(true)
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
    fetch(`/api/vendors/${vendorId}/analytics?days=${days}`)
      .then(r => r.json())
      .then(json => { if (json.success) setAnalytics(json.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [vendorId, period])

  const periodRevenue = analytics?.totalRevenue ?? 0
  const completionRate = analytics ? `${(analytics.completionRate * 100).toFixed(1)}%` : '—'

  return (
    <div className="p-6 md:p-4 sm:p-3 max-w-[78rem] mx-auto">

      {/* Header */}
      <div className="mb-8">
        <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight mb-1">
          Revenue <span className="text-neon-pink">Analytics</span>
        </h1>
        <p className="text-text-gray text-sm">{vendorName ?? '—'}</p>
      </div>

      {/* Chart — full width */}
      <div className="mb-8 animate-fadeIn">
        <EarningsChart
          data={analytics?.chartData ?? []}
          period={period}
          onPeriodChange={setPeriod}
          loading={loading}
          title="Revenue Overview"
        />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 desktop:grid-cols-4 gap-4 mb-8 animate-fadeIn [animation-delay:0.1s]">
        <StatCard
          label={`${period} Revenue`}
          value={`$${periodRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          icon={CurrencyDollarIcon}
          accentColor="pink"
          loading={loading}
          note="Excludes platform fees"
        />
        <StatCard
          label="Today's Orders"
          value={analytics?.totalOrders ?? '—'}
          icon={ShoppingBagIcon}
          accentColor="blue"
          loading={loading}
        />
        <StatCard
          label="Avg Order Value"
          value={analytics ? `$${(analytics.avgOrderValue ?? 0).toFixed(2)}` : '—'}
          icon={BanknotesIcon}
          accentColor="emerald"
          loading={loading}
        />
        <StatCard
          label="Completion Rate"
          value={completionRate}
          icon={CheckCircleIcon}
          accentColor="amber"
          loading={loading}
        />
      </div>

      {/* Today's snapshot */}
      {analytics && (
        <div className="bg-bg-card border border-white/10 rounded-2xl p-6 animate-fadeIn [animation-delay:0.2s]">
          <h3 className="font-bebas text-xl tracking-wide text-white mb-5">Today&apos;s Snapshot</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            {[
              { label: "Period Revenue", value: `$${(analytics.totalRevenue ?? 0).toFixed(2)}`, note: 'Excludes platform fees' },
              { label: 'Total Orders',  value: String(analytics.totalOrders ?? 0) },
              { label: 'Items Sold',    value: String(analytics.totalItemsSold ?? 0) },
              { label: 'Completion Rate', value: completionRate },
            ].map(({ label, value, note }) => (
              <div key={label}>
                <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1">{label}</p>
                <p className="font-bebas text-2xl text-white tracking-wide">{value}</p>
                {note && <p className="text-white/30 text-xs mt-0.5">{note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
