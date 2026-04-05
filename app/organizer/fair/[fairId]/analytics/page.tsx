'use client'

import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { mockChartData, mockVendorsForFair } from '@/lib/mock/organizer'

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#111111] border border-white/5 rounded-xl p-4">
      <p className="text-xs text-[#666] font-inter uppercase tracking-wider">{label}</p>
      <p className="mt-2 text-2xl font-bebas text-white">{value}</p>
    </div>
  )
}

const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#fff' },
  itemStyle: { color: '#FF0077' },
}

export default function FairAnalyticsPage() {
  return (
    <div>
      <h1 className="font-bebas text-3xl text-white tracking-wide mb-6">Analytics</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Revenue" value="$14,280" />
        <StatCard label="Platform Fee (10%)" value="$1,428" />
        <StatCard label="Total Orders" value="847" />
        <StatCard label="Avg. Order Value" value="$16.86" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Orders over time */}
        <div className="bg-[#111111] border border-white/5 rounded-xl p-5">
          <h3 className="text-xs text-[#666] font-inter uppercase tracking-wider mb-4">Orders Over Time</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={mockChartData.ordersOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#666', fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="orders" stroke="#FF0077" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Revenue by vendor */}
        <div className="bg-[#111111] border border-white/5 rounded-xl p-5">
          <h3 className="text-xs text-[#666] font-inter uppercase tracking-wider mb-4">Revenue by Vendor</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={mockChartData.revenueByVendor}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="name" tick={{ fill: '#666', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#666', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="revenue" fill="#FF0077" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top items */}
        <div className="bg-[#111111] border border-white/5 rounded-xl p-5">
          <h3 className="text-xs text-[#666] font-inter uppercase tracking-wider mb-4">Top Items</h3>
          <div className="space-y-3">
            {mockChartData.topItems.map((item, i) => (
              <div key={item.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-5 text-xs text-[#555] font-inter tabular-nums shrink-0">{i + 1}.</span>
                  <div className="min-w-0">
                    <p className="text-sm text-white font-inter truncate">{item.name}</p>
                    <p className="text-xs text-[#666] font-inter truncate">{item.vendorName}</p>
                  </div>
                </div>
                <p className="text-sm text-white font-inter tabular-nums shrink-0 ml-3">{item.orderCount} sold</p>
              </div>
            ))}
          </div>
        </div>

        {/* Vendor performance */}
        <div className="bg-[#111111] border border-white/5 rounded-xl p-5">
          <h3 className="text-xs text-[#666] font-inter uppercase tracking-wider mb-4">Vendor Performance</h3>
          <div className="space-y-3">
            {mockVendorsForFair.filter(v => v.status === 'active').map(vendor => (
              <div key={vendor.id} className="flex items-center justify-between">
                <p className="text-sm text-white font-inter truncate mr-3">{vendor.name}</p>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-[#666] font-inter tabular-nums">{vendor.ordersTotal} orders</span>
                  <span className="text-xs text-[#666] font-inter tabular-nums">${vendor.revenueTotal.toLocaleString()}</span>
                  <span className={`text-xs font-inter tabular-nums ${vendor.avgPrepTime <= 10 ? 'text-green-400' : vendor.avgPrepTime <= 15 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {vendor.avgPrepTime} min
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
