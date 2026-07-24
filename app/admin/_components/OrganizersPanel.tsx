'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Clock, CheckCircle, XCircle, ShieldAlert, ShieldCheck, Ban,
  Store, CreditCard, AlertTriangle, X,
} from 'lucide-react'
import {
  organizerRowView,
  type OrganizerApproval,
} from '@/lib/organizer-admin-view'
import { formatAuditTimestamp, formatAuditDate } from '@/lib/audit-time'

/**
 * The admin Organizers panel — the surface for two capabilities that were built and proven
 * but, until now, API-only:
 *
 *   • the #7 APPROVAL gate  (PENDING / APPROVED / REJECTED)   — "may you operate at all?"
 *   • the A6 KILL-SWITCH    (ACTIVE / SUSPENDED)              — "we approved you, then stopped you"
 *
 * NO NEW LOGIC AND NO NEW SECURITY SURFACE. Every button here calls an admin-gated route that
 * already exists and is already proven (requireStrictAdminAuth on all three). This component
 * is the machinery becoming visible, not new machinery.
 *
 * THE TWO STATES ARE RENDERED AS TWO SEPARATE BADGES, never merged. An organizer who was never
 * admitted is NOT "suspended" — nobody stopped them, we never let them in. The affordances
 * follow from that (lib/organizer-admin-view): you cannot suspend an organizer who was never
 * approved, and you cannot un-suspend one who has no approval to be restored to.
 *
 * NO SECOND SOURCE OF TRUTH: after any action we RE-READ the list from the DB rather than
 * patching local state, so what you see is always what the database says — the same discipline
 * as the money panel.
 */

interface Fair {
  id: string
  name: string
  urlSlug: string
  status: string
  archived: boolean
}

interface Organizer {
  id: string
  name: string
  contactEmail: string
  contactPhone: string | null
  website: string | null
  appliedAt: string
  approvalStatus: OrganizerApproval
  approvedAt: string | null
  approvedBy: string | null
  rejectionReason: string | null
  suspendedAt: string | null
  suspendedReason: string | null
  stripeConnected: boolean
  stripeVerified: boolean
  stripeConnectedAt: string | null
  fairs: Fair[]
  fairCount: number
}

