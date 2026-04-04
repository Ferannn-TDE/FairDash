'use client'

import type { FairStatus } from '@/lib/mock'

const CONFIG: Record<FairStatus, { label: string; className: string }> = {
  active:    { label: 'Live Now',   className: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' },
  upcoming:  { label: 'Upcoming',   className: 'bg-sky-500/15 text-sky-400 border border-sky-500/30' },
  draft:     { label: 'Draft',      className: 'bg-white/5 text-text-gray border border-white/10' },
  completed: { label: 'Ended',      className: 'bg-white/5 text-text-gray border border-white/10' },
  archived:  { label: 'Archived',   className: 'bg-white/5 text-text-gray border border-white/10' },
}

interface StatusBadgeProps {
  status: FairStatus
  className?: string
}

export default function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const { label, className: base } = CONFIG[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.6875rem] font-semibold uppercase tracking-wide ${base} ${className}`}>
      {status === 'active' && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      )}
      {label}
    </span>
  )
}
