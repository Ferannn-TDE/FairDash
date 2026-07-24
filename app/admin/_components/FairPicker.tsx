'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Calendar, Store, ChevronRight, AlertTriangle, Users } from 'lucide-react'
import { formatEventDateRange } from '@/lib/event-date'

interface Fair {
  id: string
  name: string
  urlSlug: string
  status: 'ACTIVE' | 'UPCOMING' | 'INACTIVE'
  isPaused: boolean
  startDate: string
  endDate: string
  organizerName: string | null
  organizerSuspended: boolean
  vendorCount: number
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  ACTIVE:   { label: 'Live',     cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  UPCOMING: { label: 'Upcoming', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  INACTIVE: { label: 'Ended',    cls: 'bg-white/5 text-text-gray border-white/10' },
}



export default function FairPicker() {
  const [fairs, setFairs] = useState<Fair[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/admin/fairs')
      .then(r => r.json())
      .then(json => {
        if (!active) return
        if (!json.success) { setError(json.error?.message ?? 'Failed to load fairs'); return }
        setFairs((json.data.fairs ?? []) as Fair[])
      })
      .catch(() => { if (active) setError('Failed to load fairs') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return (
    <div className="p-6 md:p-4 sm:p-3 max-w-[64rem] mx-auto pt-20">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight">
            All <span className="text-neon-pink">Fairs</span>
          </h1>
          <p className="text-text-gray text-sm mt-0.5">
            {loading ? 'Loading…' : `${fairs.length} fair${fairs.length === 1 ? '' : 's'} across all organizers — pick one to manage`}
          </p>
        </div>
        {/* Organizers are PLATFORM-level (one organizer, many fairs), so their panel is a
            sibling of the fair list — not something you reach by picking a fair. */}
        <Link
          href="/admin/organizers"
          className="inline-flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-semibold hover:bg-white/10 transition-colors"
        >
          <Users className="w-3.5 h-3.5" /> Organizers
          <ChevronRight className="w-3.5 h-3.5 text-text-gray" />
        </Link>
      </div>

      {error ? (
        <div className="bg-bg-card border border-red-500/20 rounded-2xl py-16 text-center">
          <AlertTriangle className="w-10 h-10 text-red-400/40 mx-auto mb-3" />
          <p className="text-white font-semibold text-sm mb-1">Couldn’t load fairs</p>
          <p className="text-text-gray text-xs">{error}</p>
        </div>
      ) : loading ? (
        <div className="bg-bg-card border border-white/10 rounded-2xl py-16 text-center">
          <Calendar className="w-10 h-10 text-white/10 mx-auto mb-3 animate-pulse" />
          <p className="text-text-gray text-xs">Loading fairs…</p>
        </div>
      ) : fairs.length === 0 ? (
        <div className="bg-bg-card border border-white/10 rounded-2xl py-16 text-center">
          <Calendar className="w-10 h-10 text-white/10 mx-auto mb-3" />
          <p className="text-white font-semibold text-sm mb-1">No fairs yet</p>
          <p className="text-text-gray text-xs">No events have been created across any organizer.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2">
          {fairs.map(f => {
            const meta = STATUS_META[f.status] ?? STATUS_META.INACTIVE
            return (
              <Link
                key={f.id}
                href={`/admin/${f.urlSlug}/dashboard`}
                className="group bg-bg-card border border-white/10 rounded-2xl p-5 transition-all duration-300 hover:border-neon-pink/40 hover:shadow-glow flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-white font-semibold text-base truncate">{f.name}</h2>
                    <p className="text-text-gray text-xs mt-0.5 truncate">
                      {f.organizerName ?? 'No organizer'}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-text-gray shrink-0 group-hover:text-neon-pink transition-colors" />
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[0.6875rem] font-semibold border ${meta.cls}`}>
                    {meta.label}
                  </span>
                  {f.isPaused && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[0.6875rem] font-semibold border bg-orange-500/10 text-orange-400 border-orange-500/20">
                      Paused
                    </span>
                  )}
                  {f.organizerSuspended && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[0.6875rem] font-semibold border bg-red-500/10 text-red-400 border-red-500/20">
                      <AlertTriangle className="w-3 h-3" /> Organizer suspended
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs text-text-gray mt-auto pt-1">
                  <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {formatEventDateRange(f.startDate, f.endDate)}</span>
                  <span className="flex items-center gap-1"><Store className="w-3.5 h-3.5" /> {f.vendorCount} vendor{f.vendorCount === 1 ? '' : 's'}</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
