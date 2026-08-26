'use client'

import { useEffect, useState, useCallback, useOptimistic } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  CheckCircleIcon,
  XCircleIcon,
  NoSymbolIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  PlusIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { getVendorStatusConfig } from '@/lib/order-status-config'
import ConfirmModal from '@/app/_components/ui/ConfirmModal'
import {
  docsCompleteFromPresence,
  VENDOR_DOC_LABELS,
  type RequiredVendorDoc,
} from '@/lib/vendor-documents'

// ─── Types ────────────────────────────────────────────────────────────────────

// The canonical presence map emitted by lib/fair-vendors.ts, keyed by the SSOT's
// document keys. No `insuranceExpired` — see lib/vendor-documents.ts for why the
// bar is presence-only.
type VendorDocs = Record<RequiredVendorDoc, boolean>

interface Vendor {
  id: string
  name: string
  slug: string
  status: string
  cuisineType: string
  boothNumber: string | null
  joinedAt: string
  stripeVerified: boolean
  stripeConnectedAt: string | null
  docs: VendorDocs
  isOffline: boolean
  isBusy: boolean
  orderCount: number
  ordersToday: number
  revenue: number
  ready: boolean
  availableMenuCount: number
}

type TabKey = 'ALL' | 'ACTIVE' | 'PENDING' | 'REJECTED_INACTIVE'

const TABS: { key: TabKey; label: string; statuses: string[] }[] = [
  { key: 'ALL',               label: 'All',              statuses: [] },
  { key: 'ACTIVE',            label: 'Approved',         statuses: ['ACTIVE'] },
  { key: 'PENDING',           label: 'Pending Approval', statuses: ['PENDING'] },
  { key: 'REJECTED_INACTIVE', label: 'Rejected / Inactive', statuses: ['REJECTED', 'PAUSED', 'SUSPENDED'] },
]

// ─── Doc icons ────────────────────────────────────────────────────────────────

function DocBadge({ present, label }: { present: boolean; label: string }) {
  if (!present) {
    return (
      <span title={`${label}: missing`} className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
        <DocumentTextIcon className="w-2.5 h-2.5 text-[#444]" />
      </span>
    )
  }
  return (
    <span title={`${label}: uploaded`} className="w-5 h-5 rounded-full bg-green-500/15 border border-green-500/20 flex items-center justify-center">
      <CheckCircleIcon className="w-2.5 h-2.5 text-green-400" />
    </span>
  )
}

// ─── Status pill (uses shared config) ────────────────────────────────────────

