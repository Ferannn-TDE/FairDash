'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api-fetcher'
import { useParams } from 'next/navigation'
import {
  CurrencyDollarIcon,
  ShoppingBagIcon,
  CheckCircleIcon,
  ArrowTrendingUpIcon,
  ArrowPathIcon,
  TrophyIcon,
} from '@heroicons/react/24/outline'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts'
import EarningsChart, { type ChartDataPoint, type ChartPeriod } from '@/app/_components/EarningsChart'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stats {
  liveOrders: number
  ordersToday: number
  revenueToday: number
  platformFeeToday: number
  activeVendors: number
  totalVendors: number
  totalRevenue: number
  totalOrders: number
  avgOrderValue: number
  completionRate: number
}

interface VendorGridItem {
  id: string
  name: string
  cuisineType: string
  status: string
  isOffline: boolean
  ordersToday: number
  revenueToday: number
  allTimeRevenue: number
  allTimeOrders: number
}

interface TopItem {
  name: string
  quantity: number
  revenue: number
  orders: number
}

type Tab = 'overview' | 'vendors' | 'revenue' | 'items'

// ── Shared components ─────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, sub, accentColor = 'pink', loading,
}: {
  label: string; value: string; icon: React.ElementType
  sub?: string; accentColor?: 'pink' | 'blue' | 'emerald' | 'amber'; loading?: boolean
}) {
  const accent = {
    pink:    { bg: 'bg-neon-pink/10',   border: 'border-neon-pink/20',   text: 'text-neon-pink' },
    blue:    { bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-400' },
    emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400' },
    amber:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   text: 'text-amber-400' },
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

// ── Custom recharts tooltip ───────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 shadow-xl">
      <p className="text-white/40 text-[10px] uppercase tracking-wide font-semibold mb-0.5">{label}</p>
      <p className="text-white font-semibold text-sm">${(payload[0].value ?? 0).toFixed(2)}</p>
    </div>
  )
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ stats, loading }: { stats: Stats | null; loading: boolean }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Revenue" loading={loading}
          value={stats ? `$${stats.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
          icon={CurrencyDollarIcon} accentColor="pink"
          sub={stats ? `$${stats.revenueToday.toFixed(2)} today` : undefined}
        />
        <StatCard
          label="Total Orders" loading={loading}
          value={stats ? String(stats.totalOrders) : '—'}
          icon={ShoppingBagIcon} accentColor="blue"
          sub={stats ? `${stats.ordersToday} today · ${stats.liveOrders} live` : undefined}
        />
        <StatCard
          label="Avg Order Value" loading={loading}
          value={stats ? `$${stats.avgOrderValue.toFixed(2)}` : '—'}
          icon={ArrowTrendingUpIcon} accentColor="amber"
        />
        <StatCard
          label="Completion Rate" loading={loading}
          value={stats ? `${stats.completionRate.toFixed(1)}%` : '—'}
          icon={CheckCircleIcon} accentColor="emerald"
          sub={stats ? `${stats.activeVendors}/${stats.totalVendors} vendors active` : undefined}
        />
      </div>
    </div>
  )
}

// ── Tab: By Vendor ────────────────────────────────────────────────────────────

function VendorsTab({ vendors, loading }: { vendors: VendorGridItem[]; loading: boolean }) {
  const sorted = [...vendors].sort((a, b) => b.allTimeRevenue - a.allTimeRevenue)
  const maxRev = sorted[0]?.allTimeRevenue ?? 1

  const chartData = sorted.slice(0, 12).map(v => ({
    name: v.name.length > 14 ? v.name.slice(0, 14) + '…' : v.name,
    revenue: v.allTimeRevenue,
  }))

  return (
    <div className="space-y-6">
      {/* Bar chart */}
      <div className="bg-bg-card border border-white/10 rounded-2xl p-6">
        <h3 className="font-bebas text-xl tracking-wide text-white mb-5">Revenue by Vendor</h3>
        {loading ? (
          <div className="h-48 bg-white/[0.03] rounded-xl animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barSize={28}>
              <XAxis dataKey="name" tick={{ fill: '#555', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#555', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="revenue" fill="#FF0077" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Vendor table */}
      <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.06]">
          <h3 className="font-bebas text-xl tracking-wide text-white">Vendor Breakdown</h3>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-white/[0.04] rounded-lg animate-pulse" />)}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {sorted.map((vendor, idx) => (
              <div key={vendor.id} className="px-5 py-3.5 flex items-center gap-4">
                <span className="text-white/20 text-xs font-inter tabular-nums w-5 shrink-0">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-inter font-semibold truncate">{vendor.name}</p>
                  <p className="text-white/30 text-xs font-inter">{vendor.cuisineType}</p>
                </div>
                {/* Revenue bar */}
                <div className="hidden sm:flex items-center gap-2 w-32 shrink-0">
                  <div className="flex-1 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-neon-pink rounded-full transition-all duration-500"
                      style={{ width: `${(vendor.allTimeRevenue / maxRev) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-white text-sm font-inter tabular-nums font-semibold">
                    ${vendor.allTimeRevenue.toFixed(0)}
                  </p>
                  <p className="text-white/30 text-xs font-inter">{vendor.allTimeOrders} orders</p>
                </div>
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  vendor.isOffline ? 'bg-white/20' :
                  vendor.status !== 'ACTIVE' ? 'bg-amber-400' : 'bg-emerald-400'
                }`} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tab: Revenue over time ────────────────────────────────────────────────────

function RevenueTab({ fairSlug }: { fairSlug: string }) {
  const [period, setPeriod] = useState<ChartPeriod>('7d')
  const query = useQuery({
    queryKey: ['organizer-analytics-revenue', fairSlug, period],
    queryFn: () => fetchJson<{ data: ChartDataPoint[] }>(`/api/organizer/fairs/${fairSlug}/analytics/revenue?period=${period}`),
  })
  const chartData = query.data?.data ?? []
  const loading = query.isPending

  const periodRevenue = chartData.reduce((s, d) => s + d.revenue, 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-bg-card border border-white/10 rounded-2xl p-5">
          <p className="text-text-gray text-[0.6875rem] uppercase tracking-wide font-semibold mb-1">
            {period} Revenue
          </p>
          <p className="font-bebas text-[2rem] text-white leading-none">
            ${periodRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-bg-card border border-white/10 rounded-2xl p-5">
          <p className="text-text-gray text-[0.6875rem] uppercase tracking-wide font-semibold mb-1">Peak Day</p>
          <p className="font-bebas text-[2rem] text-white leading-none">
            {chartData.length > 0
              ? chartData.reduce((a, b) => a.revenue > b.revenue ? a : b).day
              : '—'}
          </p>
        </div>
        <div className="bg-bg-card border border-white/10 rounded-2xl p-5">
          <p className="text-text-gray text-[0.6875rem] uppercase tracking-wide font-semibold mb-1">Daily Average</p>
          <p className="font-bebas text-[2rem] text-white leading-none">
            {chartData.length > 0
              ? `$${(periodRevenue / chartData.length).toFixed(2)}`
              : '—'}
          </p>
        </div>
      </div>
      <EarningsChart
        data={chartData}
        period={period}
        onPeriodChange={setPeriod}
        loading={loading}
        title="Fair Revenue Over Time"
      />
    </div>
  )
}

// ── Tab: Top items ────────────────────────────────────────────────────────────

function ItemsTab({ fairSlug }: { fairSlug: string }) {
  const query = useQuery({
    queryKey: ['organizer-analytics-top-items', fairSlug],
    queryFn: () => fetchJson<{ items: TopItem[] }>(`/api/organizer/fairs/${fairSlug}/analytics/top-items`),
  })
  const items = query.data?.items ?? []
  const loading = query.isPending

  const maxRev = items[0]?.revenue ?? 1

  const chartData = items.slice(0, 10).map(item => ({
    name: item.name.length > 18 ? item.name.slice(0, 18) + '…' : item.name,
    revenue: item.revenue,
  }))

  return (
    <div className="space-y-6">
      {/* Bar chart */}
      <div className="bg-bg-card border border-white/10 rounded-2xl p-6">
        <h3 className="font-bebas text-xl tracking-wide text-white mb-5">Top Items by Revenue</h3>
        {loading ? (
          <div className="h-56 bg-white/[0.03] rounded-xl animate-pulse" />
        ) : items.length === 0 ? (
          <p className="text-white/20 text-sm font-inter text-center py-10">No completed orders yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} layout="vertical" barSize={18}>
              <XAxis type="number" tick={{ fill: '#555', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#888', fontSize: 10 }} axisLine={false} tickLine={false} width={110} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="revenue" fill="#FF0077" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Table */}
      <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.06]">
          <h3 className="font-bebas text-xl tracking-wide text-white">Items Breakdown</h3>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-white/[0.04] rounded-lg animate-pulse" />)}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {items.map((item, idx) => (
              <div key={item.name} className="px-5 py-3 flex items-center gap-4">
                <div className="flex items-center gap-2 shrink-0">
                  {idx === 0 && <TrophyIcon className="w-4 h-4 text-amber-400" />}
                  {idx > 0 && <span className="text-white/20 text-xs font-inter tabular-nums w-4 text-center">{idx + 1}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-inter truncate">{item.name}</p>
                  <p className="text-white/30 text-xs font-inter">{item.quantity} sold · {item.orders} orders</p>
                </div>
                <div className="hidden sm:flex items-center gap-2 w-28 shrink-0">
                  <div className="flex-1 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-neon-pink rounded-full"
                      style={{ width: `${(item.revenue / maxRev) * 100}%` }}
                    />
                  </div>
                </div>
                <p className="text-white text-sm font-inter tabular-nums font-semibold shrink-0">
                  ${item.revenue.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FairAnalyticsPage() {
  const { fairSlug } = useParams<{ fairSlug: string }>()

  const [tab, setTab] = useState<Tab>('overview')
  const query = useQuery({
    queryKey: ['organizer-analytics-overview', fairSlug],
    queryFn: () => fetchJson<{ stats: Stats; vendorGrid?: VendorGridItem[] }>(`/api/organizer/fairs/${fairSlug}/analytics`),
  })
  const stats   = query.data?.stats ?? null
  const vendors = query.data?.vendorGrid ?? []
  const loading = query.isPending

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'vendors',  label: 'By Vendor' },
    { key: 'revenue',  label: 'Revenue' },
    { key: 'items',    label: 'Top Items' },
  ]

  return (
    <div className="p-6 md:p-4 max-w-[78rem] mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight mb-1">
            Fair <span className="text-neon-pink">Analytics</span>
          </h1>
          <p className="text-text-gray text-sm">Event-wide performance overview</p>
        </div>
        <button
          onClick={() => query.refetch()}
          className="shrink-0 p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer"
        >
          <ArrowPathIcon className={`w-4 h-4 text-white/50 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-[#111] border border-white/5 rounded-lg p-1 mb-6 overflow-x-auto scrollbar-none w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold font-inter whitespace-nowrap transition-colors cursor-pointer ${
              tab === t.key ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && <OverviewTab stats={stats} loading={loading} />}
      {tab === 'vendors'  && <VendorsTab  vendors={vendors} loading={loading} />}
      {tab === 'revenue'  && <RevenueTab  fairSlug={fairSlug} />}
      {tab === 'items'    && <ItemsTab    fairSlug={fairSlug} />}
    </div>
  )
}
