'use client'

import { CheckIcon, XMarkIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { getVendorStatusConfig } from '@/lib/order-status-config'

// ── Doc badge ─────────────────────────────────────────────────────────────────

function DocBadge({
  label, present, expired,
}: { label: string; present: boolean; expired?: boolean }) {
  const cls = expired
    ? 'border-orange-400/30 text-orange-400'
    : present
    ? 'border-emerald-400/30 text-emerald-400'
    : 'border-white/10 text-white/20'

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[0.6rem] font-semibold font-inter ${cls}`}>
      {expired ? '⚠' : present ? '✓' : '–'} {label}
    </span>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VendorCardData {
  id: string
  name: string
  slug: string
  status: string
  cuisineType: string | null
  boothNumber: string | null
  joinedAt: string
  stripeVerified: boolean
  docs: {
    foodHandlerPermit: boolean
    insurance: boolean
    insuranceExpired: boolean
    businessLicense: boolean
  }
  isOffline: boolean
  isBusy: boolean
  orderCount: number
  ordersToday: number
  revenue: number
}

export interface VendorCardProps {
  vendor: VendorCardData
  fairSlug: string
  onApprove?: (id: string) => void
  onReject?: (id: string) => void
  onDeactivate?: (id: string) => void
  onReconsider?: (id: string) => void
}

export function VendorCard({
  vendor, fairSlug, onApprove, onReject, onDeactivate, onReconsider,
}: VendorCardProps) {
  const statusCfg = getVendorStatusConfig(vendor.status)
  const isPending   = vendor.status === 'PENDING'
  const isActive    = vendor.status === 'ACTIVE'
  const isInactive  = ['REJECTED', 'PAUSED', 'SUSPENDED'].includes(vendor.status)

  return (
    <div className="bg-[#111] border border-white/[0.07] rounded-2xl overflow-hidden hover:border-white/[0.12] transition-all duration-300">
      {/* Card header */}
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0 flex-1">
            <p className="text-white font-inter font-semibold text-sm truncate">{vendor.name}</p>
            <p className="text-white/35 text-xs font-inter mt-0.5">
              {[vendor.cuisineType, vendor.boothNumber ? `Booth ${vendor.boothNumber}` : null]
                .filter(Boolean).join(' · ')}
            </p>
          </div>
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[0.6rem] font-bold uppercase tracking-wider border ${statusCfg.color} ${statusCfg.textColor} ${statusCfg.borderColor}`}>
            {statusCfg.label}
          </span>
        </div>

        {/* Stats mini-grid */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            { label: 'Today',    value: vendor.ordersToday },
            { label: 'All time', value: vendor.orderCount },
            { label: 'Revenue',  value: `$${vendor.revenue.toFixed(0)}` },
          ].map(s => (
            <div key={s.label} className="bg-white/[0.03] rounded-lg p-2 text-center">
              <p className="text-white text-sm font-inter font-semibold tabular-nums">{s.value}</p>
              <p className="text-white/25 text-[0.6rem] uppercase tracking-wider font-semibold mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Doc + Stripe badges */}
        <div className="flex flex-wrap gap-1 mt-3">
          <DocBadge label="Food" present={vendor.docs.foodHandlerPermit} />
          <DocBadge label="Ins."  present={vendor.docs.insurance} expired={vendor.docs.insuranceExpired} />
          <DocBadge label="Biz"   present={vendor.docs.businessLicense} />
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[0.6rem] font-semibold font-inter ${
            vendor.stripeVerified
              ? 'border-emerald-400/30 text-emerald-400'
              : 'border-white/10 text-white/20'
          }`}>
            {vendor.stripeVerified ? '✓' : '–'} Stripe
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-4 pb-4 flex items-center gap-2">
        {isPending && (
          <>
            <button
              onClick={() => onApprove?.(vendor.id)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              <CheckIcon className="w-3.5 h-3.5" /> Approve
            </button>
            <button
              onClick={() => onReject?.(vendor.id)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              <XMarkIcon className="w-3.5 h-3.5" /> Reject
            </button>
          </>
        )}
        {isActive && (
          <>
            <a
              href={`/organizer/fairs/${fairSlug}/vendors/${vendor.id}`}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 text-white/70 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" /> View
            </a>
            <button
              onClick={() => onDeactivate?.(vendor.id)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 text-white/50 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Deactivate
            </button>
          </>
        )}
        {isInactive && (
          <>
            <a
              href={`/organizer/fairs/${fairSlug}/vendors/${vendor.id}`}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 text-white/70 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" /> View
            </a>
            <button
              onClick={() => onReconsider?.(vendor.id)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 text-sky-400 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Reconsider
            </button>
          </>
        )}
      </div>
    </div>
  )
}
