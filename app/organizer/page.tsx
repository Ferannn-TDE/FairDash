import Link from 'next/link'
import { mockOrganizerFairs, mockOrdersForFair } from '@/lib/mock/organizer'

function StatCard({ label, value, trend, accent = false }: { label: string; value: string; trend: string; accent?: boolean }) {
  return (
    <div className="bg-[#111111] rounded-xl border border-white/5 p-4 sm:p-5">
      <p className="text-xs text-[#666] font-inter uppercase tracking-wider">{label}</p>
      <p className={`mt-2 text-2xl sm:text-3xl font-bebas ${accent ? 'text-[#FF0077]' : 'text-white'}`}>{value}</p>
      <p className="mt-1 text-xs text-[#666] font-inter">{trend}</p>
    </div>
  )
}

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-yellow-400/10 text-yellow-400',
  preparing: 'bg-blue-400/10 text-blue-400',
  ready:     'bg-green-400/10 text-green-400',
  completed: 'bg-white/5 text-[#888]',
  cancelled: 'bg-red-400/10 text-red-400',
}

export default function OrganizerDashboard() {
  const activeFairs = mockOrganizerFairs.filter(f => f.status === 'active')
  const totalOrders = mockOrganizerFairs.reduce((s, f) => s + f.ordersToday, 0)
  const totalRevenue = mockOrganizerFairs.reduce((s, f) => s + f.revenueToday, 0)
  const totalVendors = mockOrganizerFairs.reduce((s, f) => s + f.vendorCount, 0)

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">Dashboard</h1>
          <p className="text-sm text-[#666] font-inter mt-1">Welcome back. Here&apos;s what&apos;s happening today.</p>
        </div>
        <Link
          href="/organizer/fairs/new"
          className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 bg-[#FF0077] text-white text-sm font-semibold rounded-lg hover:bg-[#e0006b] transition-colors whitespace-nowrap"
        >
          + New Fair
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Fairs" value={String(activeFairs.length)} trend="+1 this month" accent />
        <StatCard label="Total Vendors" value={String(totalVendors)} trend="+5 this week" />
        <StatCard label="Orders Today" value={String(totalOrders)} trend="+23% vs yesterday" />
        <StatCard label="Revenue Today" value={`$${totalRevenue.toLocaleString()}`} trend="+18% vs yesterday" />
      </div>

      {/* Active fairs */}
      <section className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bebas text-xl text-white tracking-wide">Active Fairs</h2>
          <Link href="/organizer/fairs" className="text-sm text-[#FF0077] hover:underline font-inter">
            View all →
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {mockOrganizerFairs.map(fair => (
            <Link
              key={fair.id}
              href={`/organizer/fair/${fair.id}`}
              className="bg-[#111111] border border-white/5 rounded-xl p-5 hover:border-white/10 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="font-bebas text-lg text-white tracking-wide">{fair.name}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase
                  ${fair.status === 'active' ? 'bg-green-500/15 text-green-400' : 'bg-sky-500/15 text-sky-400'}`}>
                  {fair.status}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div><p className="text-lg font-bebas text-[#FF0077]">{fair.vendorCount}</p><p className="text-xs text-[#666] font-inter">Vendors</p></div>
                <div><p className="text-lg font-bebas text-white">{fair.ordersToday}</p><p className="text-xs text-[#666] font-inter">Orders</p></div>
                <div><p className="text-lg font-bebas text-white">${fair.revenueToday.toLocaleString()}</p><p className="text-xs text-[#666] font-inter">Revenue</p></div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent orders */}
      <section className="mt-8">
        <h2 className="font-bebas text-xl text-white tracking-wide mb-4">Recent Orders</h2>
        <div className="bg-[#111111] rounded-xl border border-white/5 divide-y divide-white/5">
          {mockOrdersForFair.map(order => (
            <div key={order.id} className="flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-inter font-medium text-white">#{order.shortId}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${STATUS_STYLES[order.status] ?? ''}`}>
                      {order.status}
                    </span>
                  </div>
                  <p className="text-xs text-[#666] font-inter mt-0.5">{order.customerName} · {order.timeAgo}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-white tabular-nums">${order.total.toFixed(2)}</p>
                <p className="text-xs text-[#666] font-inter">{order.vendorName}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
