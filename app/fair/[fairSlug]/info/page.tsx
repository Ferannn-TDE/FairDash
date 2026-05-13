'use client'

import { MapPinIcon, ClockIcon, CalendarIcon, EnvelopeIcon, TicketIcon } from '@heroicons/react/24/outline'
import { useFair } from '../../../_contexts/FairContext'
import StatusBadge from '../../../_components/StatusBadge'
import Breadcrumb from '../_components/Breadcrumb'

function formatDate(iso: string | null | undefined) {
  if (!iso) return null
  // Handle both full ISO datetimes and date-only strings (YYYY-MM-DD)
  const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatDateRange(start: string | null | undefined, end: string | null | undefined) {
  const s = formatDate(start)
  if (!s) return 'Dates TBA'
  const e = formatDate(end)
  if (!e || e === s) return s
  return `${s} – ${e}`
}

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${m.toString().padStart(2, '0')} ${period}`
}

function InfoCard({ icon: Icon, label, accentColor, children }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  label: string
  accentColor: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-[#1c1c1c] border border-white/[0.07] rounded-xl p-5 hover:border-white/[0.14] transition-colors flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 shrink-0" style={{ color: accentColor }} />
        <span className="text-white/40 text-[10px] uppercase tracking-[0.15em] font-semibold">{label}</span>
      </div>
      <div className="text-white text-sm leading-relaxed">{children}</div>
    </div>
  )
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
        <p className="text-white/50 leading-relaxed mb-10 max-w-2xl">{fair.description}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Address */}
        <InfoCard icon={MapPinIcon} label="Address" accentColor={accentColor}>
          {fair.location.address ||
            (fair.location.city || fair.location.state
              ? `${fair.location.city}${fair.location.state ? `, ${fair.location.state}` : ''}`
              : 'Location TBA')}
        </InfoCard>

        {/* Dates */}
        <InfoCard icon={CalendarIcon} label="Dates" accentColor={accentColor}>
          {formatDateRange(fair.dates.startDate, fair.dates.endDate)}
        </InfoCard>

        {/* Admission */}
        <InfoCard icon={TicketIcon} label="Admission" accentColor={accentColor}>
          {fair.admission
            ? (fair.admission.required ? fair.admission.pricing : 'Free — no ticket required')
            : (fair.admissionFree ? 'Free — no ticket required' : 'Paid admission required')}
        </InfoCard>

        {/* Contact */}
        {(fair.contact || fair.contactEmail || fair.website) && (
          <InfoCard icon={EnvelopeIcon} label="Contact" accentColor={accentColor}>
            <div className="space-y-1">
              {(fair.contact?.email ?? fair.contactEmail) && (
                <p>{fair.contact?.email ?? fair.contactEmail}</p>
              )}
              {fair.contact?.phone && <p>{fair.contact.phone}</p>}
              {(fair.contact?.website ?? fair.website) && (
                <p style={{ color: accentColor }}>{fair.contact?.website ?? fair.website}</p>
              )}
            </div>
          </InfoCard>
        )}
      </div>

      {/* Hours — full width below the grid */}
      {fair.hours && fair.hours.length > 0 ? (
        <div className="mt-4">
          <InfoCard icon={ClockIcon} label="Hours" accentColor={accentColor}>
            <div className="flex flex-wrap gap-6 mt-1">
              {fair.hours.map(h => (
                <div key={h.day} className="flex flex-col gap-0.5 min-w-[100px]">
                  <span className="text-white/40 text-xs uppercase tracking-wide">{h.day}</span>
                  <span className="text-white text-sm">{formatTime(h.open)} – {formatTime(h.close)}</span>
                </div>
              ))}
            </div>
          </InfoCard>
        </div>
      ) : (fair.operatingHours.open && (
        <div className="mt-4">
          <InfoCard icon={ClockIcon} label="Hours" accentColor={accentColor}>
            Opens {fair.operatingHours.open} · Closes {fair.operatingHours.close}
          </InfoCard>
        </div>
      ))}
    </div>
  )
}
