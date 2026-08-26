'use client'

import { useState, useEffect, useMemo, use } from 'react'
import { Store, AlertTriangle } from 'lucide-react'
import { VENDOR_DOC_LABELS, type RequiredVendorDoc } from '@/lib/vendor-documents'

// ─── Types (real /api/admin/events/[id]/vendors shape via getFairVendors) ──────

interface AdminVendor {
  id: string
  name: string
  status: string
  cuisineType: string | null
  boothNumber: string | null
  stripeVerified: boolean
  isOffline: boolean
  isBusy: boolean
  docs: Record<RequiredVendorDoc, boolean>
  orderCount: number
  ordersToday: number
  revenue: number
  ready: boolean
}

type FilterTab = 'all' | 'PENDING' | 'ACTIVE'

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:    'bg-green-500/15 text-green-400',
  PENDING:   'bg-yellow-500/15 text-yellow-400',
  INACTIVE:  'bg-white/5 text-[#888]',
  SUSPENDED: 'bg-red-500/15 text-red-400',
  REJECTED:  'bg-red-500/15 text-red-400',
}

/**
 * One readiness requirement. Shape carries the state as well as colour — a filled dot for met,
 * a hollow ring for missing — so the row is readable without relying on red-vs-green, and the
 * title spells it out for a screen reader. Four of these form the cluster an organizer scans
 * before a fair: can this vendor take money and serve customers on day one?
 */
function ReadyDot({ met, label, missingLabel }: { met: boolean; label: string; missingLabel?: string }) {
  return (
    <span
      title={met ? `${label}: yes` : `${missingLabel ?? label}: missing`}
      className={`inline-flex items-center gap-1.5 text-[11px] font-inter ${met ? 'text-[#9a9a9a]' : 'text-orange-300'}`}
    >
      <span
        aria-hidden
        className={`w-2 h-2 rounded-full shrink-0 ${met ? 'bg-emerald-400' : 'border border-orange-400/70 bg-transparent'}`}
      />
      {label}
    </span>
  )
}

