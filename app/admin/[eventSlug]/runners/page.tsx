'use client'

import { useState } from 'react'
import { mockAdminRunners } from '@/lib/mock/admin'

type RunnerStatus = 'ACTIVE' | 'OFFLINE' | 'ON_DELIVERY'

const STATUS_STYLES: Record<RunnerStatus, string> = {
  ACTIVE:      'bg-green-500/15 text-green-400',
  OFFLINE:     'bg-white/5 text-[#888]',
  ON_DELIVERY: 'bg-sky-500/15 text-sky-400',
}

function CompletionBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  const color = pct >= 90 ? 'bg-green-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-inter tabular-nums ${pct >= 90 ? 'text-green-400' : pct >= 75 ? 'text-yellow-400' : 'text-red-400'}`}>
        {pct}%
      </span>
    </div>
  )
}

export default function RunnersPage() {
  const [runners, setRunners] = useState(
    mockAdminRunners.map(r => ({ ...r, status: r.status as RunnerStatus }))
  )

  const toggleStatus = (id: string) => {
    setRunners(rs => rs.map(r => {
      if (r.id !== id) return r
      return { ...r, status: r.status === 'ACTIVE' ? 'OFFLINE' : 'ACTIVE' }
    }))
  }

  const active = runners.filter(r => r.status === 'ACTIVE').length

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">Runners</h1>
          <p className="text-sm text-[#666] font-inter mt-1">
            {active} of {runners.length} runners currently active
          </p>
        </div>
        <button className="w-full sm:w-auto px-4 py-2.5 bg-[#FF0077] text-white text-sm font-semibold rounded-xl hover:bg-[#e0006b] transition-colors">
          + Add Runner
        </button>
      </div>

      {/* Warning for low completion rates */}
      {runners.some(r => r.completionRate < 0.90) && (
        <div className="mb-5 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
          <p className="text-sm text-yellow-300 font-inter">
            <span className="font-semibold">Warning:</span> Some runners are below the 90% completion rate threshold and may need to be reviewed.
          </p>
        </div>
      )}

      <div className="bg-[#111111] rounded-xl border border-white/5 divide-y divide-white/5">
        {runners.map(runner => (
          <div key={runner.id} className="flex items-center justify-between gap-3 p-4 hover:bg-white/[0.02] transition-colors">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-full bg-[#FF0077]/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-semibold text-[#FF0077] font-inter">{runner.initials}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-inter font-medium text-white truncate">{runner.name}</p>
                <p className="text-xs text-[#666] font-inter truncate">{runner.email}</p>
              </div>
            </div>

            {/* Completion rate */}
            <div className="hidden sm:block w-28 shrink-0">
              <p className="text-[10px] text-[#555] font-inter uppercase tracking-wider mb-1">Completion</p>
              <CompletionBar rate={runner.completionRate} />
            </div>

            {/* Dispatch stats */}
            <div className="hidden md:block shrink-0 text-right">
              <p className="text-sm text-white font-inter tabular-nums">
                {runner.totalCompleted}/{runner.totalDispatched}
              </p>
              <p className="text-[10px] text-[#555] font-inter">dispatched</p>
            </div>

            {/* Status badge */}
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase shrink-0 ${STATUS_STYLES[runner.status]}`}>
              {runner.status}
            </span>

            {/* Activate/Deactivate toggle */}
            <button
              onClick={() => toggleStatus(runner.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-inter transition-colors shrink-0
                ${runner.status === 'ACTIVE'
                  ? 'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20'
                  : 'bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20'
                }`}
            >
              {runner.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        ))}

        {runners.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-[#555] font-inter">No runners registered for this event.</p>
          </div>
        )}
      </div>
    </div>
  )
}
