'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import {
  ArrowPathIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  BanknotesIcon,
  ClockIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import { getStatusConfig } from '@/lib/order-status-config'
import ConfirmModal from '@/app/_components/ui/ConfirmModal'
import toast from 'react-hot-toast'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrderItem {
  id: string
  name: string
  quantity: number
  unitPrice: number
  specialInstructions?: string | null
}

interface Dispute {
  id: string
  status: 'OPEN' | 'ESCALATED' | 'RESOLVED'
  reason: string
}

interface Order {
  id: string
  status: string
  total: number
  subtotal: number
  vendorPayout: number
  fairSynqFee: number
  placedAt: string
  customerName: string
  customerPhone: string
  fulfillmentType: string
  pickupLocation: string | null
  cancellationReason: string | null
  cancelledBy: string | null
  hasStripe: boolean
  vendorId: string
  vendorName: string
  boothNumber: string | null
  items: OrderItem[]
  dispute: Dispute | null
}

interface VendorBreakdown {
  vendorId: string
  vendorName: string
  status: string
  sliceAmount: number   // exact refundable slice — NEVER includes the platform fee
  refundStatus: 'NONE' | 'PENDING' | 'REFUNDED'
  refundRequest: { status: string; reason: string | null } | null
}

interface ChargebackInfo {
  id: string
  stripeDisputeId: string
  amountCents: number
  feeCents: number
  reason: string | null
  status: string
  atFaultVendorId: string | null
  clawbackStatus: string
  fundsReinstated: boolean
}

interface DetailOrder extends Order {
  voided: boolean
  vendors: VendorBreakdown[]
  chargebacks: ChargebackInfo[]
  deliveryFee: number | null
  serviceCharge: number | null
  deliveryStreet: string | null
  deliveryCity: string | null
  deliveryZip: string | null
  vehicleMake: string | null
  vehicleColor: string | null
  vehiclePlate: string | null
  acceptedAt: string | null
  readyAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  estimatedReadyAt: string | null
  payoutStatus: string | null
  timeline: { id: string; eventType: string; actorRole: string | null; metadata: unknown; timestamp: string }[]
  disputes: { id: string; status: string; reason: string; submittedAt: string; resolution: string | null; resolvedAt: string | null }[]
  cancellation: { reason: string | null; refundIssued: boolean; refundAmount: number | null } | null
}

interface Meta { pendingCount: number; issuesCount: number; disputeCount: number }
interface VendorOption { id: string; name: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmt(n: number | null | undefined) {
  return `$${(n ?? 0).toFixed(2)}`
}

const FULFILLMENT_LABELS: Record<string, string> = {
  BOOTH_PICKUP:  'Pickup',
  CURBSIDE:      'Curbside',
  HOME_DELIVERY: 'Delivery',
}

const TIMELINE_LABELS: Record<string, string> = {
  placed:           'Order placed',
  accepted:         'Accepted by vendor',
  preparing:        'Preparing',
  ready:            'Ready for pickup',
  runner_collected: 'Runner collected',
  completed:        'Completed',
  delivered:        'Delivered',
  cancelled:        'Cancelled',
  uncollected:      'Marked uncollected',
  undeliverable:    'Marked undeliverable',
  refund_initiated: 'Refund initiated',
}

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status, fullWidth = false }: { status: string; fullWidth?: boolean }) {
  const cfg = getStatusConfig(status)
  // fullWidth: stretches to fill a fixed-width parent so badges align horizontally in lists
  const layout = fullWidth ? 'flex w-full justify-center' : 'inline-flex'
  return (
    <span className={`${layout} items-center gap-1.5 px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase tracking-wider border whitespace-nowrap ${cfg.color} ${cfg.textColor} ${cfg.borderColor}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dotColor}`} />
      <span className="truncate">{cfg.label}</span>
    </span>
  )
}

// ── Refund status badge ─────────────────────────────────────────────────────

