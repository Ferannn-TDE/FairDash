'use client'

import { fairBadgeState } from '@/lib/event-date'

// State token → label. Live-ness is a DERIVED token ('live'/'upcoming'/'ended'), never the raw
// admin status: fairBadgeState turns (status + dates) into the token, so nothing here maps
// `status === 'ACTIVE'` straight to "Live Now" (which said an Aug-5 fair was live on Jul 23).
const CONFIG: Record<string, { label: string; className: string }> = {
  live:      { label: 'Live Now',   className: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' },
  upcoming:  { label: 'Upcoming',   className: 'bg-sky-500/15 text-sky-400 border border-sky-500/30' },
  ended:     { label: 'Ended',      className: 'bg-white/5 text-text-gray border border-white/10' },
  draft:     { label: 'Draft',      className: 'bg-white/5 text-text-gray border border-white/10' },
  completed: { label: 'Ended',      className: 'bg-white/5 text-text-gray border border-white/10' },
  COMPLETED: { label: 'Ended',      className: 'bg-white/5 text-text-gray border border-white/10' },
  archived:  { label: 'Archived',   className: 'bg-white/5 text-text-gray border border-white/10' },
  paused:    { label: 'Paused',     className: 'bg-amber-500/15 text-amber-400 border border-amber-500/30' },
  PAUSED:    { label: 'Paused',     className: 'bg-amber-500/15 text-amber-400 border border-amber-500/30' },
}

const FALLBACK = { label: 'Upcoming', className: 'bg-sky-500/15 text-sky-400 border border-sky-500/30' }

interface StatusBadgeProps {
  status: string
  /** A fair's run. When given, live-ness derives from the dates (before → Upcoming, within →
   *  Live Now, after → Ended). Omit only for non-fair status chips. */
  startDate?: string
  endDate?: string
  className?: string
}

export default function StatusBadge({ status, startDate, endDate, className = '' }: StatusBadgeProps) {
  const state = startDate && endDate ? fairBadgeState(status, startDate, endDate) : status
  const { label, className: base } = CONFIG[state] ?? FALLBACK
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.6875rem] font-semibold uppercase tracking-wide ${base} ${className}`}>
      {state === 'live' && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      )}
      {label}
    </span>
  )
}
