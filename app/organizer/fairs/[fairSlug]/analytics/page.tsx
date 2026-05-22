'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import {
  CurrencyDollarIcon,
  ShoppingBagIcon,
  BanknotesIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'
import EarningsChart, { type ChartDataPoint, type ChartPeriod } from '@/app/_components/EarningsChart'

interface DashboardStats {
  liveOrders: number
  ordersToday: number
  revenueToday: number
  platformFeeToday: number
  activeVendors: number
  totalVendors: number
  activeRunners: number
}

interface VendorGridItem {
  id: string
  name: string
  cuisineType: string
  status: string
  isOffline: boolean
  ordersToday?: number
  revenueToday?: number
  avgPrepTime?: number
}

function StatCard({
  label,
  value,
  icon: Icon,
  sub,
  accentColor = 'pink',
  loading,
}: {
  label: string
  value: string
  icon: React.ElementType
  sub?: string
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
    <div className="bg-bg-card border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-all duration-300">
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
      {sub && <div className="text-text-gray text-[0.625rem] mt-0.5">{sub}</div>}
    </div>
  )
}

export default function FairAnalyticsPage() {
  const params = useParams<{ fairSlug: string }>()
  const fairSlug = params.fairSlug

  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [vendorGrid, setVendorGrid] = useState<VendorGridItem[]>([])
  const [chartData, setChartData] = useState<ChartDataPoint[]>([])
  const [period, setPeriod] = useState<ChartPeriod>('7d')
  const [statsLoading, setStatsLoading] = useState(true)
  const [chartLoading, setChartLoading] = useState(false)

  useEffect(() => {
    fetch(`/api/admin/events/${fairSlug}/dashboard`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) return
        setStats(json.data.stats)
        setVendorGrid(json.data.vendorGrid ?? [])
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [fairSlug])

  useEffect(() => {
    setChartLoading(true)
    fetch(`/api/admin/events/${fairSlug}/revenue?period=${period}`)
      .then(r => r.json())
      .then(json => { if (json.success) setChartData(json.data.data) })
      .catch(() => {})
      .finally(() => setChartLoading(false))
  }, [fairSlug, period])

  const periodRevenue = chartData.reduce((s, d) => s + d.revenue, 0)
  const activeVendors = vendorGrid.filter(v => v.status === 'ACTIVE' && !v.isOffline)

  return (
    <div className="p-6 md:p-4 max-w-[78rem] mx-auto">
      <div className="mb-8">
        <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight mb-1">
          Fair <span className="text-neon-pink">Analytics</span>
        </h1>
        <p className="text-text-gray text-sm">Live event performance overview</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label={`${period} Revenue`}
          value={chartLoading ? '—' : `$${periodRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          icon={CurrencyDollarIcon}
          accentColor="pink"
          loading={chartLoading}
        />
        <StatCard
          label="Orders Today"
          value={stats ? String(stats.ordersToday) : '—'}
          icon={ShoppingBagIcon}
          accentColor="blue"
          loading={statsLoading}
        />
        <StatCard
          label="Revenue Today"
          value={stats ? `$${Number(stats.revenueToday).toFixed(2)}` : '—'}
          icon={BanknotesIcon}
          accentColor="emerald"
          sub={stats ? `$${Number(stats.platformFeeToday).toFixed(2)} platform fee` : undefined}
          loading={statsLoading}
        />
        <StatCard
          label="Active Vendors"
          value={stats ? `${stats.activeVendors}/${stats.totalVendors}` : '—'}
          icon={UsersIcon}
          accentColor="amber"
          sub={stats ? `${stats.activeRunners} runners active` : undefined}
          loading={statsLoading}
        />
      </div>

      {/* Revenue chart */}
      <div className="mb-8">
        <EarningsChart
          data={chartData}
          period={period}
          onPeriodChange={setPeriod}
          loading={chartLoading}
          title="Revenue Overview"
        />
      </div>

      {/* Vendor performance */}
      {activeVendors.length > 0 && (
        <div className="bg-bg-card border border-white/10 rounded-2xl p-6">
          <h3 className="font-bebas text-xl tracking-wide text-white mb-5">Vendor Performance</h3>
          <div className="space-y-3">
            {activeVendors.map(vendor => (
              <div key={vendor.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white font-inter truncate">{vendor.name}</p>
                  <p className="text-xs text-text-gray font-inter">{vendor.cuisineType}</p>
                </div>
                <div className="flex items-center gap-4 shrink-0 text-right">
                  <div>
                    <p className="text-sm text-white font-inter tabular-nums">{vendor.ordersToday ?? '—'}</p>
                    <p className="text-[10px] text-text-gray font-inter">orders</p>
                  </div>
                  <div>
                    <p className="text-sm text-white font-inter tabular-nums">${(vendor.revenueToday ?? 0).toFixed(0)}</p>
                    <p className="text-[10px] text-text-gray font-inter">revenue</p>
                  </div>
                  {(vendor.avgPrepTime ?? 0) > 0 && (
                    <div>
                      <p className={`text-sm font-inter tabular-nums ${(vendor.avgPrepTime ?? 0) <= 10 ? 'text-green-400' : (vendor.avgPrepTime ?? 0) <= 15 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {vendor.avgPrepTime}m
                      </p>
                      <p className="text-[10px] text-text-gray font-inter">avg prep</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
