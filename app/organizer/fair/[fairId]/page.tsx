'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
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

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function FairOverviewPage() {
  const params = useParams<{ fairId: string }>()
  const fairId = params.fairId
  const [fair, setFair] = useState<Fair | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/organizer/fairs')
      .then(r => r.json())
      .then(d => {
        const list: Fair[] = d.data?.fairs ?? []
        const found = list.find(f => f.id === fairId) ?? null
        setFair(found)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [fairId])

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 w-64 bg-white/5 rounded mb-2" />
        <div className="h-4 w-40 bg-white/5 rounded mb-8" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-[#111111] border border-white/5 rounded-xl p-4 h-20" />
          ))}
        </div>
      </div>
    )
  }

  if (!fair) {
    return (
      <div className="text-center py-20">
        <p className="text-[#666] font-inter">Fair not found or you don&apos;t have access to it.</p>
        <Link href="/organizer/fairs" className="mt-4 inline-block text-[#FF0077] text-sm hover:underline">← Back to Fairs</Link>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="font-bebas text-3xl text-white tracking-wide">{fair.name}</h1>
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase
            ${fair.status === 'ACTIVE' ? 'bg-green-500/15 text-green-400' : 'bg-sky-500/15 text-sky-400'}`}>
            {fair.status}
          </span>
        </div>
        <p className="text-sm text-[#666] font-inter">{formatDate(fair.startDate)} – {formatDate(fair.endDate)}</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Vendors', value: String(fair.vendorCount) },
          { label: 'Total Orders', value: String(fair.orderCount) },
          { label: 'Revenue', value: `$${fair.totalRevenue.toLocaleString()}` },
          { label: 'Pending Orders', value: String(fair.pendingOrders) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#111111] border border-white/5 rounded-xl p-4">
            <p className="text-xs text-[#666] font-inter uppercase tracking-wider">{label}</p>
            <p className="mt-2 text-2xl font-bebas text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: 'Manage Vendors', href: `/organizer/fair/${fair.id}/vendors` },
          { label: 'View Orders', href: `/organizer/fair/${fair.id}/orders` },
          { label: 'Analytics', href: `/organizer/fair/${fair.id}/analytics` },
          { label: 'Settings', href: `/organizer/fair/${fair.id}/settings` },
          { label: 'Disputes', href: `/organizer/fair/${fair.id}/disputes` },
          { label: 'View Fair Page', href: `/fair/${fair.slug}` },
        ].map(({ label, href }) => (
          <Link key={label} href={href} className="bg-[#111111] border border-white/5 rounded-xl p-4 hover:border-white/10 transition-colors text-sm font-inter text-[#888] hover:text-white">
            {label} →
          </Link>
        ))}
      </div>
    </div>
  )
}
