'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Vendor readiness checklist — a GUIDE, not a workshop.
//
// It READS GET /api/vendors/[id]/readiness (the single source of truth) and ROUTES
// each incomplete step to its REAL existing page (Stripe → settings, menu → menu).
// NO setup happens here: there is no Stripe-connect call, no menu mutation, no
// upload — the vendor leaves, does the real work on the real page, returns, and the
// checklist re-reads readiness (on focus) and reflects it. The visual shell is
// reused from the old mock wizard; all of its fake internals are gone.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Clock, CreditCard, UtensilsCrossed, MapPin, ChevronRight, AlertCircle, Loader2, FileText } from 'lucide-react'
import { useVendorMeta } from '@/lib/contexts/VendorContext'

interface ReadinessStep {
  key: 'application' | 'documents' | 'stripe' | 'menu' | 'booth'
  label: string
  done: boolean
  required: boolean
  waiting?: boolean
  route: string | null
}
interface Readiness {
  vendorId: string
  fairSlug: string
  status: string
  approved: boolean
  pending: boolean
  rejected: boolean
  stripeConnected: boolean
  hasAvailableMenu: boolean
  availableMenuCount: number
  boothSet: boolean
  ready: boolean
  steps: ReadinessStep[]
}

const STEP_META: Record<ReadinessStep['key'], { icon: typeof Check; blurb: string }> = {
  application: { icon: Check,            blurb: 'Your application to this fair.' },
  documents:   { icon: FileText,         blurb: 'Required before the organizer can approve you.' },
  stripe:      { icon: CreditCard,       blurb: 'Connect Stripe so we can pay you out after each event.' },
  menu:        { icon: UtensilsCrossed,  blurb: 'Add at least one available item so customers can order.' },
  booth:       { icon: MapPin,           blurb: 'Optional — helps runners and customers find you.' },
}

export default function VendorOnboardingChecklist() {
  const { vendorId, vendorName } = useVendorMeta()
  const [data, setData] = useState<Readiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!vendorId) return
    try {
      const res = await fetch(`/api/vendors/${vendorId}/readiness`, { cache: 'no-store' })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? 'Failed to load setup status'); return }
      setData(json.data as Readiness)
      setError(null)
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }, [vendorId])

  // Initial load + re-read on return/focus so completing a step (connecting Stripe,
  // adding an item on the real page) flips it to ✅ without a manual refresh.
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onFocus = () => load()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  const requiredSteps = data?.steps.filter(s => s.required) ?? []
  const doneRequired = requiredSteps.filter(s => s.done).length

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="font-bebas text-3xl text-white tracking-wide">Get set up to sell</h1>
          <p className="text-sm text-gray-500 mt-1">
            {vendorName ? `${vendorName} — ` : ''}finish these steps and customers can order from you at this fair.
          </p>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> <span className="text-sm">Loading your setup…</span>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex items-start gap-2 p-4 bg-red-500/5 border border-red-500/15 rounded-xl">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {!loading && data && (
          <>
            {/* Live banner */}
            {data.ready ? (
              <div className="mb-6 flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-2xl">
                <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                  <Check className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-green-400">You&apos;re live 🎉</p>
                  <p className="text-xs text-gray-500">Customers can order from you now. Manage everything from your dashboard.</p>
                </div>
              </div>
            ) : (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Setup progress</span>
                  <span className="text-xs font-bold text-white">{doneRequired} of {requiredSteps.length}</span>
                </div>
                <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#FF0077] rounded-full transition-all duration-500"
                    style={{ width: `${requiredSteps.length ? (doneRequired / requiredSteps.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            {/* Step cards */}
            <div className="space-y-3">
              {data.steps.map(step => {
                const Icon = STEP_META[step.key].icon
                const isWaiting = !step.done && step.waiting
                const isRejected = step.key === 'application' && data.rejected

                return (
                  <div
                    key={step.key}
                    className="bg-[#111111] border border-white/[0.06] rounded-2xl p-4 sm:p-5 flex items-center gap-4"
                  >
                    {/* Status icon */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border
                      ${step.done ? 'bg-green-500/15 border-green-500/30'
                      : isRejected ? 'bg-red-500/10 border-red-500/25'
                      : isWaiting ? 'bg-amber-500/10 border-amber-500/25'
                      : 'bg-white/[0.03] border-white/[0.08]'}`}>
                      {step.done ? <Check className="w-5 h-5 text-green-400" />
                        : isRejected ? <AlertCircle className="w-5 h-5 text-red-400" />
                        : isWaiting ? <Clock className="w-5 h-5 text-amber-400" />
                        : <Icon className="w-5 h-5 text-gray-500" />}
                    </div>

                    {/* Label + blurb */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium ${step.done ? 'text-white' : 'text-gray-200'}`}>{step.label}</p>
                        {!step.required && <span className="text-[10px] uppercase tracking-wider text-gray-600 border border-white/[0.08] rounded px-1.5 py-0.5">Optional</span>}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {isRejected ? 'Your application was not approved — contact the organizer.'
                          : isWaiting ? 'Submitted — under review by the organizer.'
                          : step.key === 'menu' && step.done ? `${data.availableMenuCount} available item${data.availableMenuCount === 1 ? '' : 's'}.`
                          : STEP_META[step.key].blurb}
                      </p>
                    </div>

                    {/* Action — routes to the REAL page; no setup happens here */}
                    <div className="shrink-0">
                      {step.done ? (
                        <span className="text-xs text-green-400 font-medium hidden sm:inline">Done</span>
                      ) : isWaiting || isRejected || !step.route ? (
                        <span className="text-xs text-gray-600">—</span>
                      ) : (
                        <Link
                          href={step.route}
                          className="inline-flex items-center gap-1 px-3 py-2 bg-[#FF0077] text-white text-xs font-semibold rounded-xl hover:bg-[#FF0077]/85 transition-colors no-underline"
                        >
                          {step.key === 'stripe' ? 'Connect'
                            : step.key === 'menu' ? 'Add menu'
                            : step.key === 'documents' ? 'Upload'
                            : 'Set up'}
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer link to dashboard */}
            <div className="mt-6 text-center">
              <Link href={`/vendor/${data.fairSlug}/dashboard`} className="text-sm text-gray-500 hover:text-white transition-colors">
                Go to dashboard →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
