'use client'

import { useState, useEffect, use, useCallback } from 'react'
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  BanknotesIcon,
  ArrowPathIcon,
  XMarkIcon,
  ChatBubbleLeftIcon,
} from '@heroicons/react/24/outline'
import { getStatusConfig } from '@/lib/order-status-config'
import toast from 'react-hot-toast'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Dispute {
  id: string
  reason: string
  evidence: unknown
  status: 'OPEN' | 'ESCALATED' | 'RESOLVED'
  submittedAt: string
  resolvedAt: string | null
  resolution: string | null
  vendorId: string
  vendorName: string
  boothNumber: string | null
  orderId: string
  orderStatus: string
  orderTotal: number
  orderPlacedAt: string
  customerName: string
}

type Action = 'RESOLVE' | 'REFUND' | 'PARTIAL_REFUND'

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function fmt(n: number) { return `$${n.toFixed(2)}` }

function StatusPill({ status }: { status: string }) {
  const cfg = getStatusConfig(status)
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase tracking-wider border ${cfg.color} ${cfg.textColor} ${cfg.borderColor}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dotColor}`} />
      {cfg.label}
    </span>
  )
}

const DISPUTE_STATUS_STYLES: Record<string, string> = {
  OPEN:      'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  ESCALATED: 'bg-red-500/10   text-red-400   border border-red-500/20',
  RESOLVED:  'bg-white/[0.04] text-white/30  border border-white/[0.06]',
}

// ── Resolution modal ──────────────────────────────────────────────────────────

function ResolutionModal({
  dispute,
  fairSlug,
  onResolved,
  onClose,
}: {
  dispute: Dispute
  fairSlug: string
  onResolved: (id: string, resolution: string, action: Action) => void
  onClose: () => void
}) {
  const [action, setAction]       = useState<Action>('RESOLVE')
  const [resolution, setResolution] = useState('')
  const [partialAmt, setPartialAmt] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleSubmit() {
    if (action === 'PARTIAL_REFUND') {
      const amt = parseFloat(partialAmt)
      if (isNaN(amt) || amt <= 0 || amt > dispute.orderTotal) {
        toast.error(`Enter an amount between $0.01 and ${fmt(dispute.orderTotal)}`)
        return
      }
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = { action, resolution: resolution || undefined }
      if (action === 'PARTIAL_REFUND') body.amount = parseFloat(partialAmt)

      const res = await fetch(`/api/organizer/fairs/${fairSlug}/disputes/${dispute.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.success) {
        const successMsg =
          action === 'REFUND'         ? 'Full refund queued'
          : action === 'PARTIAL_REFUND' ? `Partial refund of ${fmt(parseFloat(partialAmt))} issued`
          : 'Dispute marked resolved'
        toast.success(successMsg)
        onResolved(dispute.id, json.data.resolution ?? '', action)
        onClose()
      } else {
        toast.error(json.error?.message ?? 'Action failed')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  const ACTION_OPTIONS: { key: Action; icon: React.ElementType; label: string; desc: string; color: string }[] = [
    {
      key: 'RESOLVE', icon: CheckCircleIcon,
      label: 'Mark resolved',
      desc: 'Close the dispute — no payment change',
      color: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5',
    },
    {
      key: 'REFUND', icon: BanknotesIcon,
      label: 'Full refund',
      desc: `Refund ${fmt(dispute.orderTotal)} to customer`,
      color: 'border-neon-pink/30 text-neon-pink bg-neon-pink/5',
    },
    {
      key: 'PARTIAL_REFUND', icon: BanknotesIcon,
      label: 'Partial refund',
      desc: 'Specify an amount to refund',
      color: 'border-blue-500/30 text-blue-400 bg-blue-500/5',
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-[#0f0f0f] border border-white/[0.08] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <p className="text-white font-semibold text-sm font-inter">Resolve Dispute</p>
            <p className="text-white/35 text-xs font-inter mt-0.5">
              Order #{dispute.orderId.slice(-6).toUpperCase()} · {dispute.vendorName}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer">
            <XMarkIcon className="w-4 h-4 text-white/50" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Reason recap */}
          <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-3">
            <p className="text-amber-400/70 text-[0.6rem] uppercase tracking-wider font-semibold mb-1">Dispute Reason</p>
            <p className="text-white/70 text-sm font-inter">{dispute.reason}</p>
            <p className="text-white/30 text-xs font-inter mt-1">
              {dispute.customerName} · {fmt(dispute.orderTotal)} · {timeAgo(dispute.submittedAt)}
            </p>
          </div>

          {/* Action selector */}
          <div className="space-y-2">
            <p className="text-white/30 text-[0.6rem] uppercase tracking-wider font-semibold">Action</p>
            {ACTION_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => setAction(opt.key)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer text-left ${
                  action === opt.key
                    ? opt.color
                    : 'border-white/[0.06] text-white/40 hover:border-white/[0.12] hover:text-white/60'
                }`}
              >
                <opt.icon className="w-4 h-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-inter font-semibold">{opt.label}</p>
                  <p className="text-xs font-inter opacity-70 mt-0.5">{opt.desc}</p>
                </div>
                {action === opt.key && (
                  <div className="w-4 h-4 rounded-full border-2 border-current flex items-center justify-center shrink-0">
                    <div className="w-2 h-2 rounded-full bg-current" />
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Partial amount input */}
          {action === 'PARTIAL_REFUND' && (
            <div>
              <label className="block text-[0.6rem] uppercase tracking-wider text-white/30 font-semibold mb-1.5">
                Refund Amount (max {fmt(dispute.orderTotal)})
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm font-inter">$</span>
                <input
                  autoFocus
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={dispute.orderTotal}
                  value={partialAmt}
                  onChange={e => setPartialAmt(e.target.value)}
                  placeholder={dispute.orderTotal.toFixed(2)}
                  className="w-full bg-[#0a0a0a] border border-white/10 rounded-xl pl-7 pr-4 py-2.5 text-white text-sm font-inter outline-none focus:border-blue-400 transition-colors"
                />
              </div>
            </div>
          )}

          {/* Resolution note */}
          <div>
            <label className="block text-[0.6rem] uppercase tracking-wider text-white/30 font-semibold mb-1.5">
              Resolution note {action === 'RESOLVE' ? '(required)' : '(optional)'}
            </label>
            <textarea
              value={resolution}
              onChange={e => setResolution(e.target.value)}
              rows={3}
              placeholder={
                action === 'REFUND'         ? 'Full refund issued — item not delivered'
                : action === 'PARTIAL_REFUND' ? 'Partial refund for missing item'
                : 'Describe how this was resolved…'
              }
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm font-inter outline-none focus:border-neon-pink transition-colors resize-none placeholder-white/15"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSubmit}
              disabled={submitting || (action === 'RESOLVE' && !resolution.trim())}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-white text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                action === 'REFUND' || action === 'PARTIAL_REFUND'
                  ? 'bg-neon-pink hover:bg-[#e0006b]'
                  : 'bg-emerald-500 hover:bg-emerald-600'
              }`}
            >
              {submitting
                ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                : action === 'REFUND' ? <BanknotesIcon className="w-4 h-4" />
                : action === 'PARTIAL_REFUND' ? <BanknotesIcon className="w-4 h-4" />
                : <CheckCircleIcon className="w-4 h-4" />}
              {submitting ? 'Processing…'
                : action === 'REFUND'         ? `Refund ${fmt(dispute.orderTotal)}`
                : action === 'PARTIAL_REFUND' ? partialAmt ? `Refund ${fmt(parseFloat(partialAmt) || 0)}` : 'Refund'
                : 'Mark Resolved'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 bg-white/5 border border-white/10 text-white/40 text-sm rounded-xl cursor-pointer hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Dispute card ──────────────────────────────────────────────────────────────

function DisputeCard({
  dispute,
  onResolve,
  onContactVendor,
}: {
  dispute: Dispute
  onResolve: (d: Dispute) => void
  onContactVendor: (d: Dispute) => void
}) {
  const isActive = dispute.status === 'OPEN' || dispute.status === 'ESCALATED'

  return (
    <div className={`bg-[#111] rounded-xl border overflow-hidden transition-colors ${
      isActive ? 'border-white/[0.08] hover:border-white/[0.14]' : 'border-white/[0.04] opacity-60'
    }`}>
      {/* Header */}
      <div className="flex items-start gap-3 px-4 py-3.5">
        <ExclamationTriangleIcon className={`w-4 h-4 shrink-0 mt-0.5 ${
          dispute.status === 'ESCALATED' ? 'text-red-400' :
          dispute.status === 'OPEN'      ? 'text-amber-400' : 'text-white/20'
        }`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`px-2 py-0.5 rounded-full text-[0.6rem] font-bold uppercase tracking-wider ${DISPUTE_STATUS_STYLES[dispute.status]}`}>
              {dispute.status}
            </span>
            <span className="text-white/25 text-xs font-inter">
              Order #{dispute.orderId.slice(-6).toUpperCase()}
            </span>
            <span className="text-white/20 text-xs font-inter">·</span>
            <span className="text-white/40 text-xs font-inter">{timeAgo(dispute.submittedAt)}</span>
          </div>
          <p className="text-white text-sm font-inter font-medium">{dispute.reason}</p>
          {dispute.resolution && (
            <p className="text-emerald-400/60 text-xs font-inter mt-1 italic">{dispute.resolution}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-white text-sm font-inter font-semibold tabular-nums">{fmt(dispute.orderTotal)}</p>
        </div>
      </div>

      {/* Metadata row */}
      <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
        <span className="text-white/30 text-xs font-inter bg-white/[0.04] px-2 py-0.5 rounded">
          {dispute.vendorName}{dispute.boothNumber ? ` · Booth ${dispute.boothNumber}` : ''}
        </span>
        <span className="text-white/25 text-xs font-inter">{dispute.customerName}</span>
        <StatusPill status={dispute.orderStatus} />
      </div>

      {/* Actions */}
      {isActive && (
        <div className="px-4 pb-4 flex items-center gap-2">
          <button
            onClick={() => onResolve(dispute)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 text-white/70 hover:text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <CheckCircleIcon className="w-3.5 h-3.5" />
            Resolve
          </button>
          <button
            onClick={() => onResolve(dispute)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-pink/10 border border-neon-pink/20 hover:bg-neon-pink/20 text-neon-pink text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <BanknotesIcon className="w-3.5 h-3.5" />
            Refund
          </button>
          <button
            onClick={() => onContactVendor(dispute)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.07] text-white/40 hover:text-white/70 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <ChatBubbleLeftIcon className="w-3.5 h-3.5" />
            Contact Vendor
          </button>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type FilterKey = 'OPEN' | 'RESOLVED' | 'ALL'

export default function DisputesPage({ params }: { params: Promise<{ fairSlug: string }> }) {
  const { fairSlug } = use(params)

  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<FilterKey>('OPEN')
  const [resolving, setResolving] = useState<Dispute | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const loadDisputes = useCallback((replace = true) => {
    if (replace) setLoading(true)
    fetch(`/api/organizer/fairs/${fairSlug}/disputes`)
      .then(r => r.json())
      .then(json => {
        if (json.data?.disputes) {
          setDisputes(prev => replace ? json.data.disputes : [...prev, ...json.data.disputes])
          setNextCursor(json.data.nextCursor ?? null)
        }
      })
      .catch(() => {})
      .finally(() => { setLoading(false); setLoadingMore(false) })
  }, [fairSlug])

  useEffect(() => { loadDisputes() }, [loadDisputes])

  function handleResolved(id: string, resolution: string, action: Action) {
    setDisputes(prev => prev.map(d =>
      d.id === id ? { ...d, status: 'RESOLVED', resolution } : d
    ))
  }

  function handleContactVendor(dispute: Dispute) {
    // Opens mailto to contact vendor — a more integrated notification
    // system can be wired here once email queue is available
    window.open(
      `mailto:?subject=Regarding Order #${dispute.orderId.slice(-6).toUpperCase()} — ${dispute.vendorName}&body=Hi ${dispute.vendorName},%0A%0ARegarding dispute on order #${dispute.orderId.slice(-6).toUpperCase()}:%0A${encodeURIComponent(dispute.reason)}%0A%0APlease respond at your earliest convenience.`,
      '_blank'
    )
  }

  function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    fetch(`/api/organizer/fairs/${fairSlug}/disputes?cursor=${nextCursor}`)
      .then(r => r.json())
      .then(json => {
        if (json.data?.disputes) {
          setDisputes(prev => [...prev, ...json.data.disputes])
          setNextCursor(json.data.nextCursor ?? null)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false))
  }

  const openCount = disputes.filter(d => d.status !== 'RESOLVED').length
  const filtered = filter === 'ALL'      ? disputes
    : filter === 'OPEN'                  ? disputes.filter(d => d.status !== 'RESOLVED')
    : disputes.filter(d => d.status === 'RESOLVED')

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: 'OPEN',     label: openCount > 0 ? `Open (${openCount})` : 'Open' },
    { key: 'RESOLVED', label: 'Resolved' },
    { key: 'ALL',      label: 'All' },
  ]

  return (
    <div className="p-6 md:p-4 max-w-[52rem] mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.25rem)] tracking-wide text-white leading-tight">
            Order <span className="text-neon-pink">Disputes</span>
          </h1>
          <p className="text-white/30 text-sm font-inter mt-0.5">
            {openCount > 0
              ? `${openCount} open dispute${openCount !== 1 ? 's' : ''} require action`
              : 'No open disputes — all clear'}
          </p>
        </div>
        <button
          onClick={() => loadDisputes()}
          className="shrink-0 p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer"
        >
          <ArrowPathIcon className={`w-4 h-4 text-white/50 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Escalated alert */}
      {disputes.some(d => d.status === 'ESCALATED') && (
        <div className="mb-5 flex items-start gap-2.5 px-4 py-3 bg-red-500/8 border border-red-500/20 rounded-xl">
          <ExclamationTriangleIcon className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 text-sm font-semibold font-inter">
              {disputes.filter(d => d.status === 'ESCALATED').length} escalated dispute{disputes.filter(d => d.status === 'ESCALATED').length !== 1 ? 's' : ''}
            </p>
            <p className="text-red-400/50 text-xs font-inter">24-hour SLA elapsed — requires immediate action</p>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1 bg-[#111] border border-white/5 rounded-lg p-1 mb-5 w-fit">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold font-inter whitespace-nowrap transition-colors cursor-pointer ${
              filter === f.key ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-white/[0.03] rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#111] border border-white/[0.05] rounded-xl p-14 text-center">
          <ExclamationTriangleIcon className="w-8 h-8 mx-auto mb-3 text-white/10" />
          <p className="text-white/20 font-inter text-sm">
            {filter === 'OPEN' ? 'No open disputes — queue is clear' : 'No disputes found'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {filtered.map(dispute => (
              <DisputeCard
                key={dispute.id}
                dispute={dispute}
                onResolve={d => setResolving(d)}
                onContactVendor={handleContactVendor}
              />
            ))}
          </div>
          {nextCursor && filter === 'ALL' && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-4 w-full py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 text-white/40 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}

      {resolving && (
        <ResolutionModal
          dispute={resolving}
          fairSlug={fairSlug}
          onResolved={handleResolved}
          onClose={() => setResolving(null)}
        />
      )}
    </div>
  )
}
