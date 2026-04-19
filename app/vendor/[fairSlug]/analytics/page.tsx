'use client'

import { useState, useEffect } from 'react'
import {
  CurrencyDollarIcon,
  ShoppingBagIcon,
  BanknotesIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
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

interface Vendor {
  id: string
  name: string
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
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [stats, setStats] = useState<VendorStats | null>(null)
  const [chartData, setChartData] = useState<ChartDataPoint[]>([])
  const [period, setPeriod] = useState<ChartPeriod>('7d')
  const [vendorLoading, setVendorLoading] = useState(true)
  const [chartLoading, setChartLoading] = useState(false)

  // 1. Fetch vendor on mount
  useEffect(() => {
    fetch('/api/vendors/me')
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) return
        setVendor(json.data.vendor)
      })
      .catch(() => {})
      .finally(() => setVendorLoading(false))
  }, [])

  // 2. Fetch KPIs when vendor is known
  useEffect(() => {
    if (!vendor) return
    fetch(`/api/vendors/${vendor.id}/stats`)
      .then((r) => r.json())
      .then((json) => { if (json.success) setStats(json.data) })
      .catch(() => {})
  }, [vendor?.id])

  // 3. Fetch chart data when vendor or period changes
  useEffect(() => {
    if (!vendor) return
    setChartLoading(true)
    fetch(`/api/vendors/${vendor.id}/revenue?period=${period}`)
      .then((r) => r.json())
      .then((json) => { if (json.success) setChartData(json.data.data) })
      .catch(() => {})
      .finally(() => setChartLoading(false))
  }, [vendor?.id, period])

  if (vendorLoading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-neon-pink border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!vendor) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <ExclamationTriangleIcon className="w-12 h-12 text-amber-400/60 mx-auto mb-4" />
          <h2 className="font-bebas text-2xl tracking-wide text-white mb-2">No vendor found</h2>
          <p className="text-text-gray text-sm">Your account is not linked to a vendor profile.</p>
        </div>
      </div>
    )
  }

  const periodRevenue = chartData.reduce((s, d) => s + d.revenue, 0)
  const completionRate = stats
    ? ((1 - (stats.cancellationRate ?? 0)) * 100).toFixed(1) + '%'
    : '—'

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
