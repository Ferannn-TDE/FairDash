'use client'

import { useState } from 'react'
import { ShieldAlert, ShieldCheck, X } from 'lucide-react'
import { formatAuditTimestamp } from '@/lib/audit-time'

export interface OrganizerState {
  id: string
  name: string
  suspended: boolean
  suspendedAt: string | null
  suspendedReason: string | null
}

// The A6 kill-switch UI — the ONE mutating admin control. It calls ONLY the
// admin-gated PATCH /api/admin/organizers/[id]/suspend (proven organizer-
// unreachable, self-rescue impossible). No new security surface — a button wired
// to an already-secured action, showing current suspension state.
export default function OrganizerControl({ organizer }: { organizer: OrganizerState }) {
  const [state, setState] = useState(organizer)
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(suspend: boolean) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/organizers/${state.id}/suspend`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspend, reason: suspend ? reason.trim() || null : null }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error?.message ?? 'Failed to update'); return }
      const o = json.data.organizer
      setState({
        id: o.id, name: o.name,
        suspended: !!o.suspendedAt,
        suspendedAt: o.suspendedAt,
        suspendedReason: o.suspendedReason,
      })
      setConfirming(false)
      setReason('')
    } catch {
      setError('Failed to update')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`rounded-2xl border p-5 ${state.suspended ? 'bg-red-500/[0.06] border-red-500/20' : 'bg-bg-card border-white/10'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1">Organizer</p>
          <p className="text-white font-semibold text-sm truncate">{state.name}</p>
          {state.suspended ? (
            <div className="mt-2 flex items-start gap-1.5 text-red-400">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="text-xs">
                <span className="font-semibold">Suspended</span>
                {state.suspendedAt && (
                  <span className="text-red-400/70"> · {formatAuditTimestamp(state.suspendedAt)}</span>
                )}
                {state.suspendedReason && <p className="text-red-400/70 mt-0.5">{state.suspendedReason}</p>}
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-1.5 text-emerald-400 text-xs">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span className="font-semibold">Active</span>
            </div>
          )}
        </div>

        {!confirming && (
          state.suspended ? (
            <button
              onClick={() => submit(false)}
              disabled={busy}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Un-suspend'}
            </button>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              Suspend
            </button>
          )
        )}
      </div>

      {/* Suspend confirm — org-wide, immediate. Reason is optional but recorded. */}
      {confirming && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold">
              Suspend this organizer (org-wide, takes effect immediately)
            </p>
            <button onClick={() => { setConfirming(false); setReason('') }} className="text-text-gray hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            placeholder="Reason (optional — shown to no one but recorded for audit)"
            className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-red-500/50 transition-colors resize-none placeholder:text-[#444]"
          />
          <button
            onClick={() => submit(true)}
            disabled={busy}
            className="mt-2 w-full py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
          >
            {busy ? 'Suspending…' : 'Confirm suspension'}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  )
}
