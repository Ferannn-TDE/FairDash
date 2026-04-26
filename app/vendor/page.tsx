'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MapPin, Calendar, ChevronRight, Users, Clock, XCircle, CalendarX } from 'lucide-react'

// ─── Mock state ───────────────────────────────────────────────────────────────
// Swap flags to test each branch. In production, derive from API/session.

const mockVendorState = {
  hasCompletedOnboarding: true,
  applicationStatus: 'approved' as 'pending' | 'rejected' | 'approved',
}

const mockAvailableFairs = [
  {
    id: 'fair_001',
    slug: 'springfield-state-fair-2026',
    name: 'Springfield State Fair',
    location: 'Springfield, IL',
    dates: 'June 15–22, 2026',
    status: 'active' as const,
    vendorCount: 12,
    booth: 'B-12',
  },
  {
    id: 'fair_002',
    slug: 'stl-food-festival-2026',
    name: 'STL Street Food Festival',
    location: 'St. Louis, MO',
    dates: 'July 4–6, 2026',
    status: 'upcoming' as const,
    vendorCount: 8,
    booth: 'C-04',
  },
]

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Redirecting() {
  return (
    <div className="min-h-screen bg-bg-dark flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-neon-pink/30 border-t-neon-pink animate-spin" />
    </div>
  )
}

// ─── Status screens ───────────────────────────────────────────────────────────