function RefundBadge({ status }: { status: 'NONE' | 'PENDING' | 'REFUNDED' }) {
  if (status === 'NONE') return null
  const cfg = status === 'REFUNDED'
    ? { label: 'Refunded', color: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', dot: 'bg-emerald-400' }
    : { label: 'Refund Pending', color: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', dot: 'bg-amber-400' }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase tracking-wider border whitespace-nowrap ${cfg.color} ${cfg.text} ${cfg.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

// ── Order detail modal ────────────────────────────────────────────────────────

function OrderModal({
  orderId,
  fairSlug,
  onClose,
  onDisputeResolved,
}: {
  orderId: string
  fairSlug: string
  onClose: () => void
  onDisputeResolved: (orderId: string) => void
}) {
  const [order, setOrder]         = useState<DetailOrder | null>(null)
  const [loading, setLoading]     = useState(true)
  const [refunding, setRefunding] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)
  // Refund confirmation target: a single vendor, or 'ALL' refundable vendors.
  const [confirmTarget, setConfirmTarget] = useState<
    | { type: 'vendor'; vendor: VendorBreakdown }
    | { type: 'all'; vendors: VendorBreakdown[] }
    | null
  >(null)
  const [resolving, setResolving]       = useState<string | null>(null)
  const [resolveNote, setResolveNote]   = useState('')

  const loadOrder = useCallback(async () => {
    try {
      const r = await fetch(`/api/organizer/fairs/${fairSlug}/orders/${orderId}`)
      const json = await r.json()
      if (json.success) setOrder(json.data)
    } catch { /* keep prior state */ }
  }, [orderId, fairSlug])

  useEffect(() => { loadOrder().finally(() => setLoading(false)) }, [loadOrder])

  // A vendor portion is refundable iff the order isn't voided, it's backed by a
  // Stripe charge, and the portion is neither already REFUNDED nor DECLINED.
  const isRefundable = (v: VendorBreakdown) =>
    !!order && !order.voided && order.hasStripe && v.refundStatus !== 'REFUNDED' && v.status !== 'DECLINED'
  const refundableVendors = (order?.vendors ?? []).filter(isRefundable)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // POST one vendor portion to the organizer refund endpoint (per-vendor money
  // engine — no direct Stripe here). Returns the API error message on failure.
  async function refundOne(vendorId: string): Promise<string | null> {
    const res = await fetch(`/api/organizer/fairs/${fairSlug}/orders/${orderId}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendorId }),
    })
    const json = await res.json().catch(() => ({}))
    return json.success ? null : (json.error?.message ?? 'Refund failed')
  }

  // Confirm handler for the ConfirmModal. Per-vendor refunds the target slice(s);
  // for "all" it loops only the REFUNDABLE vendors (already-refunded/declined are
  // skipped, never re-touched). On success: refresh badges (re-fetch), close.
  // On error: keep the modal open and show the message inline.
  async function confirmRefund() {
    if (!confirmTarget) return
    setRefunding(true)
    setRefundError(null)
    try {
      const targets = confirmTarget.type === 'vendor' ? [confirmTarget.vendor] : confirmTarget.vendors
      for (const v of targets) {
        const err = await refundOne(v.vendorId)
        if (err) { setRefundError(`${v.vendorName}: ${err}`); setRefunding(false); return }
      }
      await loadOrder() // refresh refund badges without a full page reload
      toast.success(
        confirmTarget.type === 'vendor'
          ? `Refunded ${confirmTarget.vendor.vendorName}'s portion`
          : 'Refunded all refundable vendors',
      )
      setConfirmTarget(null)
    } catch {
      setRefundError('Network error — please try again')
    } finally {
      setRefunding(false)
    }
  }

  const confirmTitle = !confirmTarget ? ''
    : confirmTarget.type === 'vendor' ? `Refund ${confirmTarget.vendor.vendorName}?`
    : 'Refund all vendors?'
  const confirmBody = (() => {
    if (!confirmTarget) return ''
    if (confirmTarget.type === 'vendor') {
      const v = confirmTarget.vendor
      return `This refunds ${v.vendorName}'s subtotal of ${fmt(v.sliceAmount)} to the customer. `
        + `The 10% platform fee is NOT refunded.`
        + (refundError ? `  ⚠ ${refundError}` : '')
    }
    const list = confirmTarget.vendors.map(v => `${v.vendorName} (${fmt(v.sliceAmount)})`).join(', ')
    const sum = confirmTarget.vendors.reduce((s, v) => s + v.sliceAmount, 0)
    return `This refunds each refundable vendor's subtotal — ${list} — totalling ${fmt(sum)}. `
      + `The 10% platform fee is NOT refunded.`
      + (refundError ? `  ⚠ ${refundError}` : '')
  })()

  // Assign fault for a bank chargeback → records the ~$15 fee as recoverable
  // (no money moves; fight/accept stays in the Stripe dashboard).
  async function setAtFault(chargebackId: string, vendorId: string) {
    try {
      const res = await fetch(`/api/organizer/fairs/${fairSlug}/chargebacks/${chargebackId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atFaultVendorId: vendorId }),
      })
      const json = await res.json()
      if (json.success) { toast.success('At-fault vendor set — dispute fee recorded recoverable'); await loadOrder() }
      else toast.error(json.error?.message ?? 'Failed to set at-fault vendor')
    } catch { toast.error('Network error') }
  }

  async function handleResolveDispute(disputeId: string) {
    setResolving(disputeId)
    try {
      const res = await fetch(`/api/organizer/fairs/${fairSlug}/disputes/${disputeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: resolveNote || undefined }),
      })
      const json = await res.json()
      if (json.success) {
        toast.success('Dispute resolved')
        setOrder(prev => prev ? {
          ...prev,
          disputes: prev.disputes.map(d =>
            d.id === disputeId ? { ...d, status: 'RESOLVED', resolution: resolveNote } : d
          ),
        } : prev)
        onDisputeResolved(orderId)
      } else {
        toast.error(json.error?.message ?? 'Failed to resolve dispute')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setResolving(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-[38rem] max-h-[90vh] overflow-y-auto bg-[#0f0f0f] border border-white/[0.08] rounded-t-2xl sm:rounded-2xl shadow-2xl">

        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#0f0f0f] border-b border-white/[0.06] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {loading ? (
              <div className="h-5 w-36 bg-white/5 rounded animate-pulse" />
            ) : (
              <>
                <p className="text-white font-inter font-semibold text-sm">
                  Order #{orderId.slice(-6).toUpperCase()}
                </p>
                {order && <StatusPill status={order.status} />}
              </>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer">
            <XMarkIcon className="w-4 h-4 text-white/50" />
          </button>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-white/[0.04] rounded-lg animate-pulse" />)}
          </div>
        ) : !order ? (
          <div className="p-8 text-center text-white/30 text-sm font-inter">Failed to load order</div>
        ) : (
          <div className="p-5 space-y-5">

            {/* Customer + vendor */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/[0.03] rounded-xl p-3">
                <p className="text-[0.6rem] uppercase tracking-wider text-white/30 font-semibold mb-1.5">Customer</p>
                <p className="text-white text-sm font-inter font-semibold">{order.customerName}</p>
                <p className="text-white/40 text-xs font-inter">{order.customerPhone}</p>
              </div>
              <div className="bg-white/[0.03] rounded-xl p-3">
                <p className="text-[0.6rem] uppercase tracking-wider text-white/30 font-semibold mb-1.5">Vendor</p>
                <p className="text-white text-sm font-inter font-semibold">{order.vendorName}</p>
                <p className="text-white/40 text-xs font-inter">
                  {[FULFILLMENT_LABELS[order.fulfillmentType], order.boothNumber ? `Booth ${order.boothNumber}` : null]
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>

            {/* Fulfillment extras */}
            {order.fulfillmentType === 'CURBSIDE' && order.vehicleMake && (
              <div className="bg-white/[0.03] rounded-xl p-3">
                <p className="text-[0.6rem] uppercase tracking-wider text-white/30 font-semibold mb-1">Vehicle</p>
                <p className="text-white/70 text-sm font-inter">
                  {[order.vehicleColor, order.vehicleMake, order.vehiclePlate].filter(Boolean).join(' · ')}
                </p>
              </div>
            )}
            {order.fulfillmentType === 'HOME_DELIVERY' && order.deliveryStreet && (
              <div className="bg-white/[0.03] rounded-xl p-3">
                <p className="text-[0.6rem] uppercase tracking-wider text-white/30 font-semibold mb-1">Delivery address</p>
                <p className="text-white/70 text-sm font-inter">
                  {[order.deliveryStreet, order.deliveryCity, order.deliveryZip].filter(Boolean).join(', ')}
                </p>
              </div>
            )}

            {/* Items */}
            <div>
              <p className="text-[0.6rem] uppercase tracking-wider text-white/30 font-semibold mb-2">Items</p>
              <div className="space-y-1.5">
                {order.items.map(item => (
                  <div key={item.id} className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <span className="text-white/70 text-sm font-inter">
                        {item.quantity}× {item.name}
                      </span>
                      {item.specialInstructions && (
                        <p className="text-white/30 text-xs font-inter italic mt-0.5">{item.specialInstructions}</p>
                      )}
                    </div>
                    <span className="text-white/50 text-sm font-inter tabular-nums shrink-0">
                      {fmt(item.quantity * item.unitPrice)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pricing */}
            <div className="bg-white/[0.03] rounded-xl p-3">
              <p className="text-[0.6rem] uppercase tracking-wider text-white/30 font-semibold mb-2">Pricing</p>
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm font-inter">
                  <span className="text-white/50">Subtotal</span>
                  <span className="text-white/70 tabular-nums">{fmt(order.subtotal)}</span>
                </div>
                {(order.deliveryFee ?? 0) > 0 && (
                  <div className="flex justify-between text-sm font-inter">
                    <span className="text-white/50">Delivery fee</span>
                    <span className="text-white/70 tabular-nums">{fmt(order.deliveryFee)}</span>
                  </div>
                )}
                {(order.serviceCharge ?? 0) > 0 && (
                  <div className="flex justify-between text-sm font-inter">
                    <span className="text-white/50">Service charge</span>
                    <span className="text-white/70 tabular-nums">{fmt(order.serviceCharge)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-inter border-t border-white/[0.05] pt-1.5">
                  <span className="text-white font-semibold">Total</span>
                  <span className="text-white font-semibold tabular-nums">{fmt(order.total)}</span>
                </div>
                <div className="flex justify-between text-xs font-inter text-white/25">
                  <span>Platform fee</span>
                  <span className="tabular-nums">{fmt(order.fairSynqFee)}</span>
                </div>
                <div className="flex justify-between text-xs font-inter text-white/25">
                  <span>Vendor payout</span>
                  <span className="tabular-nums">{fmt(order.vendorPayout)}</span>
                </div>
                {order.payoutStatus && (
                  <div className="flex justify-between text-xs font-inter">
                    <span className="text-white/25">Payout status</span>
                    <span className={order.payoutStatus === 'PAID' ? 'text-emerald-400' : 'text-amber-400'}>
                      {order.payoutStatus}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Cancellation info */}
            {(order.cancelledBy || order.cancellation) && (
              <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-3">
                <p className="text-[0.6rem] uppercase tracking-wider text-red-400/60 font-semibold mb-1">Cancellation</p>
                {order.cancelledBy && (
                  <p className="text-white/60 text-sm font-inter">
                    By <span className="text-white/80 capitalize">{order.cancelledBy}</span>
                    {order.cancellationReason && ` — ${order.cancellationReason}`}
                  </p>
                )}
                {order.cancellation && (
                  <p className="text-xs font-inter mt-1">
                    {order.cancellation.refundIssued
                      ? <span className="text-emerald-400">Refund issued: {fmt(order.cancellation.refundAmount)}</span>
                      : <span className="text-amber-400">Refund pending</span>}
                  </p>
                )}
              </div>
            )}

            {/* Timeline */}
            {order.timeline.length > 0 && (
              <div>
                <p className="text-[0.6rem] uppercase tracking-wider text-white/30 font-semibold mb-3">Timeline</p>
                <div>
                  {order.timeline.map((ev, idx) => (
                    <div key={ev.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                          idx === order.timeline.length - 1 ? 'bg-neon-pink' : 'bg-white/20'
                        }`} />
                        {idx < order.timeline.length - 1 && (
                          <div className="w-px flex-1 bg-white/[0.06] my-1" />
                        )}
                      </div>
                      <div className="pb-3 flex-1 min-w-0">
                        <p className="text-white/70 text-xs font-inter">
                          {TIMELINE_LABELS[ev.eventType] ?? ev.eventType.replace(/_/g, ' ')}
                          {ev.actorRole && <span className="text-white/25"> · {ev.actorRole}</span>}
                        </p>
                        <p className="text-white/25 text-[0.65rem] font-inter">
                          {new Date(ev.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active disputes */}
            {order.disputes.filter(d => d.status !== 'RESOLVED').map(dispute => (
              <div key={dispute.id} className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <ExclamationTriangleIcon className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-amber-400 text-xs font-semibold font-inter uppercase tracking-wider">
                      {dispute.status === 'ESCALATED' ? 'Escalated Dispute' : 'Open Dispute'}
                    </p>
                    <p className="text-white/70 text-sm font-inter mt-1">{dispute.reason}</p>
                  </div>
                </div>
                {resolving === dispute.id ? (
                  <div className="space-y-2">
                    <input
                      autoFocus
                      value={resolveNote}
                      onChange={e => setResolveNote(e.target.value)}
                      placeholder="Resolution note (optional)"
                      className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-inter outline-none focus:border-amber-400 transition-colors"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleResolveDispute(dispute.id)}
                        className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        Confirm Resolve
                      </button>
                      <button
                        onClick={() => { setResolving(null); setResolveNote('') }}
                        className="px-3 py-2 bg-white/5 border border-white/10 text-white/40 text-xs rounded-lg cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setResolving(dispute.id)}
                    className="w-full py-2 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 text-amber-400 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    Resolve Dispute
                  </button>
                )}
              </div>
            ))}

            {/* Resolved disputes */}
            {order.disputes.filter(d => d.status === 'RESOLVED').map(dispute => (
              <div key={dispute.id} className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3 opacity-50">
                <p className="text-[0.6rem] uppercase tracking-wider text-emerald-400/50 font-semibold mb-1">Dispute Resolved</p>
                <p className="text-white/40 text-xs font-inter">{dispute.resolution ?? 'No resolution note'}</p>
              </div>
            ))}

            {/* Bank chargebacks (read-only surfacing; fight/accept in Stripe) */}
            {order.chargebacks?.length > 0 && order.chargebacks.map(cb => (
              <div key={cb.id} className="bg-red-500/[0.06] border border-red-500/20 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-red-400 text-xs font-bold font-inter uppercase tracking-wider">
                    Bank Chargeback · {cb.status.replace(/_/g, ' ')}
                  </p>
                  <a
                    href={`https://dashboard.stripe.com/test/disputes/${cb.stripeDisputeId}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-[0.65rem] text-white/50 hover:text-white underline"
                  >
                    Fight / Accept in Stripe →
                  </a>
                </div>
                <div className="text-xs font-inter text-white/60 space-y-0.5">
                  <p>Disputed: <span className="tabular-nums text-white/80">{fmt(cb.amountCents / 100)}</span> · fee <span className="tabular-nums text-white/80">{fmt(cb.feeCents / 100)}</span> (recoverable)</p>
                  {cb.reason && <p>Reason: {cb.reason.replace(/_/g, ' ')}</p>}
                  <p>Vendor clawback: <span className="text-white/80">{cb.clawbackStatus}</span>{cb.fundsReinstated && <span className="text-amber-400"> · funds reinstated — admin reconcile</span>}</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[0.6rem] uppercase tracking-wider text-white/30 font-semibold">At-fault vendor</label>
                  <select
                    value={cb.atFaultVendorId ?? ''}
                    onChange={e => e.target.value && setAtFault(cb.id, e.target.value)}
                    className="bg-[#0a0a0a] border border-white/10 rounded-lg px-2 py-1 text-white text-xs outline-none focus:border-neon-pink"
                  >
                    <option value="">— select —</option>
                    {order.vendors.map(v => <option key={v.vendorId} value={v.vendorId}>{v.vendorName}</option>)}
                  </select>
                </div>
              </div>
            ))}

            {/* Per-vendor refunds */}
            {order.hasStripe && order.vendors.length > 0 && (
              <div className="border-t border-white/[0.06] pt-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[0.6rem] uppercase tracking-wider text-white/30 font-semibold">Vendors &amp; Refunds</p>
                  {refundableVendors.length > 0 && (
                    <button
                      onClick={() => { setRefundError(null); setConfirmTarget({ type: 'all', vendors: refundableVendors }) }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-pink/10 border border-neon-pink/20 hover:bg-neon-pink/20 text-neon-pink text-[0.7rem] font-semibold rounded-lg transition-colors cursor-pointer"
                    >
                      <BanknotesIcon className="w-3.5 h-3.5" />
                      Refund All Vendors
                    </button>
                  )}
                </div>

                {order.voided && (
                  <p className="text-amber-400/70 text-[0.7rem] font-inter mb-2">Order is out of model (voided) — refunds disabled.</p>
                )}

                <div className="space-y-2">
                  {order.vendors.map(v => (
                    <div key={v.vendorId} className="bg-white/[0.03] rounded-xl p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-white text-sm font-inter font-semibold truncate">{v.vendorName}</p>
                          <p className="text-white/40 text-xs font-inter tabular-nums">Slice {fmt(v.sliceAmount)} <span className="text-white/20">· fee not refundable</span></p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <StatusPill status={v.status} />
                          <RefundBadge status={v.refundStatus} />
                        </div>
                      </div>

                      {/* RefundRequest indicator */}
                      {v.refundRequest && (
                        <p className="mt-2 text-[0.7rem] font-inter">
                          <span className={`font-semibold ${v.refundRequest.status === 'APPROVED' ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {v.refundRequest.status === 'APPROVED' ? 'Refund Request · Approved' : 'Refund Requested'}
                          </span>
                          {v.refundRequest.reason && <span className="text-white/40"> — {v.refundRequest.reason}</span>}
                        </p>
                      )}

                      {isRefundable(v) && (
                        <button
                          onClick={() => { setRefundError(null); setConfirmTarget({ type: 'vendor', vendor: v }) }}
                          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 text-white/60 hover:text-white text-[0.7rem] font-semibold rounded-lg transition-colors cursor-pointer"
                        >
                          <BanknotesIcon className="w-3.5 h-3.5" />
                          Refund {v.vendorName}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <ConfirmModal
          open={!!confirmTarget}
          title={confirmTitle}
          message={confirmBody}
          confirmLabel="Confirm Refund"
          variant="destructive"
          loading={refunding}
          onConfirm={confirmRefund}
          onCancel={() => { if (!refunding) { setConfirmTarget(null); setRefundError(null) } }}
        />
      </div>
    </div>
  )
}

// ── Order row ─────────────────────────────────────────────────────────────────

function OrderRow({ order, onClick }: { order: Order; onClick: () => void }) {
  const hasIssue = order.dispute && order.dispute.status !== 'RESOLVED'

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-[#111] border border-white/[0.06] hover:border-white/[0.12] rounded-xl p-4 transition-colors cursor-pointer"
    >
      <div className="flex items-start gap-4">
        {/* Fixed-width status slot — locks the start position of every order ID column */}
        <div className="w-28 shrink-0 pt-0.5 flex">
          <StatusPill status={order.status} fullWidth />
        </div>

        {/* Middle: order info — flex-1 absorbs remaining width */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white text-sm font-inter font-semibold tabular-nums">
              #{order.id.slice(-6).toUpperCase()}
            </span>
            <span className="text-white/25 text-xs">·</span>
            <span className="text-white/60 text-xs font-inter truncate">{order.customerName}</span>
            {hasIssue && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-amber-400 text-[0.6rem] font-bold uppercase tracking-wider">
                <ExclamationTriangleIcon className="w-3 h-3" />
                Dispute
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-white/30 text-xs font-inter bg-white/[0.04] px-2 py-0.5 rounded truncate max-w-[14rem]">
              {order.vendorName}
            </span>
            {order.boothNumber && (
              <span className="text-white/20 text-xs font-inter">Booth {order.boothNumber}</span>
            )}
            <span className="text-white/20 text-xs font-inter">
              {FULFILLMENT_LABELS[order.fulfillmentType] ?? order.fulfillmentType}
            </span>
          </div>
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {order.items.slice(0, 3).map(item => (
              <span key={item.id} className="text-[0.65rem] text-white/25 font-inter bg-white/[0.03] px-1.5 py-0.5 rounded">
                {item.quantity}× {item.name}
              </span>
            ))}
            {order.items.length > 3 && (
              <span className="text-[0.65rem] text-white/20 font-inter">+{order.items.length - 3} more</span>
            )}
          </div>
        </div>

        {/* Right: price + time — fixed slot keeps right edge aligned across rows */}
        <div className="shrink-0 text-right w-24 pt-0.5">
          <p className="text-white text-sm font-inter font-semibold tabular-nums">{fmt(order.total)}</p>
          <p className="text-white/25 text-[0.65rem] font-inter mt-0.5">{timeAgo(order.placedAt)}</p>
        </div>
      </div>
    </button>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'all' | 'vendor' | 'pending' | 'issues'

export default function FairOrdersPage() {
  const params    = useParams<{ fairSlug: string }>()
  const fairSlug  = params.fairSlug

  const [tab, setTab]               = useState<Tab>('all')
  const [vendorFilter, setVendorFilter] = useState<string>('')
  const [search, setSearch]         = useState('')
  const [orders, setOrders]         = useState<Order[]>([])
  const [meta, setMeta]             = useState<Meta>({ pendingCount: 0, issuesCount: 0, disputeCount: 0 })
  const [vendors, setVendors]       = useState<VendorOption[]>([])
  const [loading, setLoading]       = useState(true)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function buildUrl(cursor?: string) {
    const u = new URLSearchParams()
    if (tab === 'pending')                u.set('tab', 'pending')
    else if (tab === 'issues')            u.set('tab', 'issues')
    if (tab === 'vendor' && vendorFilter) u.set('vendorId', vendorFilter)
    if (cursor)                           u.set('cursor', cursor)
    return `/api/organizer/fairs/${fairSlug}/orders?${u.toString()}`
  }

  const loadOrders = useCallback((replace = true) => {
    if (replace) setLoading(true)
    fetch(buildUrl())
      .then(r => r.json())
      .then(json => {
        if (!json.success) return
        setOrders(prev => replace ? json.data.orders : [...prev, ...json.data.orders])
        setNextCursor(json.data.nextCursor ?? null)
        if (json.data.meta) setMeta(json.data.meta)
      })
      .catch(() => {})
      .finally(() => { setLoading(false); setLoadingMore(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fairSlug, tab, vendorFilter])

  useEffect(() => { loadOrders() }, [loadOrders])

  // Vendor list for By Vendor selector
  useEffect(() => {
    fetch(`/api/organizer/fairs/${fairSlug}/vendors?take=200`)
      .then(r => r.json())
      .then(json => {
        if (json.data?.vendors) {
          setVendors(json.data.vendors.map((v: { id: string; name: string }) => ({ id: v.id, name: v.name })))
        }
      })
      .catch(() => {})
  }, [fairSlug])

  // 30s polling
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => loadOrders(), 30_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loadOrders])

  function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    fetch(buildUrl(nextCursor))
      .then(r => r.json())
      .then(json => {
        if (json.data?.orders) {
          setOrders(prev => [...prev, ...json.data.orders])
          setNextCursor(json.data.nextCursor ?? null)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false))
  }

  function handleDisputeResolved(orderId: string) {
    setOrders(prev => prev.map(o =>
      o.id === orderId && o.dispute
        ? { ...o, dispute: { ...o.dispute, status: 'RESOLVED' as const } }
        : o
    ))
    setMeta(prev => ({ ...prev, disputeCount: Math.max(0, prev.disputeCount - 1) }))
  }

  const visible = search.trim()
    ? orders.filter(o =>
        o.id.toLowerCase().includes(search.toLowerCase()) ||
        o.customerName.toLowerCase().includes(search.toLowerCase()) ||
        o.vendorName.toLowerCase().includes(search.toLowerCase())
      )
    : orders

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'all',     label: 'All Orders' },
    { key: 'vendor',  label: 'By Vendor' },
    { key: 'pending', label: 'Live',   badge: meta.pendingCount || undefined },
    { key: 'issues',  label: 'Issues', badge: (meta.issuesCount + meta.disputeCount) || undefined },
  ]

  return (
    <div className="p-6 md:p-4 max-w-[60rem] mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.25rem)] tracking-wide text-white leading-tight">
            Fair <span className="text-neon-pink">Orders</span>
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-white/30 text-sm font-inter">
              {meta.pendingCount} live · auto-refreshes every 30s
            </span>
          </div>
        </div>
        <button
          onClick={() => loadOrders()}
          className="shrink-0 p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer"
        >
          <ArrowPathIcon className={`w-4 h-4 text-white/50 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-[#111] border border-white/5 rounded-lg p-1 mb-4 overflow-x-auto scrollbar-none">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setVendorFilter('') }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold font-inter whitespace-nowrap transition-colors cursor-pointer ${
              tab === t.key ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'
            }`}
          >
            {t.label}
            {t.badge && (
              <span className={`px-1.5 py-0.5 rounded-full text-[0.6rem] font-bold ${
                t.key === 'issues' ? 'bg-amber-500/20 text-amber-400' : 'bg-neon-pink/20 text-neon-pink'
              }`}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* By Vendor selector */}
      {tab === 'vendor' && (
        <div className="mb-4">
          <select
            value={vendorFilter}
            onChange={e => setVendorFilter(e.target.value)}
            className="w-full sm:w-64 bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm font-inter outline-none focus:border-neon-pink transition-colors cursor-pointer"
          >
            <option value="">All vendors</option>
            {vendors.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-5">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by order ID, customer, or vendor…"
          className="w-full bg-[#0f0f0f] border border-white/[0.07] rounded-xl pl-9 pr-9 py-2.5 text-white text-sm font-inter outline-none focus:border-white/20 transition-colors placeholder-white/20"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer">
            <XMarkIcon className="w-4 h-4 text-white/30 hover:text-white/60 transition-colors" />
          </button>
        )}
      </div>

      {/* Dispute alert */}
      {tab !== 'issues' && meta.disputeCount > 0 && (
        <button
          onClick={() => setTab('issues')}
          className="w-full mb-5 flex items-center gap-2 px-4 py-2.5 bg-amber-500/8 border border-amber-500/20 rounded-xl hover:bg-amber-500/12 transition-colors cursor-pointer text-left"
        >
          <ExclamationTriangleIcon className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-amber-400 text-sm font-semibold font-inter">
            {meta.disputeCount} open dispute{meta.disputeCount !== 1 ? 's' : ''} need attention →
          </span>
        </button>
      )}

      {/* Stats bar */}
      {tab === 'all' && !loading && orders.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          {([
            { icon: ClockIcon,            label: 'Live',           value: meta.pendingCount,   cls: 'text-amber-400' },
            { icon: CheckCircleIcon,      label: 'Loaded',         value: orders.length,       cls: 'text-white' },
            { icon: ExclamationTriangleIcon, label: 'Disputes',    value: meta.disputeCount,   cls: meta.disputeCount > 0 ? 'text-amber-400' : 'text-white/20' },
          ] as const).map(stat => (
            <div key={stat.label} className="bg-[#111] border border-white/[0.05] rounded-xl p-3 flex items-center gap-2">
              <stat.icon className={`w-4 h-4 ${stat.cls} shrink-0`} />
              <div>
                <p className={`text-sm font-inter font-semibold tabular-nums ${stat.cls}`}>{stat.value}</p>
                <p className="text-white/20 text-[0.6rem] uppercase tracking-wider font-semibold">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Order list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-[5.5rem] bg-white/[0.03] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-[#111] border border-white/[0.05] rounded-xl p-14 text-center">
          <p className="text-white/20 font-inter text-sm">
            {search
              ? `No orders match "${search}"`
              : tab === 'pending' ? 'No live orders right now'
              : tab === 'issues'  ? 'No issues — all clear'
              : 'No orders yet'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {visible.map(order => (
              <OrderRow key={order.id} order={order} onClick={() => setSelectedId(order.id)} />
            ))}
          </div>
          {nextCursor && !search && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-4 w-full py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 text-white/40 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              {loadingMore ? 'Loading…' : 'Load more orders'}
            </button>
          )}
        </>
      )}

      {/* Detail modal */}
      {selectedId && (
        <OrderModal
          orderId={selectedId}
          fairSlug={fairSlug}
          onClose={() => setSelectedId(null)}
          onDisputeResolved={handleDisputeResolved}
        />
      )}
    </div>
  )
}
