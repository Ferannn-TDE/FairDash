import Link from 'next/link'
import { mockOrganizerFairs } from '@/lib/mock/organizer'

export default async function FairOverviewPage({ params }: { params: Promise<{ fairId: string }> }) {
  const { fairId } = await params
  const fair = mockOrganizerFairs.find(f => f.id === fairId) ?? mockOrganizerFairs[0]

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="font-bebas text-3xl text-white tracking-wide">{fair.name}</h1>
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase
            ${fair.status === 'active' ? 'bg-green-500/15 text-green-400' : 'bg-sky-500/15 text-sky-400'}`}>
            {fair.status}
          </span>
        </div>
        <p className="text-sm text-[#666] font-inter">{fair.dates.start} – {fair.dates.end}</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Vendors', value: `${fair.vendorCount}/${fair.maxVendors}` },
          { label: 'Orders Today', value: String(fair.ordersToday) },
          { label: 'Revenue Today', value: `$${fair.revenueToday.toLocaleString()}` },
          { label: 'Status', value: fair.status },
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