/** Approval axis — "may you operate at all?" */
const APPROVAL_BADGE: Record<OrganizerApproval, { label: string; cls: string; Icon: React.ElementType }> = {
  PENDING:  { label: 'Pending review', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/25',       Icon: Clock },
  APPROVED: { label: 'Approved',       cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25', Icon: CheckCircle },
  REJECTED: { label: 'Rejected',       cls: 'bg-white/5 text-[#888] border-white/10',                   Icon: XCircle },
}

/** Operating axis — deliberately DIFFERENT shapes/colours so it can never be misread as the
 *  approval badge. "Never admitted" is its own thing: not suspended, not active. */
const OPERATING_BADGE = {
  ACTIVE:       { label: 'Operating',     cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25', Icon: ShieldCheck },
  SUSPENDED:    { label: 'SUSPENDED',     cls: 'bg-red-500/15 text-red-400 border-red-500/40',             Icon: ShieldAlert },
  NOT_ADMITTED: { label: 'Never admitted', cls: 'bg-white/5 text-[#666] border-white/10 border-dashed',    Icon: Ban },
} as const

function fmt(d: string | null) {
  return formatAuditDate(d)
}

function Badge({ label, cls, Icon }: { label: string; cls: string; Icon: React.ElementType }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-inter font-semibold ${cls}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {label}
    </span>
  )
}

export default function OrganizersPanel() {
  const [organizers, setOrganizers] = useState<Organizer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Honest per-row action state — "approving…" / failed, never a fake success.
  const [busy, setBusy] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})
  // The open confirm form, if any: which row, and which action.
  const [confirming, setConfirming] = useState<{ id: string; action: 'reject' | 'suspend' } | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/admin/organizers')
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        setError(json.error?.message ?? 'Failed to load organizers')
        return
      }
      setOrganizers((json.data.organizers ?? []) as Organizer[])
    } catch {
      setError('Failed to load organizers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /**
   * Every action re-reads the list on success — we never patch local state from the response.
   * The DB is the only source of truth for what these badges say.
   *
   * NOTE THE METHODS — they are the routes' real contracts, not a guess:
   *   approve / reject → POST   (app/api/admin/organizers/[id]/{approve,reject})
   *   suspend          → PATCH  (the A6 kill-switch write)
   * (The shared ApprovalQueue component PATCHes its approve/reject endpoints, which is the
   *  runner routes' contract — reusing it verbatim here would 405 against these POST routes.)
   */
  async function act(id: string, action: 'approve' | 'reject' | 'suspend' | 'unsuspend', why?: string) {
    setBusy(id)
    setRowError(prev => { const next = { ...prev }; delete next[id]; return next })
    try {
      const req: { url: string; method: string; body?: string } =
        action === 'approve'  ? { url: `/api/admin/organizers/${id}/approve`, method: 'POST' }
      : action === 'reject'   ? { url: `/api/admin/organizers/${id}/reject`,  method: 'POST',  body: JSON.stringify({ reason: why }) }
      : action === 'suspend'  ? { url: `/api/admin/organizers/${id}/suspend`, method: 'PATCH', body: JSON.stringify({ suspend: true, reason: why ?? null }) }
      :                         { url: `/api/admin/organizers/${id}/suspend`, method: 'PATCH', body: JSON.stringify({ suspend: false }) }

      const res = await fetch(req.url, {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
        body: req.body,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        setRowError(prev => ({ ...prev, [id]: json.error?.message ?? `Could not ${action}` }))
        return // ← failure stays visible; no optimistic flip to a state the DB never reached
      }
      setConfirming(null)
      setReason('')
      await load() // re-read, don't patch
    } catch {
      setRowError(prev => ({ ...prev, [id]: 'Network error' }))
    } finally {
      setBusy(null)
    }
  }

  const pendingCount = organizers.filter(o => o.approvalStatus === 'PENDING').length
  const suspendedCount = organizers.filter(o => o.suspendedAt).length

  if (loading) {
    return <p className="text-sm text-[#666] font-inter">Loading organizers…</p>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-bebas text-3xl text-white tracking-wide">Organizers</h1>
        <p className="text-sm text-[#666] font-inter mt-1">
          {organizers.length} organizer{organizers.length === 1 ? '' : 's'}
          {pendingCount > 0 && <span className="text-amber-400"> · {pendingCount} awaiting review</span>}
          {suspendedCount > 0 && <span className="text-red-400"> · {suspendedCount} suspended</span>}
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-400 font-inter">{error}</p>
        </div>
      )}

      {organizers.length === 0 && !error && (
        <p className="rounded-xl border border-white/10 bg-[#111111] px-4 py-10 text-center text-sm text-[#555] font-inter">
          No organizers yet.
        </p>
      )}

      <div className="space-y-3">
        {organizers.map(o => {
          const view = organizerRowView(o)
          const approval = APPROVAL_BADGE[view.approval]
          const operating = OPERATING_BADGE[view.operating]
          const isBusy = busy === o.id
          const confirm = confirming?.id === o.id ? confirming.action : null

          return (
            <div
              key={o.id}
              className={`rounded-2xl border bg-[#111111] p-5 transition-colors ${
                view.operating === 'SUSPENDED' ? 'border-red-500/30 bg-red-500/[0.04]'
                : view.approval === 'PENDING'  ? 'border-amber-500/25'
                : 'border-white/10'
              }`}
            >
              {/* ── identity + the TWO badges (never merged) ─────────────────────────── */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-white font-inter font-semibold truncate">{o.name}</p>
                  <p className="text-xs text-[#666] font-inter truncate">
                    {o.contactEmail}
                    {o.contactPhone && <span> · {o.contactPhone}</span>}
                  </p>
                  <p className="text-xs text-[#555] font-inter mt-1">Applied {fmt(o.appliedAt)}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Badge {...approval} />
                  <Badge {...operating} />
                </div>
              </div>

              {/* ── decision-relevant detail ──────────────────────────────────────────── */}
              <div className="mt-4 grid gap-3 sm:grid-cols-3 text-xs font-inter">
                <div className="flex items-center gap-2 text-[#888]">
                  <CreditCard className="w-3.5 h-3.5 shrink-0" />
                  {o.stripeVerified ? (
                    <span className="text-emerald-400">Stripe connected &amp; verified</span>
                  ) : o.stripeConnected ? (
                    <span className="text-amber-400">Stripe connected — unverified</span>
                  ) : (
                    <span className="text-[#666]">No Stripe account — cannot be paid out</span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[#888] sm:col-span-2">
                  <Store className="w-3.5 h-3.5 shrink-0" />
                  {o.fairCount === 0 ? (
                    // Option A's payoff, made VISIBLE: a never-approved organizer cannot have
                    // accumulated a fair, because fair creation is itself gated. Nothing orphaned.
                    <span className="text-[#666]">
                      0 fairs
                      {view.approval !== 'APPROVED' && ' — fair creation is gated, so there is nothing to orphan'}
                    </span>
                  ) : (
                    <span className="truncate">
                      {o.fairCount} fair{o.fairCount === 1 ? '' : 's'}:{' '}
                      <span className="text-[#aaa]">
                        {o.fairs.map(f => f.name + (f.archived ? ' (archived)' : '')).join(', ')}
                      </span>
                    </span>
                  )}
                </div>
              </div>

              {/* ── why they were rejected — the SAME text the gate shows the organizer ── */}
              {view.approval === 'REJECTED' && o.rejectionReason && (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                  <p className="text-[0.6875rem] uppercase tracking-wide text-[#666] font-semibold">
                    Rejection reason (shown to the organizer)
                  </p>
                  <p className="text-xs text-[#aaa] font-inter mt-0.5">{o.rejectionReason}</p>
                </div>
              )}

              {/* ── why they were suspended — a DIFFERENT fact, styled differently ────── */}
              {view.operating === 'SUSPENDED' && (
                <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3 py-2">
                  <p className="text-[0.6875rem] uppercase tracking-wide text-red-400/80 font-semibold">
                    Suspended {o.suspendedAt && `· ${formatAuditTimestamp(o.suspendedAt)}`}
                  </p>
                  <p className="text-xs text-red-400/80 font-inter mt-0.5">
                    {o.suspendedReason || 'No reason recorded.'} — approved, then stopped. Every organizer
                    request is refused until this is lifted.
                  </p>
                </div>
              )}

              {rowError[o.id] && (
                <p className="mt-3 text-xs text-red-400 font-inter">⚠ {rowError[o.id]}</p>
              )}

              {/* ── actions — all surfacing already-proven admin routes ───────────────── */}
              {!confirm && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {view.canApprove && (
                    <button
                      onClick={() => act(o.id, 'approve')}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/25 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      {isBusy ? 'Approving…' : view.approval === 'REJECTED' ? 'Approve anyway' : 'Approve'}
                    </button>
                  )}

                  {view.canReject && (
                    <button
                      onClick={() => { setConfirming({ id: o.id, action: 'reject' }); setReason('') }}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-xs font-semibold hover:bg-red-500/25 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </button>
                  )}

                  {/* The A6 kill-switch. Offered ONLY for an admitted, un-suspended organizer —
                      you cannot "stop" someone who was never let in. */}
                  {view.canSuspend && (
                    <button
                      onClick={() => { setConfirming({ id: o.id, action: 'suspend' }); setReason('') }}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/20 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" /> Suspend
                    </button>
                  )}

                  {view.canUnsuspend && (
                    <button
                      onClick={() => act(o.id, 'unsuspend')}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      {isBusy ? 'Restoring…' : 'Un-suspend'}
                    </button>
                  )}
                </div>
              )}

              {/* ── confirm forms. REJECT REQUIRES A REASON — the API refuses a blank one
                     (400), and that reason is what the gate shows the rejected organizer, so
                     the confirm button stays disabled until one is written. ─────────────── */}
              {confirm && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold">
                      {confirm === 'reject'
                        ? 'Reject this application — the reason is shown to the organizer'
                        : 'Suspend this organizer (org-wide, takes effect on their next request)'}
                    </p>
                    <button
                      onClick={() => { setConfirming(null); setReason('') }}
                      className="text-text-gray hover:text-white cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    rows={2}
                    placeholder={confirm === 'reject'
                      ? 'Required — why is this application declined? (the organizer sees this)'
                      : 'Reason (optional — recorded for audit)'}
                    className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-red-500/50 transition-colors resize-none placeholder:text-[#444]"
                  />

                  <button
                    onClick={() => act(o.id, confirm, reason.trim() || undefined)}
                    // A rejection without a reason is unauditable — the API rejects it, so the
                    // UI must not pretend otherwise.
                    disabled={isBusy || (confirm === 'reject' && !reason.trim())}
                    className="mt-2 w-full py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isBusy
                      ? (confirm === 'reject' ? 'Rejecting…' : 'Suspending…')
                      : confirm === 'reject'
                        ? (reason.trim() ? 'Confirm rejection' : 'A reason is required')
                        : 'Confirm suspension'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
