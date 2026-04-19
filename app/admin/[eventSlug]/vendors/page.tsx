'use client'

import { useState } from 'react'
import {
  CheckCircleIcon,
  XCircleIcon,
  DocumentTextIcon,
  EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline'
import { mockAdminVendors } from '@/lib/mock/admin'

type FilterTab = 'all' | 'PENDING' | 'ACTIVE'
type AdminVendor = Omit<typeof mockAdminVendors[0], 'status'> & { status: string }

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:   'bg-green-500/15 text-green-400',
  PENDING:  'bg-yellow-500/15 text-yellow-400',
  INACTIVE: 'bg-white/5 text-[#888]',
  REJECTED: 'bg-red-500/15 text-red-400',
}

function DocBadge({ url, label }: { url: string | null; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase
      ${url ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
      <DocumentTextIcon className="w-3 h-3" />
      {label}
    </span>
  )
}

// ─── Approve/Reject modal ─────────────────────────────────────────────────────

function ReviewModal({
  vendor,
  onApprove,
  onReject,
  onClose,
}: {
  vendor: AdminVendor
  onApprove: () => void
  onReject: (reason: string) => void
  onClose: () => void
}) {
  const [rejectMode, setRejectMode] = useState(false)
  const [reason, setReason] = useState('')

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-[#161616] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-6 border-b border-white/5">
          <h2 className="font-bebas text-2xl text-white tracking-wide">Review Vendor</h2>
          <p className="text-sm text-[#666] font-inter mt-1">{vendor.name}</p>
        </div>
        <div className="p-6 space-y-4">
          {/* Documents */}
          <div>
            <p className="text-xs text-[#555] font-inter uppercase tracking-wider mb-2">Documents</p>
            <div className="flex items-center gap-2 flex-wrap">
              <DocBadge url={vendor.foodHandlerPermitUrl} label="Food Permit" />
              <DocBadge url={vendor.insuranceUrl} label="Insurance" />
            </div>
          </div>

          {/* Stripe */}
          <div>
            <p className="text-xs text-[#555] font-inter uppercase tracking-wider mb-2">Payments</p>
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase
              ${vendor.stripeVerified ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-400'}`}>
              {vendor.stripeVerified ? 'Stripe Verified' : 'Stripe Not Verified'}
            </span>
          </div>

          {/* Booth */}
          <div>
            <p className="text-xs text-[#555] font-inter uppercase tracking-wider mb-1">Booth Number</p>
            <p className="text-sm text-white font-inter">{vendor.boothNumber || '— not assigned —'}</p>
          </div>

          {/* Reject reason input */}
          {rejectMode && (
            <div>
              <p className="text-xs text-[#555] font-inter uppercase tracking-wider mb-2">Reason for Rejection</p>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Explain why the application is being rejected..."
                rows={3}
                className="w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-inter outline-none focus:border-[#FF0077] transition-colors resize-none placeholder:text-[#444]"
              />
            </div>
          )}
        </div>
        <div className="p-6 pt-0 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm font-semibold text-white hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          {!rejectMode ? (
            <>
              <button
                onClick={() => setRejectMode(true)}
                className="flex-1 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-semibold hover:bg-red-500/20 transition-colors"
              >
                Reject
              </button>
              <button
                onClick={onApprove}
                className="flex-1 py-2.5 rounded-xl bg-[#FF0077] text-white text-sm font-semibold hover:bg-[#e0006b] transition-colors"
              >
                Approve
              </button>
            </>
          ) : (
            <button
              onClick={() => onReject(reason)}
              disabled={!reason.trim()}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors
                ${reason.trim()
                  ? 'bg-red-600 text-white hover:bg-red-500'
                  : 'bg-white/5 text-[#555] cursor-not-allowed'
                }`}
            >
              Confirm Reject
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminVendorsPage() {
  const [tab, setTab] = useState<FilterTab>('all')
  const [vendors, setVendors] = useState<AdminVendor[]>(mockAdminVendors)
  const [reviewing, setReviewing] = useState<AdminVendor | null>(null)

  const filtered = tab === 'all' ? vendors : vendors.filter(v => v.status === tab)
  const pendingCount = vendors.filter(v => v.status === 'PENDING').length

  const handleApprove = (id: string) => {
    setVendors(vs => vs.map(v => v.id === id ? { ...v, status: 'ACTIVE' } : v))
    setReviewing(null)
  }

  const handleReject = (id: string, _reason: string) => {
    setVendors(vs => vs.filter(v => v.id !== id))
    setReviewing(null)
  }

  return (
    <>
      {reviewing && (
        <ReviewModal
          vendor={reviewing}
          onApprove={() => handleApprove(reviewing.id)}
          onReject={reason => handleReject(reviewing.id, reason)}
          onClose={() => setReviewing(null)}
        />
      )}

      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="font-bebas text-3xl text-white tracking-wide">Vendors</h1>
            <p className="text-sm text-[#666] font-inter mt-1">
              {vendors.filter(v => v.status === 'ACTIVE').length} active
              {pendingCount > 0 && (
                <span className="ml-2 px-1.5 py-0.5 bg-yellow-500/15 text-yellow-400 text-[10px] font-semibold rounded">
                  {pendingCount} pending review
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 bg-white/5 rounded-lg p-1 w-fit">
          {(['all', 'PENDING', 'ACTIVE'] as FilterTab[]).map(key => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold font-inter whitespace-nowrap transition-colors
                ${tab === key ? 'bg-[#FF0077] text-white' : 'text-[#888] hover:text-white'}`}
            >
              {key === 'all' ? 'All' : key.charAt(0) + key.slice(1).toLowerCase()}
              <span className="ml-1 opacity-60">
                {key === 'all' ? vendors.length : vendors.filter(v => v.status === key).length}
              </span>
            </button>
          ))}
        </div>

        {/* Vendor list */}
        <div className="bg-[#111111] rounded-xl border border-white/5 divide-y divide-white/5">
          {filtered.map(vendor => (
            <div key={vendor.id} className="flex items-center justify-between gap-3 p-4 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-lg bg-[#FF0077]/10 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bebas text-[#FF0077]">{vendor.name[0]}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-inter font-medium text-white truncate">{vendor.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-[#666] font-inter">{vendor.cuisineType}</span>
                    {vendor.boothNumber && (
                      <span className="text-xs text-[#555] font-inter">· Booth {vendor.boothNumber}</span>
                    )}
                    <DocBadge url={vendor.foodHandlerPermitUrl} label="Permit" />
                    <DocBadge url={vendor.insuranceUrl} label="Insurance" />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${STATUS_STYLES[vendor.status]}`}>
                  {vendor.status}
                </span>
                {vendor.stripeVerified
                  ? <span className="hidden sm:inline px-2 py-0.5 bg-green-500/15 text-green-400 text-[10px] font-semibold rounded uppercase">Stripe ✓</span>
                  : <span className="hidden sm:inline px-2 py-0.5 bg-white/5 text-[#555] text-[10px] font-semibold rounded uppercase">No Stripe</span>
                }
              </div>

              {/* Actions */}
              {vendor.status === 'PENDING' ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleApprove(vendor.id)}
                    className="p-1.5 rounded-lg bg-green-500/10 hover:bg-green-500/20 transition-colors"
                    title="Approve"
                  >
                    <CheckCircleIcon className="w-4 h-4 text-green-400" />
                  </button>
                  <button
                    onClick={() => setReviewing(vendor)}
                    className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors"
                    title="Review & Reject"
                  >
                    <XCircleIcon className="w-4 h-4 text-red-400" />
                  </button>
                  <button
                    onClick={() => setReviewing(vendor)}
                    className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                    title="Review"
                  >
                    <EllipsisHorizontalIcon className="w-4 h-4 text-[#666]" />
                  </button>
                </div>
              ) : (
                <button className="p-1.5 rounded-lg hover:bg-white/5 transition-colors shrink-0">
                  <EllipsisHorizontalIcon className="w-4 h-4 text-[#666]" />
                </button>
              )}
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm text-[#555] font-inter">No vendors in this category.</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
