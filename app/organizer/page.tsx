'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Fair {
  id: string
  name: string
  slug: string
  status: string
  startDate: string
  endDate: string
  vendorCount: number
  orderCount: number
  totalRevenue: number
  pendingOrders: number
}

interface Order {
  id: string
  status: string
  total: number
  placedAt: string
  customerName: string
  vendorName: string
  boothNumber: string | null
  items: { id: string; name: string; quantity: number }[]
}

interface Stats {
  activeFairs: number
  totalOrders: number
  ordersToday: number
  totalRevenue: number
  totalVendors: number
}

function StatCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-[#111111] rounded-xl border border-white/5 p-4 sm:p-5">
      <p className="text-xs text-[#666] font-inter uppercase tracking-wider">{label}</p>
      <p className={`mt-2 text-2xl sm:text-3xl font-bebas ${accent ? 'text-[#FF0077]' : 'text-white'}`}>{value}</p>
    </div>
  )
}

const STATUS_STYLES: Record<string, string> = {
  PLACED:            'bg-yellow-400/10 text-yellow-400',
  ACCEPTED:          'bg-yellow-400/10 text-yellow-400',
  PREPARING:         'bg-blue-400/10 text-blue-400',
  READY:             'bg-green-400/10 text-green-400',
  RUNNER_COLLECTED:  'bg-green-400/10 text-green-400',
  COMPLETED:         'bg-white/5 text-[#888]',
  DELIVERED:         'bg-white/5 text-[#888]',
  CANCELLED:         'bg-red-400/10 text-red-400',
}

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function OrganizerDashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [fairs, setFairs] = useState<Fair[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, fairsRes, ordersRes] = await Promise.all([
          fetch('/api/organizer/stats'),
          fetch('/api/organizer/fairs'),
          fetch('/api/organizer/orders?limit=10'),
        ])
        const [statsData, fairsData, ordersData] = await Promise.all([
          statsRes.json(),
          fairsRes.json(),
          ordersRes.json(),
        ])
        if (statsData.data) setStats(statsData.data)
        if (fairsData.data?.fairs) setFairs(fairsData.data.fairs)
        if (ordersData.data?.orders) setOrders(ordersData.data.orders)
      } catch {
        // silently fail — show empty state
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

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
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-[#111111] rounded-xl border border-white/5 p-4 sm:p-5 animate-pulse">
              <div className="h-3 w-20 bg-white/5 rounded mb-3" />
              <div className="h-8 w-16 bg-white/5 rounded" />
            </div>
          ))
        ) : (
          <>
            <StatCard label="Active Fairs" value={String(stats?.activeFairs ?? 0)} accent />
            <StatCard label="Total Vendors" value={String(stats?.totalVendors ?? 0)} />
            <StatCard label="Orders Today" value={String(stats?.ordersToday ?? 0)} />
            <StatCard label="Total Revenue" value={`$${(stats?.totalRevenue ?? 0).toLocaleString()}`} />
          </>
        )}
      </div>

      {/* Active fairs */}
      <section className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bebas text-xl text-white tracking-wide">Your Fairs</h2>
          <Link href="/organizer/fairs" className="text-sm text-[#FF0077] hover:underline font-inter">
            View all →
          </Link>
        </div>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="bg-[#111111] border border-white/5 rounded-xl p-5 animate-pulse">
                <div className="h-5 w-40 bg-white/5 rounded mb-4" />
                <div className="grid grid-cols-3 gap-3">
                  {Array.from({ length: 3 }).map((_, j) => <div key={j} className="h-8 bg-white/5 rounded" />)}
                </div>
              </div>
            ))}
          </div>
        ) : fairs.length === 0 ? (
          <div className="bg-[#111111] border border-white/5 rounded-xl p-8 text-center">
            <p className="text-[#666] font-inter text-sm">No fairs yet. Create your first fair to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {fairs.map(fair => (
              <Link
                key={fair.id}
                href={`/organizer/fairs/${fair.slug}`}
                className="bg-[#111111] border border-white/5 rounded-xl p-5 hover:border-white/10 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bebas text-lg text-white tracking-wide">{fair.name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase
                    ${fair.status === 'ACTIVE' ? 'bg-green-500/15 text-green-400' : 'bg-sky-500/15 text-sky-400'}`}>
                    {fair.status}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div><p className="text-lg font-bebas text-[#FF0077]">{fair.vendorCount}</p><p className="text-xs text-[#666] font-inter">Vendors</p></div>
                  <div><p className="text-lg font-bebas text-white">{fair.orderCount}</p><p className="text-xs text-[#666] font-inter">Orders</p></div>
                  <div><p className="text-lg font-bebas text-white">${fair.totalRevenue.toLocaleString()}</p><p className="text-xs text-[#666] font-inter">Revenue</p></div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Recent orders */}
      <section className="mt-8">
        <h2 className="font-bebas text-xl text-white tracking-wide mb-4">Recent Orders</h2>
        {loading ? (
          <div className="bg-[#111111] rounded-xl border border-white/5 divide-y divide-white/5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 p-4 animate-pulse">
                <div className="flex-1">
                  <div className="h-4 w-24 bg-white/5 rounded mb-2" />
                  <div className="h-3 w-36 bg-white/5 rounded" />
                </div>
                <div className="h-4 w-14 bg-white/5 rounded" />
              </div>
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-[#111111] rounded-xl border border-white/5 p-8 text-center">
            <p className="text-[#666] font-inter text-sm">No orders yet.</p>
          </div>
        ) : (
          <div className="bg-[#111111] rounded-xl border border-white/5 divide-y divide-white/5">
            {orders.map(order => (
              <div key={order.id} className="flex items-center justify-between gap-3 p-4 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-inter font-medium text-white">#{order.id.slice(-6).toUpperCase()}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${STATUS_STYLES[order.status] ?? ''}`}>
                        {order.status}
                      </span>
                    </div>
                    <p className="text-xs text-[#666] font-inter mt-0.5 truncate">{order.customerName} · {timeAgo(order.placedAt)}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-white tabular-nums">${order.total.toFixed(2)}</p>
                  <p className="text-xs text-[#666] font-inter truncate max-w-[100px]">{order.vendorName}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
