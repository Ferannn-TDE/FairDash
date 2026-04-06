import Link from 'next/link'
import { mockOrganizerFairs } from '@/lib/mock/organizer'

export const metadata = { title: 'My Fairs — FairSynq Organizer' }

export default function OrganizerFairsPage() {
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">My Fairs</h1>
          <p className="text-sm text-[#666] font-inter mt-1">{mockOrganizerFairs.length} fair{mockOrganizerFairs.length !== 1 ? 's' : ''} total</p>
        </div>
        <Link href="/organizer/fairs/new" className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 bg-[#FF0077] text-white text-sm font-semibold rounded-lg hover:bg-[#e0006b] transition-colors whitespace-nowrap">
          + Create Fair
        </Link>
      </div>

      <div className="space-y-3">
        {mockOrganizerFairs.map(fair => (
          <div key={fair.id} className="bg-[#111111] border border-white/5 rounded-xl p-5 flex items-center justify-between hover:border-white/10 transition-colors">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bebas text-xl"
                style={{ background: `${fair.accentColor}20`, color: fair.accentColor }}>
                {fair.name[0]}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-white truncate">{fair.name}</p>
                <p className="text-xs text-[#666] font-inter">{fair.dates.start} – {fair.dates.end} · {fair.vendorCount}/{fair.maxVendors} vendors</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-4">
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase
                ${fair.status === 'active' ? 'bg-green-500/15 text-green-400' : 'bg-sky-500/15 text-sky-400'}`}>
                {fair.status}
              </span>
              <Link href={`/organizer/fair/${fair.id}`} className="px-3 py-1.5 text-xs font-inter text-[#888] border border-white/10 rounded-lg hover:text-white hover:border-white/20 transition-colors">
                Manage →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