export default function AdminVendorsPage({ params: paramsPromise }: { params: Promise<{ eventSlug: string }> }) {
  const params = use(paramsPromise)
  const [vendors, setVendors] = useState<AdminVendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<FilterTab>('all')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetch(`/api/admin/events/${params.eventSlug}/vendors?take=200`)
      .then(r => r.json())
      .then(json => {
        if (!active) return
        if (!json.success) { setError(json.error?.message ?? 'Failed to load vendors'); return }
        setVendors((json.data.vendors ?? []) as AdminVendor[])
      })
      .catch(() => { if (active) setError('Failed to load vendors') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [params.eventSlug])

  const filtered = useMemo(
    () => tab === 'all' ? vendors : vendors.filter(v => v.status === tab),
    [vendors, tab]
  )
  const pendingCount = vendors.filter(v => v.status === 'PENDING').length
  const activeCount  = vendors.filter(v => v.status === 'ACTIVE').length
  // `ready` is the server's shared predicate (lib/vendor-readiness — ACTIVE + Stripe verified
  // + at least one available menu item), not a local re-derivation. "Ready to take payment" is
  // the question this page exists to answer, so it leads.
  const readyCount   = vendors.filter(v => v.ready).length
  const noStripe     = vendors.filter(v => v.status === 'ACTIVE' && !v.stripeVerified).length

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">Vendors</h1>
          <p className="text-sm text-[#666] font-inter mt-1">
            {loading ? 'Loading…' : `${activeCount} approved · ${pendingCount} pending review`}
          </p>
        </div>
      </div>

      {/* ── Readiness summary: the one number an organizer needs before a fair ──
             Skeleton while loading — a count of 0 is a claim, not a placeholder. */}
      <div className="mb-6 bg-[#111111] border border-white/5 rounded-xl px-4 py-3">
        {loading ? (
          <div className="h-4 w-64 rounded bg-white/10 animate-pulse" aria-hidden />
        ) : (
          <p className="text-sm font-inter text-white">
            <span className="font-semibold tabular-nums">{readyCount}</span>
            <span className="text-[#888]"> of {vendors.length} ready to take payment</span>
            {noStripe > 0 && (
              <span className="text-[#888]">
                {' · '}
                <span className="text-orange-300 font-semibold tabular-nums">{noStripe}</span>
                {' approved '}{noStripe === 1 ? 'vendor has' : 'vendors have'} no Stripe account
              </span>
            )}
          </p>
        )}
        {!loading && readyCount < activeCount && (
          <p className="text-xs text-[#666] font-inter mt-1">
            A vendor is ready when they are approved, connected to Stripe, and have at least one
            available menu item. Until then customers can&rsquo;t order from them.
          </p>
        )}
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
      {error ? (
        <div className="bg-[#111111] border border-red-500/20 rounded-xl py-12 text-center">
          <AlertTriangle className="w-8 h-8 text-red-400/40 mx-auto mb-2" />
          <p className="text-white font-semibold text-sm mb-1">Couldn’t load vendors</p>
          <p className="text-[#666] text-xs">{error}</p>
        </div>
      ) : loading ? (
        <div className="bg-[#111111] border border-white/5 rounded-xl py-12 text-center">
          <Store className="w-8 h-8 text-white/10 mx-auto mb-2 animate-pulse" />
          <p className="text-[#666] text-xs">Loading vendors…</p>
        </div>
      ) : (
        <div className="bg-[#111111] rounded-xl border border-white/5 divide-y divide-white/5">
          {filtered.map(vendor => (
            <div key={vendor.id} className="flex items-center gap-4 p-4 hover:bg-white/[0.02] transition-colors">
              {/* ── Identity ─────────────────────────────────────────────── */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${vendor.ready ? 'bg-[#FF0077]/10' : 'bg-white/5'}`}>
                  <span className={`text-sm font-bebas ${vendor.ready ? 'text-[#FF0077]' : 'text-[#777]'}`}>{vendor.name[0]}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-inter font-medium text-white truncate">{vendor.name}</p>
                  <p className="text-xs text-[#666] font-inter truncate">
                    {[vendor.cuisineType, vendor.boothNumber && `Booth ${vendor.boothNumber}`].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
              </div>

              {/* ── Readiness cluster: the primary signal. Every requirement is listed
                     whether met or not, so a gap is a visible hollow dot rather than an
                     absent badge — missing must never look like "not applicable". ── */}
              <div className="hidden sm:grid grid-cols-2 gap-x-4 gap-y-1 shrink-0 w-52">
                <ReadyDot met={vendor.stripeVerified} label="Stripe" missingLabel="Stripe payouts" />
                <ReadyDot met={!vendor.isOffline && vendor.ready} label="Live" missingLabel="Live to customers" />
                <ReadyDot met={vendor.docs.foodHandler} label="Permit" missingLabel={VENDOR_DOC_LABELS.foodHandler} />
                <ReadyDot met={vendor.docs.insurance} label="Insurance" missingLabel={VENDOR_DOC_LABELS.insurance} />
                {/* Business licence was MISSING from this cluster while its comment above
                    claimed every requirement was listed. Adding it makes the gap visible. */}
                <ReadyDot met={vendor.docs.businessLicense} label="License" missingLabel={VENDOR_DOC_LABELS.businessLicense} />
              </div>

              {/* ── Revenue: secondary. Before the gates open every value here is $0.00,
                     so it must not out-shout the readiness cluster. ── */}
              <div className="hidden lg:block shrink-0 text-right w-24">
                <p className={`text-sm font-inter tabular-nums ${vendor.revenue > 0 ? 'text-white' : 'text-[#555]'}`}>
                  ${vendor.revenue.toFixed(2)}
                </p>
                <p className="text-[10px] text-[#555] font-inter">{vendor.orderCount} orders</p>
              </div>

              {/* ── Approval status: last. ── */}
              <div className="shrink-0 w-20 text-right">
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${STATUS_STYLES[vendor.status] ?? STATUS_STYLES.INACTIVE}`}>
                  {vendor.status}
                </span>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm text-[#555] font-inter">No vendors in this category.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
