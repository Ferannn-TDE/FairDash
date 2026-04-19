'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

export type ChartPeriod = '7d' | '30d' | '90d'

export interface ChartDataPoint {
  day: string
  revenue: number
}

interface RevenueTooltipProps {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}

function RevenueTooltip({ active, payload, label }: RevenueTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 shadow-2xl">
      <p className="text-text-gray text-[10px] uppercase tracking-wide font-semibold mb-0.5">{label}</p>
      <p className="text-white font-semibold text-sm">${payload[0].value.toFixed(2)}</p>
    </div>
  )
}

interface EarningsChartProps {
  data: ChartDataPoint[]
  period: ChartPeriod
  onPeriodChange: (p: ChartPeriod) => void
  loading?: boolean
  title?: string
}

export default function EarningsChart({
  data,
  period,
  onPeriodChange,
  loading = false,
  title = 'Revenue Overview',
}: EarningsChartProps) {
  const total = data.reduce((s, d) => s + d.revenue, 0)
  const lastIndex = data.length - 1

  if (loading) {
    return (
      <div className="bg-bg-card border border-white/10 rounded-2xl p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="h-5 w-36 bg-white/5 rounded animate-pulse mb-2" />
            <div className="h-3.5 w-24 bg-white/5 rounded animate-pulse" />
          </div>
          <div className="h-8 w-28 bg-white/5 rounded-lg animate-pulse" />
        </div>
        <div className="h-40 bg-white/5 rounded-xl animate-pulse" />
      </div>
    )
  }

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="font-bebas text-xl tracking-wide text-white mb-0.5">{title}</h3>
          <p className="text-text-gray text-sm">
            <span className="text-white font-semibold">
              ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>{' '}
            this period
          </p>
        </div>

        {/* Period toggle */}
        <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5">
          {(['7d', '30d', '90d'] as ChartPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 border-0 uppercase ${
                period === p
                  ? 'bg-neon-pink text-white shadow-[0_2px_8px_rgba(255,0,119,0.3)]'
                  : 'bg-transparent text-text-gray hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Recharts bar chart */}
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.04)"
            vertical={false}
          />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#555', fontSize: 10, fontFamily: 'Inter, sans-serif' }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#555', fontSize: 10, fontFamily: 'Inter, sans-serif' }}
            tickFormatter={(v) => `$${v}`}
            width={38}
          />
          <Tooltip
            content={<RevenueTooltip />}
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          />
          <Bar dataKey="revenue" radius={[4, 4, 0, 0]} maxBarSize={32}>
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={i === lastIndex ? 'rgba(255,0,119,0.3)' : '#FF0077'}
                stroke={i === lastIndex ? 'rgba(255,0,119,0.5)' : 'none'}
                strokeWidth={1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/5">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-[#FF0077]" />
          <span className="text-text-gray text-[0.625rem] font-semibold uppercase tracking-wide">
            Past Days
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-neon-pink/30 border border-neon-pink/50" />
          <span className="text-text-gray text-[0.625rem] font-semibold uppercase tracking-wide">
            Today
          </span>
        </div>
      </div>
    </div>
  )
}