function VendorStatusPill({ status }: { status: string }) {
  const cfg = getVendorStatusConfig(status)
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${cfg.color} ${cfg.textColor} ${cfg.borderColor}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotColor}`} />
      {cfg.label}
    </span>
  )
}

// ─── Vendor card ──────────────────────────────────────────────────────────────

function VendorCard({
  vendor,
  fairSlug,
  onStatusChange,
  onRequestDeactivate,
  acting,
}: {
  vendor: Vendor
  fairSlug: string
  onStatusChange: (id: string, status: string) => void
  onRequestDeactivate: (vendor: Vendor) => void
  acting: string | null
}) {
  const isActing = acting === vendor.id
  // One definition of complete, shared with both approve gates and the checklist.
  // The old `|| insuranceExpired` term is gone: nothing has ever written
  // insuranceExpiryDate, so it was always false and never changed this verdict.
  const docsComplete = docsCompleteFromPresence(vendor.docs)
  const docsIssue = !docsComplete

  return (
    <div className="bg-[#111111] border border-white/[0.06] rounded-2xl p-5 hover:border-white/10 transition-all duration-200 group">
      {/* Top row: avatar + name + status */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[#FF0077]/10 flex items-center justify-center shrink-0">
          <span className="font-bebas text-[#FF0077] text-lg">{vendor.name[0]}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/organizer/fairs/${fairSlug}/vendors/${vendor.slug}`}
              className="text-sm font-semibold text-white font-inter hover:text-[#FF0077] transition-colors truncate"
            >
              {vendor.name}
            </Link>
            <VendorStatusPill status={vendor.status} />
          </div>
          <p className="text-xs text-[#555] font-inter mt-0.5 truncate">
            {vendor.cuisineType}
            {vendor.boothNumber && ` · Booth ${vendor.boothNumber}`}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-white/[0.03] rounded-lg p-2 text-center">
          <p className="font-bebas text-base text-white">{vendor.orderCount}</p>
          <p className="text-[9px] text-[#444] font-inter uppercase tracking-wider">Orders</p>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-2 text-center">
          <p className="font-bebas text-base text-white">{vendor.ordersToday}</p>
          <p className="text-[9px] text-[#444] font-inter uppercase tracking-wider">Today</p>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-2 text-center">
          <p className="font-bebas text-base text-white">${Math.round(vendor.revenue).toLocaleString()}</p>
          <p className="text-[9px] text-[#444] font-inter uppercase tracking-wider">Revenue</p>
        </div>
      </div>

      {/* Compliance row: docs + Stripe */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          <DocBadge present={vendor.docs.foodHandler}     label={VENDOR_DOC_LABELS.foodHandler} />
          <DocBadge present={vendor.docs.insurance}       label={VENDOR_DOC_LABELS.insurance} />
          <DocBadge present={vendor.docs.businessLicense} label={VENDOR_DOC_LABELS.businessLicense} />
        </div>
        <span className="text-[10px] text-[#444] font-inter">docs</span>

        <div className="ml-auto flex items-center gap-1.5">
          {vendor.stripeVerified ? (
            <span className="flex items-center gap-1 text-[10px] text-green-400 font-inter">
              <CheckCircleIcon className="w-3 h-3" /> Stripe
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-[#444] font-inter">
              <XCircleIcon className="w-3 h-3" /> No Stripe
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {vendor.status === 'PENDING' && (
          <>
            <button
              onClick={() => onStatusChange(vendor.id, 'ACTIVE')}
              disabled={isActing}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-green-500/30 text-green-400 hover:bg-green-500/10 text-xs font-semibold font-inter transition-colors disabled:opacity-40 cursor-pointer"
            >
              <CheckCircleIcon className="w-3.5 h-3.5 shrink-0" />
              Approve
            </button>
            <button
              onClick={() => onStatusChange(vendor.id, 'REJECTED')}
              disabled={isActing}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs font-semibold font-inter transition-colors disabled:opacity-40 cursor-pointer"
            >
              <XCircleIcon className="w-3.5 h-3.5 shrink-0" />
              Reject
            </button>
          </>
        )}
        {vendor.status === 'ACTIVE' && (
          <>
            <Link
              href={`/organizer/fairs/${fairSlug}/vendors/${vendor.slug}`}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-white/10 text-[#888] hover:bg-white/5 text-xs font-semibold font-inter transition-colors"
            >
              View Detail
            </Link>
            <button
              onClick={() => onRequestDeactivate(vendor)}
              disabled={isActing}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 text-xs font-semibold font-inter transition-colors disabled:opacity-40 cursor-pointer"
            >
              <NoSymbolIcon className="w-3.5 h-3.5 shrink-0" />
              Deactivate
            </button>
          </>
        )}
        {(vendor.status === 'REJECTED' || vendor.status === 'PAUSED' || vendor.status === 'SUSPENDED') && (
          <>
            <Link
              href={`/organizer/fairs/${fairSlug}/vendors/${vendor.slug}`}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-white/10 text-[#888] hover:bg-white/5 text-xs font-semibold font-inter transition-colors"
            >
              View Detail
            </Link>
            <button
              onClick={() => onStatusChange(vendor.id, 'ACTIVE')}
              disabled={isActing}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-green-500/30 text-green-400 hover:bg-green-500/10 text-xs font-semibold font-inter transition-colors disabled:opacity-40 cursor-pointer"
            >
              <ArrowPathIcon className="w-3.5 h-3.5 shrink-0" />
              Reconsider
            </button>
          </>
        )}
        {isActing && (
          <div className="flex items-center gap-1.5 text-[10px] text-[#555] font-inter ml-auto">
            <ArrowPathIcon className="w-3 h-3 animate-spin" />
            Updating…
          </div>
        )}
      </div>

      {/* Warnings */}
      {docsIssue && vendor.status !== 'PENDING' && (
        <p className="mt-3 text-[10px] text-orange-400/80 font-inter flex items-center gap-1">
          <ExclamationTriangleIcon className="w-3 h-3 shrink-0" />
          Documents incomplete
        </p>
      )}
    </div>
  )
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-[#111111] border border-white/[0.06] rounded-2xl p-5 animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-white/5 shrink-0" />
        <div>
          <div className="h-4 w-32 bg-white/5 rounded mb-1.5" />
          <div className="h-3 w-24 bg-white/5 rounded" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[0,1,2].map(i => <div key={i} className="h-10 bg-white/5 rounded-lg" />)}
      </div>
      <div className="h-8 bg-white/5 rounded-xl" />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VendorManagementPage() {
  const params = useParams<{ fairSlug: string }>()
  const { fairSlug } = params

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<Vendor | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('ALL')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/organizer/fairs/${fairSlug}/vendors`)
      const json = await res.json()
      if (json.data?.vendors) setVendors(json.data.vendors)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [fairSlug])

  useEffect(() => { void load() }, [load])

  const handleStatusChange = useCallback(async (vendorId: string, status: string) => {
    // Optimistic update
    setVendors(prev => prev.map(v => v.id === vendorId ? { ...v, status } : v))
    setActing(vendorId)
    try {
      const res  = await fetch(`/api/organizer/vendors/${vendorId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json()
      if (!json.data) {
        // Revert on failure
        void load()
        toast.error(json.error?.message ?? 'Action failed')
      } else {
        setVendors(prev => prev.map(v => v.id === vendorId ? { ...v, status: json.data.status } : v))
        const label = status === 'ACTIVE' ? 'approved' : status === 'REJECTED' ? 'rejected' : 'updated'
        toast.success(`Vendor ${label}`)
      }
    } catch {
      void load()
      toast.error('Action failed')
    } finally {
      setActing(null)
    }
  }, [load])

  // Tab filtering
  const tab = TABS.find(t => t.key === activeTab)!
  const filtered = tab.statuses.length === 0
    ? vendors
    : vendors.filter(v => tab.statuses.includes(v.status))

  const counts: Record<TabKey, number> = {
    ALL:               vendors.length,
    ACTIVE:            vendors.filter(v => v.status === 'ACTIVE').length,
    PENDING:           vendors.filter(v => v.status === 'PENDING').length,
    REJECTED_INACTIVE: vendors.filter(v => ['REJECTED', 'PAUSED', 'SUSPENDED'].includes(v.status)).length,
  }

  // Nudge: approved vendors who still can't receive orders (no Stripe / no menu).
  // Uses the same `ready` the customer gate reads, so it's never out of sync.
  const notReady = vendors.filter(v => v.status === 'ACTIVE' && !v.ready)

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">Vendors</h1>
          <p className="text-sm text-[#555] font-inter mt-1">
            {loading ? 'Loading…' : `${counts.ACTIVE} approved · ${counts.PENDING} pending`}
          </p>
        </div>
        <button className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#FF0077] text-white text-sm font-semibold rounded-lg hover:bg-[#e0006b] transition-colors whitespace-nowrap">
          <PlusIcon className="w-4 h-4" /> Invite Vendor
        </button>
      </div>

      {/* Readiness nudge — approved vendors customers can't order from yet. The
          organizer has the relationship to get them to connect before any gate. */}
      {!loading && notReady.length > 0 && (
        <div className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/25">
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-300">
              {notReady.length} of {counts.ACTIVE} approved vendor{notReady.length === 1 ? '' : 's'} aren&apos;t live yet
            </p>
            <p className="text-[#999] mt-0.5">
              They can&apos;t receive orders until they connect payouts and add a menu:{' '}
              <span className="text-white">{notReady.map(v => v.name).join(', ')}</span>. Nudge them to finish setup.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 bg-white/5 rounded-xl p-1 max-w-full overflow-x-auto scrollbar-none">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-inter whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === t.key ? 'bg-[#FF0077] text-white shadow-sm' : 'text-[#666] hover:text-white hover:bg-white/5'
            }`}
          >
            {t.label}
            {!loading && counts[t.key] > 0 && (
              <span className={`ml-1.5 ${activeTab === t.key ? 'opacity-70' : 'opacity-50'}`}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Pending banner */}
      {!loading && counts.PENDING > 0 && activeTab !== 'PENDING' && (
        <div
          onClick={() => setActiveTab('PENDING')}
          className="mb-5 flex items-center gap-3 px-4 py-3 bg-amber-500/8 border border-amber-500/20 rounded-xl cursor-pointer hover:bg-amber-500/12 transition-colors"
        >
          <ExclamationTriangleIcon className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-amber-400 text-sm font-inter font-medium">
            {counts.PENDING} vendor{counts.PENDING !== 1 ? 's' : ''} awaiting approval
          </p>
          <span className="ml-auto text-amber-400 text-xs font-inter">Review →</span>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#111111] border border-white/5 rounded-2xl p-12 text-center">
          <p className="text-[#555] font-inter text-sm">
            {activeTab === 'PENDING' ? 'No vendors awaiting approval.' :
             activeTab === 'ACTIVE'  ? 'No approved vendors yet.' :
                                       'No vendors in this category.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(vendor => (
            <VendorCard
              key={vendor.id}
              vendor={vendor}
              fairSlug={fairSlug}
              onStatusChange={handleStatusChange}
              onRequestDeactivate={setDeactivateTarget}
              acting={acting}
            />
          ))}
        </div>
      )}

      <ConfirmModal
        open={deactivateTarget !== null}
        variant="destructive"
        title="Deactivate this vendor?"
        message={`${deactivateTarget?.name ?? 'This vendor'} will stop receiving new orders and be hidden from the customer menu. Existing orders are unaffected. You can reactivate them anytime.`}
        confirmLabel="Deactivate"
        loading={acting !== null && acting === deactivateTarget?.id}
        onConfirm={async () => {
          if (!deactivateTarget) return
          const id = deactivateTarget.id
          await handleStatusChange(id, 'PAUSED')
          setDeactivateTarget(null)
        }}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  )
}