function ApplicationPending() {
  return (
    <div className="min-h-screen bg-bg-dark flex items-center justify-center p-5">
      <div className="max-w-sm w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-5">
          <Clock className="w-8 h-8 text-amber-400" />
        </div>
        <h1 className="font-bebas text-3xl tracking-wide text-white mb-2">Application Under Review</h1>
        <p className="text-text-gray text-sm leading-relaxed mb-6">
          Your application is being reviewed by our team. You'll hear back within 2–3 business days.
        </p>
        <div className="bg-bg-card border border-white/[0.06] rounded-2xl p-5 mb-6 text-left space-y-3">
          {[
            { label: 'Application submitted',    done: true  },
            { label: 'Under review',              done: true, active: true },
            { label: 'Decision sent via email',   done: false },
            { label: 'Access granted',            done: false },
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${step.done ? 'bg-amber-500/20 border-amber-500/40' : 'border-white/10'}`}>
                {step.done && <div className={`w-2 h-2 rounded-full ${step.active ? 'bg-amber-400 animate-pulse' : 'bg-amber-400'}`} />}
              </div>
              <span className={`text-sm ${step.done ? 'text-white' : 'text-text-gray'}`}>{step.label}</span>
            </div>
          ))}
        </div>
        <Link href="/" className="text-neon-pink text-sm font-semibold hover:underline">← Back to FairSynq</Link>
      </div>
    </div>
  )
}

function ApplicationRejected() {
  return (
    <div className="min-h-screen bg-bg-dark flex items-center justify-center p-5">
      <div className="max-w-sm w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-5">
          <XCircle className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="font-bebas text-3xl tracking-wide text-white mb-2">Application Not Approved</h1>
        <p className="text-text-gray text-sm leading-relaxed mb-6">
          Unfortunately your application wasn't approved at this time. You may have received more details via email.
        </p>
        <div className="flex flex-col gap-3">
          <a href="mailto:support@fairsynq.com" className="px-5 py-3 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors">
            Contact Support
          </a>
          <Link href="/" className="text-text-gray text-sm hover:text-white transition-colors">← Back to FairSynq</Link>
        </div>
      </div>
    </div>
  )
}

// ─── Fair selection ───────────────────────────────────────────────────────────

function FairSelectionPage({ fairs }: { fairs: typeof mockAvailableFairs }) {
  const router = useRouter()
  const activeFairs = fairs.filter(f => f.status === 'active')
  const upcomingFairs = fairs.filter(f => f.status === 'upcoming')

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <div className="border-b border-white/[0.04] px-5 sm:px-8 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link href="/" className="group flex items-center leading-none">
            <span className="font-bebas text-lg tracking-widest text-white group-hover:text-neon-pink transition-colors">FAIR</span>
            <span className="font-bebas text-lg tracking-widest text-neon-pink group-hover:text-white transition-colors">SYNQ</span>
          </Link>
          <span className="text-[0.6875rem] text-text-gray uppercase tracking-wider">Vendor Portal</span>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-10">
        <div className="mb-8">
          <h1 className="font-bebas text-3xl sm:text-4xl text-white uppercase tracking-wide">
            Select Your <span className="text-neon-pink">Fair</span>
          </h1>
          <p className="mt-2 text-sm text-text-gray leading-relaxed">
            Choose the event you're working at to access your vendor dashboard.
          </p>
        </div>

        {/* Active fairs */}
        {activeFairs.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <h2 className="text-[0.6875rem] text-text-gray uppercase tracking-wider font-semibold">Live Now</h2>
            </div>
            <div className="space-y-3">
              {activeFairs.map(fair => (
                <button
                  key={fair.id}
                  onClick={() => router.push(`/vendor/${fair.slug}/dashboard`)}
                  className="w-full bg-bg-card rounded-2xl border border-white/[0.06] p-5 sm:p-6 hover:border-neon-pink/20 hover:shadow-[0_0_25px_rgba(255,0,119,0.06)] active:scale-[0.98] transition-all duration-300 text-left group cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <h3 className="font-bebas text-xl text-white uppercase tracking-wide leading-none">{fair.name}</h3>
                        <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[0.6rem] font-bold rounded-full uppercase tracking-wider shrink-0">Live</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-gray">
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0" />{fair.location}</span>
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3 shrink-0" />{fair.dates}</span>
                        <span className="flex items-center gap-1"><Users className="w-3 h-3 shrink-0" />{fair.vendorCount} vendors</span>
                      </div>
                      <p className="mt-2 text-xs text-text-gray">
                        Your booth: <span className="text-white font-semibold">{fair.booth}</span>
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-text-gray group-hover:text-neon-pink group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming fairs */}
        {upcomingFairs.length > 0 && (
          <div>
            <h2 className="text-[0.6875rem] text-text-gray uppercase tracking-wider font-semibold mb-4">Upcoming</h2>
            <div className="space-y-3">
              {upcomingFairs.map(fair => (
                <div
                  key={fair.id}
                  className="bg-bg-card rounded-2xl border border-white/[0.04] p-5 sm:p-6 opacity-50"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <h3 className="font-bebas text-xl text-white uppercase tracking-wide leading-none">{fair.name}</h3>
                        <span className="px-2 py-0.5 bg-neon-pink/10 text-neon-pink text-[0.6rem] font-bold rounded-full uppercase tracking-wider shrink-0">Upcoming</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-gray">
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0" />{fair.location}</span>
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3 shrink-0" />{fair.dates}</span>
                      </div>
                      <p className="mt-2 text-xs text-text-gray">
                        Your booth: <span className="text-white font-semibold">{fair.booth}</span>
                      </p>
                    </div>
                    <span className="text-xs text-text-gray shrink-0">Not yet live</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No fairs */}
        {fairs.length === 0 && (
          <div className="text-center py-20 bg-bg-card border border-white/[0.04] rounded-2xl">
            <CalendarX className="w-10 h-10 text-text-gray/30 mx-auto mb-4" />
            <h2 className="font-bebas text-xl text-white uppercase mb-2">No Fairs Assigned</h2>
            <p className="text-text-gray text-sm max-w-xs mx-auto">
              You haven't been assigned to any fairs yet. Contact your event organizer to get added.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export default function VendorRootPage() {
  const router = useRouter()
  const { hasCompletedOnboarding, applicationStatus } = mockVendorState

  useEffect(() => {
    if (!hasCompletedOnboarding) {
      router.replace('/vendor/onboarding')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasCompletedOnboarding) return <Redirecting />
  if (applicationStatus === 'pending')  return <ApplicationPending />
  if (applicationStatus === 'rejected') return <ApplicationRejected />

  // approved → always show fair selection (vendor picks each time)
  return <FairSelectionPage fairs={mockAvailableFairs} />
}
