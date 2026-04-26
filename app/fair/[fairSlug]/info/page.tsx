'use client'

import { MapPinIcon, ClockIcon, CalendarIcon, EnvelopeIcon, GlobeAltIcon, TicketIcon } from '@heroicons/react/24/outline'
import { useFair } from '../../../_contexts/FairContext'
import StatusBadge from '../../../_components/StatusBadge'
import Breadcrumb from '../_components/Breadcrumb'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export default function FairInfoPage() {
  const { fair } = useFair()
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  return (
    <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-10 text-white">
      <Breadcrumb crumbs={[{ label: 'Info' }]} />
      <div className="flex items-center gap-3 mb-8">
        <h1 className="font-bebas text-4xl text-white tracking-wide">Fair Info</h1>
        <StatusBadge status={fair.status} />
      </div>

      {fair.description && (
        <p className="text-text-gray leading-relaxed mb-10 max-w-2xl">{fair.description}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {[
          { icon: MapPinIcon, label: 'Address', value: fair.location.address },
          { icon: CalendarIcon, label: 'Start Date', value: formatDate(fair.dates.startDate) },
          { icon: CalendarIcon, label: 'End Date', value: formatDate(fair.dates.endDate) },
          { icon: ClockIcon, label: 'Hours', value: `Opens ${fair.operatingHours.open} · Closes ${fair.operatingHours.close}` },
          { icon: TicketIcon, label: 'Admission', value: fair.admissionFree ? 'Free — no ticket required' : 'Paid admission required' },
          ...(fair.contactEmail ? [{ icon: EnvelopeIcon, label: 'Contact', value: fair.contactEmail }] : []),
          ...(fair.website ? [{ icon: GlobeAltIcon, label: 'Website', value: fair.website }] : []),
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="bg-bg-card border border-white/10 rounded-2xl p-5 flex gap-4">
            <Icon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: accentColor }} />
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1">{label}</p>
              <p className="text-white text-sm">{value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
