'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, CreditCard, Store, XCircle, Clock, EyeOff } from 'lucide-react'
import ApprovalQueue, { type ApprovalItem } from './ApprovalQueue'
import { formatAuditTimestamp } from '@/lib/audit-time'

/**
 * The admin Vendor Operators panel — the surface for OPERATOR admittance.
 *
 * THE ONE IDEA THIS PANEL EXISTS TO MAKE VISIBLE: a booth and the human who works it are two
 * different things with two different permissions, and they disagree constantly.
 *
 *   operator (VendorMember.approvalStatus) — may this HUMAN work this booth
 *   booth    (Vendor.status)               — may this STALL trade
 *
 * So every row renders BOTH, never merged, and spells out the CONSEQUENCE of the pair rather than
 * leaving an admin to infer it from two badges. An approved operator on a pending booth still
 * cannot sell anything; a pending operator on an active booth is the gap this whole axis was
 * built to close. Those are the rows worth looking at, and the row says so in words.
 * (Same discipline as the Organizers panel's approval/suspension split — two facts, two badges.)
 *
 * NOT ENFORCED YET, AND THE PANEL SAYS SO. Nothing reads approvalStatus at this point: the portal
 * door still admits anyone with a membership row. Rejecting someone here moves the column and
 * changes nothing else. That is deliberate — it lets the decision be rehearsed before it has
 * teeth — but a panel that implied otherwise would be lying, so the banner states it plainly and
 * comes out with the commit that adds the gate.
 *
 * NO SECOND SOURCE OF TRUTH: after any action the list is RE-READ from the database rather than
 * patched locally, so what you see is what the database says.
 */

type Approval = 'PENDING' | 'APPROVED' | 'REJECTED'

interface Operator {
  id: string
  role: string
  joinedAt: string
  approvalStatus: Approval
  approvedAt: string | null
  approvedBy: string | null
  rejectionReason: string | null
  operator: { id: string; name: string | null; email: string | null }
  booth: { id: string; name: string; slug: string; status: string; stripeVerified: boolean }
  fair: { id: string; name: string; slug: string } | null
}

const OPERATOR_BADGE: Record<Approval, { label: string; cls: string }> = {
  APPROVED: { label: 'Operator approved', cls: 'bg-emerald-500/15 text-emerald-400' },
  PENDING:  { label: 'Operator pending',  cls: 'bg-amber-500/15 text-amber-400' },
  REJECTED: { label: 'Operator rejected', cls: 'bg-red-500/15 text-red-400' },
}

function boothBadge(status: string): { label: string; cls: string } {
  if (status === 'ACTIVE') return { label: 'Booth active', cls: 'bg-emerald-500/15 text-emerald-400' }
  if (status === 'PENDING') return { label: 'Booth pending', cls: 'bg-amber-500/15 text-amber-400' }
  return { label: `Booth ${status.toLowerCase()}`, cls: 'bg-red-500/15 text-red-400' }
}

/**
 * The two axes read together. This is the sentence an admin actually needs — not "PENDING" twice
 * in different colours, but what the combination means for whether food can be sold today.
 */
function consequenceOf(op: Operator): { text: string; tone: 'ok' | 'warn' | 'stop' } {
  const boothTrades = op.booth.status === 'ACTIVE'
  if (op.approvalStatus === 'APPROVED' && boothTrades) {
    return { text: 'Admitted, and the booth can trade.', tone: 'ok' }
  }
  if (op.approvalStatus === 'APPROVED' && !boothTrades) {
    return { text: 'Admitted — but the booth is not approved to trade, so no orders can be placed.', tone: 'warn' }
  }
  if (op.approvalStatus === 'PENDING' && boothTrades) {
    return { text: 'Not yet admitted, on a booth that is trading. This is the gap operator admittance closes.', tone: 'warn' }
  }
  if (op.approvalStatus === 'REJECTED' && boothTrades) {
    return { text: 'Refused, on a booth that is still trading. The booth stays open — refuse the booth separately if that is what you meant.', tone: 'stop' }
  }
  return { text: 'Not admitted, and the booth cannot trade either.', tone: 'stop' }
}

