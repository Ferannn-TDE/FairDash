'use client'

import { useState, useEffect, use, useCallback } from 'react'
import Link from 'next/link'
import { AlertTriangle, PackageX, PhoneCall, Store, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'

// ─── Admin STRANDED escalation ─────────────────────────────────────────────────
// The strand clocks (Pattern V) flag stuck custody; this surface shows the HANDLE next to each
// flag, never a bare list of problems. Each reason names a human action and this page presents
// it: CLAIMED → release (a button here); UNREACHABLE → the runner's contact + the refund route;
// AWAITING → which vendor + how long (the vendor resolves it on their own returns surface).
//   GET  /api/admin/events/[id]/stranded
//   POST /api/admin/events/[id]/orders/[orderId]/release

interface StrandedRow {
  orderId: string
  reason: 'CLAIMED_NOT_COLLECTED' | 'RUNNER_UNREACHABLE_WITH_FOOD' | 'AWAITING_VENDOR_CONFIRMATION'
  ageMin: number
  action: 'release' | 'refund' | 'await_vendor'
  runner: { id: string; name: string | null; phone: string | null } | null
  vendor: { id: string; name: string } | null
}

const REASON_LABEL: Record<StrandedRow['reason'], string> = {
  CLAIMED_NOT_COLLECTED: 'Claimed, not collected',
  RUNNER_UNREACHABLE_WITH_FOOD: 'Runner unreachable — has the food',
  AWAITING_VENDOR_CONFIRMATION: 'Awaiting vendor’s return confirm',
}
const REASON_ICON: Record<StrandedRow['reason'], React.ElementType> = {
  CLAIMED_NOT_COLLECTED: PackageX,
  RUNNER_UNREACHABLE_WITH_FOOD: PhoneCall,
  AWAITING_VENDOR_CONFIRMATION: Store,
}

export default function AdminStrandedPage({ params: paramsPromise }: { params: Promise<{ eventSlug: string }> }) {
  const params = use(paramsPromise)
  const [rows, setRows] = useState<StrandedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [releasing, setReleasing] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/events/${params.eventSlug}/stranded`)
      const json = await res.json()
      if (json.success) setRows(json.data.stranded)
    } catch { /* transient — the page can be refreshed */ } finally { setLoading(false) }
  }, [params.eventSlug])

  useEffect(() => { load() }, [load])

  async function release(orderId: string) {
    setReleasing(orderId)
    try {
      const res = await fetch(`/api/admin/events/${params.eventSlug}/orders/${orderId}/release`, { method: 'POST' })
      const json = await res.json()
      if (res.ok && json.success) { toast.success('Released back to the pool'); await load() }
      else toast.error(json.error || json.message || 'Could not release')
    } catch { toast.error('Network error — try again') } finally { setReleasing(null) }
  }

  if (loading) return <div className="max-w-[860px] mx-auto px-4 py-10 text-center text-text-gray text-sm">Loading…</div>

  return (
    <div className="max-w-[860px] mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-400" />
        <h1 className="text-white font-bebas text-2xl tracking-wide">Stranded orders</h1>
      </div>

      {rows.length === 0 ? (
        <div className="bg-bg-card border border-white/10 rounded-2xl p-8 text-center">
          <p className="text-emerald-400 font-semibold text-sm">Nothing stranded.</p>
          <p className="text-text-gray text-xs mt-1">The strand clocks are quiet — every collected order is moving.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(r => {
            const Icon = REASON_ICON[r.reason]
            return (
              <div key={r.orderId} className="bg-bg-card border border-white/10 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Icon className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-white font-semibold text-sm">{REASON_LABEL[r.reason]}</p>
                      <p className="text-text-gray text-xs mt-0.5">Order {r.orderId.slice(-8).toUpperCase()} · stranded {r.ageMin}m</p>
                      {/* The HANDLE — who acts, and how. */}
                      {r.action === 'release' && r.runner && (
                        <p className="text-text-gray text-xs mt-1">Runner {r.runner.name ?? '—'} is unresponsive; the food is still on the counter.</p>
                      )}
                      {r.action === 'refund' && r.runner && (
                        <p className="text-text-gray text-xs mt-1">
                          Runner {r.runner.name ?? '—'} has the food.
                          {r.runner.phone && <> Call <a href={`tel:${r.runner.phone}`} className="text-neon-pink hover:underline">{r.runner.phone}</a>.</>}
                          {' '}If unrecoverable, refund the customer.
                        </p>
                      )}
                      {r.action === 'await_vendor' && (
                        <p className="text-text-gray text-xs mt-1">Runner asked to return it; {r.vendor?.name ?? 'the vendor'} hasn’t confirmed. It resolves on the vendor’s returns screen.</p>
                      )}
                    </div>
                  </div>
                  {/* The ACTION button, per reason. */}
                  <div className="shrink-0">
                    {r.action === 'release' && (
                      <button onClick={() => release(r.orderId)} disabled={releasing === r.orderId}
                        className="text-xs font-semibold bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 hover:bg-white/10 disabled:opacity-50 cursor-pointer flex items-center gap-1.5">
                        <RotateCcw className="w-3.5 h-3.5" />{releasing === r.orderId ? 'Releasing…' : 'Release to pool'}
                      </button>
                    )}
                    {r.action === 'refund' && (
                      <Link href={`/admin/${params.eventSlug}/money`}
                        className="text-xs font-semibold bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 hover:bg-white/10 cursor-pointer inline-block">
                        Refund…
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
