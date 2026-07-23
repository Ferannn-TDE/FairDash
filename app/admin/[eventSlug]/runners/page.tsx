'use client'

import { useState, useEffect, use, useCallback } from 'react'
import { Truck, AlertTriangle } from 'lucide-react'
import ApprovalQueue, { type ApprovalItem } from '../../_components/ApprovalQueue'

type RunnerStatus = 'ACTIVE' | 'OFFLINE' | 'ON_DELIVERY'
type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

interface AdminRunner {
  id: string
  status: RunnerStatus
  approvalStatus: ApprovalStatus
  rejectionReason: string | null
  // Custody-derived, this event only (lib/runner-completion via the route) — never the dead
  // Runner counter columns (deprecated in schema.prisma). `scored` is the route's one copy of
  // the minimum-denominator predicate: false → render the raw counts with "not enough
  // deliveries", no percentage, no bar, and the runner never enters the <90% banner.
  completionRate: number
  collected: number
  delivered: number
  scored: boolean
  user: { name: string | null; email: string | null }
}

const STATUS_STYLES: Record<RunnerStatus, string> = {
  ACTIVE:      'bg-green-500/15 text-green-400',
  OFFLINE:     'bg-white/5 text-[#888]',
  ON_DELIVERY: 'bg-sky-500/15 text-sky-400',
}

const DOT_STYLES: Record<RunnerStatus, string> = {
  ACTIVE:      'bg-green-400',
  OFFLINE:     'bg-[#666]',
  ON_DELIVERY: 'bg-sky-400',
}

function initialsOf(name: string | null, email: string | null) {
  const src = (name ?? email ?? '?').trim()
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
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

export default function RunnersPage({ params: paramsPromise }: { params: Promise<{ eventSlug: string }> }) {
  const params = use(paramsPromise)
  const [runners, setRunners] = useState<AdminRunner[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetch(`/api/admin/events/${params.eventSlug}/runners?take=200`)
      .then(r => r.json())
      .then(json => {
        if (!active) return
        if (!json.success) { setError(json.error?.message ?? 'Failed to load runners'); return }
        setRunners((json.data.runners ?? []) as AdminRunner[])
      })
      .catch(() => { if (active) setError('Failed to load runners') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [params.eventSlug])

  useEffect(() => load(), [load])

  const pending = runners.filter(r => r.approvalStatus === 'PENDING')
  const pendingItems: ApprovalItem[] = pending.map(r => ({ id: r.id, name: r.user.name, detail: r.user.email }))
  const activeCount = runners.filter(r => r.status === 'ACTIVE').length

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">Runners</h1>
          <p className="text-sm text-[#666] font-inter mt-1">
            {loading ? 'Loading…' : `${activeCount} of ${runners.length} runners currently active`}
          </p>
        </div>
      </div>

      {/* Pending-approval queue — a runner cannot go online or claim until approved */}
      {!loading && (
        <ApprovalQueue
          title="Runners awaiting approval"
          items={pendingItems}
          approveUrl={id => `/api/admin/runners/${id}/approve`}
          rejectUrl={id => `/api/admin/runners/${id}/reject`}
          onResolved={load}
          emptyLabel="No runners awaiting approval."
        />
      )}

      {/* Warning for low completion rates — SCORED runners only (at or above the
          minimum-denominator floor). An unscored runner's rate is noise over a tiny
          sample and never fires the banner. */}
      {!loading && runners.some(r => r.scored && r.completionRate < 0.90) && (
        <div className="mb-5 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
          <p className="text-sm text-yellow-300 font-inter">
            <span className="font-semibold">Warning:</span> Some runners are below the 90% completion rate threshold and may need to be reviewed.
          </p>
        </div>
      )}

      {error ? (
        <div className="bg-[#111111] border border-red-500/20 rounded-xl py-12 text-center">
          <AlertTriangle className="w-8 h-8 text-red-400/40 mx-auto mb-2" />
          <p className="text-white font-semibold text-sm mb-1">Couldn’t load runners</p>
          <p className="text-[#666] text-xs">{error}</p>
        </div>
      ) : loading ? (
        <div className="bg-[#111111] border border-white/5 rounded-xl py-12 text-center">
          <Truck className="w-8 h-8 text-white/10 mx-auto mb-2 animate-pulse" />
          <p className="text-[#666] text-xs">Loading runners…</p>
        </div>
      ) : (
        <div className="bg-[#111111] rounded-xl border border-white/5 divide-y divide-white/5">
          {runners.map(runner => {
            // A PENDING runner already has a row in the approval queue above; this roster row
            // is the same person, subordinated so the screen doesn't read as two runners
            // waiting. It stays present (the roster is the roster) but recedes.
            const awaitingApproval = runner.approvalStatus === 'PENDING'
            // Genuinely-null User.name (Clerk test accounts) — the route DOES select name, so
            // this is absence, not a missing field. The email becomes the identity line and the
            // placeholder says what it is, rather than dressing an em-dash up as a name.
            const hasName = Boolean(runner.user.name)
            return (
            <div
              key={runner.id}
              className={`flex items-center gap-4 p-4 transition-colors ${awaitingApproval ? 'bg-white/[0.015] hover:bg-white/[0.03]' : 'hover:bg-white/[0.02]'}`}
            >
              {/* ── Identity ───────────────────────────────────────────────── */}
              <div className={`flex items-center gap-3 min-w-0 flex-1 ${awaitingApproval ? 'opacity-70' : ''}`}>
                <div className="w-9 h-9 rounded-full bg-[#FF0077]/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-[#FF0077] font-inter">{initialsOf(runner.user.name, runner.user.email)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  {hasName ? (
                    <>
                      <p className="text-sm font-inter font-medium text-white truncate">{runner.user.name}</p>
                      <p className="text-xs text-[#666] font-inter truncate">{runner.user.email ?? ''}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-inter font-medium text-white truncate">{runner.user.email ?? 'Unknown runner'}</p>
                      <p className="text-xs text-[#555] font-inter italic truncate">no name on file</p>
                    </>
                  )}
                </div>
              </div>

              {/* ── One stats block: the count is primary (it is always true), the rate
                     secondary (it exists only above the denominator floor) ─────────── */}
              <div className="hidden sm:block w-32 shrink-0">
                <p className="text-sm text-white font-inter tabular-nums leading-none">
                  {runner.delivered}<span className="text-[#555]">/</span>{runner.collected}
                  <span className="ml-1.5 text-[10px] text-[#555] font-normal">delivered</span>
                </p>
                <div className="mt-1.5">
                  {runner.scored
                    ? <CompletionBar rate={runner.completionRate} />
                    : <p className="text-[10px] text-[#555] font-inter">not enough deliveries</p>}
                </div>
              </div>

              {/* ── Status, last and distinct: a filled dot + label, so it reads as state
                     rather than another metric ───────────────────────────────────────── */}
              <div className="flex items-center gap-2 shrink-0 w-28 justify-end">
                {runner.approvalStatus !== 'APPROVED' && (
                  <span
                    title={runner.rejectionReason ?? undefined}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide ${runner.approvalStatus === 'REJECTED' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/10 text-yellow-500/80'}`}>
                    {runner.approvalStatus}
                  </span>
                )}
                <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[runner.status]}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${DOT_STYLES[runner.status]}`} />
                  {runner.status.replace('_', ' ')}
                </span>
              </div>
            </div>
            )
          })}

          {runners.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm text-[#555] font-inter">No runners registered for this event.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