const TONE: Record<'ok' | 'warn' | 'stop', string> = {
  ok:   'text-[#888]',
  warn: 'text-amber-400/90',
  stop: 'text-red-400/80',
}

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide font-inter ${cls}`}>
      {label}
    </span>
  )
}

export default function VendorOperatorsPanel() {
  const [operators, setOperators] = useState<Operator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/admin/vendor-members')
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) { setError(json.error?.message ?? 'Could not load operators'); return }
      setOperators(json.data.vendorMembers ?? [])
    } catch {
      setError('Network error — could not load operators')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const pending = operators.filter(o => o.approvalStatus === 'PENDING')
  const pendingItems: ApprovalItem[] = pending.map(o => ({
    id: o.id,
    name: o.operator.name ?? o.operator.email,
    detail: [o.booth.name, o.fair?.name].filter(Boolean).join(' · '),
  }))

  if (loading) return <p className="text-sm text-[#666] font-inter">Loading operators…</p>

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-bebas text-3xl text-white tracking-wide">Vendor operators</h1>
        <p className="text-sm text-[#666] font-inter mt-1">
          The people who work the booths — separate from whether a booth may trade.{' '}
          {operators.length} operator{operators.length === 1 ? '' : 's'}
          {pending.length > 0 && <span className="text-amber-400"> · {pending.length} awaiting review</span>}
        </p>
      </div>

      {/* Inert-state notice. Removed by the commit that adds the portal gate. */}
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <EyeOff className="w-4 h-4 text-[#777] shrink-0 mt-0.5" />
        <p className="text-xs text-[#999] font-inter">
          <span className="font-semibold text-[#bbb]">Decisions here are recorded, not enforced.</span>{' '}
          The vendor portal does not check operator approval yet, so approving or rejecting someone
          changes this record and nothing else. Enforcement ships separately.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-400 font-inter">{error}</p>
        </div>
      )}

      <ApprovalQueue
        title="Operators awaiting review"
        items={pendingItems}
        approveUrl={id => `/api/admin/vendor-members/${id}/approve`}
        rejectUrl={id => `/api/admin/vendor-members/${id}/reject`}
        onResolved={load}
        emptyLabel="No operators awaiting review."
      />

      {operators.length === 0 && !error && (
        <p className="rounded-xl border border-white/10 bg-[#111111] px-4 py-10 text-center text-sm text-[#555] font-inter">
          No operators yet. A person appears here once they are linked to a booth.
        </p>
      )}

      <div className="space-y-3">
        {operators.map(op => {
          const consequence = consequenceOf(op)
          const booth = boothBadge(op.booth.status)
          return (
            <div
              key={op.id}
              className={`rounded-2xl border bg-[#111111] p-5 transition-colors ${
                op.approvalStatus === 'REJECTED' ? 'border-red-500/30 bg-red-500/[0.04]'
                : op.approvalStatus === 'PENDING' ? 'border-amber-500/25'
                : 'border-white/10'
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-white font-inter font-semibold truncate">
                    {op.operator.name ?? op.operator.email ?? 'Unnamed operator'}
                  </p>
                  <p className="text-xs text-[#666] font-inter truncate">
                    {op.operator.name && op.operator.email ? op.operator.email : ''}
                    {op.operator.name && op.operator.email ? ' · ' : ''}
                    {op.role}
                  </p>
                  <p className="text-xs text-[#555] font-inter mt-1">
                    Joined {formatAuditTimestamp(op.joinedAt)}
                  </p>
                </div>

                {/* The two axes, never merged. */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Badge {...OPERATOR_BADGE[op.approvalStatus]} />
                  <Badge {...booth} />
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs font-inter">
                <div className="flex items-center gap-2 text-[#888] min-w-0">
                  <Store className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {op.booth.name}
                    {op.fair && <span className="text-[#666]"> · {op.fair.name}</span>}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[#888]">
                  <CreditCard className="w-3.5 h-3.5 shrink-0" />
                  {op.booth.stripeVerified
                    ? <span className="text-emerald-400">Booth payouts connected</span>
                    : <span className="text-[#666]">Booth has no verified payout account</span>}
                </div>
              </div>

              {/* What the pair MEANS — the reason both badges are here. */}
              <p className={`mt-3 text-xs font-inter ${TONE[consequence.tone]}`}>{consequence.text}</p>

              {op.approvalStatus === 'REJECTED' && op.rejectionReason && (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                  <p className="text-[0.6875rem] uppercase tracking-wide text-[#666] font-semibold">
                    Why they were refused
                  </p>
                  <p className="text-xs text-[#aaa] font-inter mt-0.5">{op.rejectionReason}</p>
                </div>
              )}

              {op.approvalStatus === 'APPROVED' && op.approvedAt && (
                <p className="mt-3 text-[11px] text-[#555] font-inter">
                  Admitted {formatAuditTimestamp(op.approvedAt)}
                  {op.approvedBy === 'system-grandfather' && ' — carried over when operator approval was introduced'}
                </p>
              )}

              <RowActions op={op} onDone={load} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Per-row actions for operators NOT in the pending queue — the re-decide path.
 * Approving a refused operator is a first-class action, not an edge case: rejection here is
 * reversible by design, so an appeal or a corrected document has a way back.
 */
function RowActions({ op, onDone }: { op: Operator; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (op.approvalStatus === 'PENDING') return null // handled by the queue above

  async function act(action: 'approve' | 'reject') {
    let reason: string | undefined
    if (action === 'reject') {
      reason = window.prompt('Why is this operator being refused? They will be shown this.')?.trim()
      if (!reason) return
    }
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/admin/vendor-members/${op.id}/${action}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'reject' ? JSON.stringify({ reason }) : undefined,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) { setErr(json.error?.message ?? `Could not ${action}`); return }
      onDone()
    } catch {
      setErr('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {op.approvalStatus === 'REJECTED' ? (
        <button
          onClick={() => act('approve')} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/25 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <CheckCircle className="w-3.5 h-3.5" /> {busy ? 'Admitting…' : 'Admit anyway'}
        </button>
      ) : (
        <button
          onClick={() => act('reject')} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-xs font-semibold hover:bg-red-500/25 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <XCircle className="w-3.5 h-3.5" /> {busy ? 'Refusing…' : 'Refuse operator'}
        </button>
      )}
      {err && <span className="text-xs text-red-400 font-inter">⚠ {err}</span>}
    </div>
  )
}
