'use client'

import { useState } from 'react'
import { CheckCircle, XCircle, Clock } from 'lucide-react'

// Reusable admin approval queue. Renders a list of PENDING applicants with
// approve / reject actions that PATCH the endpoints the caller supplies. Kept
// entity-agnostic (runner now, organizer #7 next) — the two approval surfaces
// share this exact list -> approve/reject shape and the same ApprovalStatus enum.

export interface ApprovalItem {
  id: string
  /** Primary label, e.g. runner/organizer name. */
  name: string | null
  /** Secondary label, e.g. email. */
  detail?: string | null
}

interface ApprovalQueueProps {
  title: string
  items: ApprovalItem[]
  /** Build the PATCH URL for approving/rejecting item `id`. */
  approveUrl: (id: string) => string
  rejectUrl: (id: string) => string
  /** Called after a successful approve/reject so the parent can refresh. */
  onResolved: () => void
  emptyLabel?: string
}

function initialsOf(name: string | null, detail?: string | null) {
  const src = (name ?? detail ?? '?').trim()
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

export default function ApprovalQueue({
  title, items, approveUrl, rejectUrl, onResolved, emptyLabel = 'Nothing awaiting approval.',
}: ApprovalQueueProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function approve(id: string) {
    setBusy(id); setError(null)
    try {
      const res = await fetch(approveUrl(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' } })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) { setError(json.error?.message ?? 'Could not approve'); return }
      onResolved()
    } catch { setError('Network error') } finally { setBusy(null) }
  }

  async function reject(id: string) {
    const reason = window.prompt('Reason for rejecting this applicant?')?.trim()
    if (!reason) return // required — no reason, no reject
    setBusy(id); setError(null)
    try {
      const res = await fetch(rejectUrl(id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) { setError(json.error?.message ?? 'Could not reject'); return }
      onResolved()
    } catch { setError('Network error') } finally { setBusy(null) }
  }

  return (
    <div className="mb-6 bg-[#111111] border border-yellow-500/20 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <Clock className="w-4 h-4 text-yellow-400" />
        <h2 className="text-sm font-inter font-semibold text-white">{title}</h2>
        <span className="ml-auto text-xs font-inter text-yellow-400 tabular-nums">{items.length}</span>
      </div>

      {error && <p className="px-4 py-2 text-xs text-red-400 font-inter">{error}</p>}

      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-[#555] font-inter">{emptyLabel}</p>
      ) : (
        <div className="divide-y divide-white/5">
          {items.map(item => (
            <div key={item.id} className="flex items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-full bg-yellow-500/10 flex items-center justify-center shrink-0">
                  <span className="text-sm font-semibold text-yellow-400 font-inter">{initialsOf(item.name, item.detail)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-inter font-medium text-white truncate">{item.name ?? '— unnamed —'}</p>
                  <p className="text-xs text-[#666] font-inter truncate">{item.detail ?? ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => approve(item.id)} disabled={busy === item.id}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-xs font-semibold hover:bg-green-500/25 transition-colors disabled:opacity-50 cursor-pointer">
                  <CheckCircle className="w-3.5 h-3.5" /> Approve
                </button>
                <button
                  onClick={() => reject(item.id)} disabled={busy === item.id}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-xs font-semibold hover:bg-red-500/25 transition-colors disabled:opacity-50 cursor-pointer">
                  <XCircle className="w-3.5 h-3.5" /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
