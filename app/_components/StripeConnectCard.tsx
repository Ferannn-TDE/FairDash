'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { CheckCircleIcon, ExclamationCircleIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import {
  deriveConnectCardState, needsLine, verifyingPoll, VERIFYING_COPY,
  type ConnectCardState, type ConnectStatusView,
} from '@/lib/connect-card-state'

// THE payout-setup card for every payee — vendor, runner and organizer (readiness 1.4). Give it
// the payee's API base path:
//   vendor    → /api/vendors/<id>/stripe
//   runner    → /api/runners/me/stripe
//   organizer → /api/organizer/stripe
// It reads status (GET basePath/status), and "set up" ensures an account exists (POST
// basePath/connect) then redirects to Stripe's hosted onboarding (POST basePath/onboarding-link).
// DESTINATIONS ONLY — it never moves money.
//
// Which of the four states to show is decided by lib/connect-card-state. While VERIFYING it polls
// on that module's schedule, asking for fresh (uncached) reads only for the first five minutes;
// the server honours ?fresh=1 only for the payee's owner and within a per-user limit.

const BUTTON = 'shrink-0 px-4 py-2.5 bg-[#FF0077] text-white rounded-xl text-sm font-semibold hover:bg-[#FF0077]/85 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'

/** Pure presentation of one state — server-renderable, so each state can be tested. */
export function ConnectCardView({
  state, needs, longWait = false, busy, onStart, description,
}: {
  state: ConnectCardState | 'loading'
  needs?: string
  longWait?: boolean
  busy: boolean
  onStart: () => void
  description: string
}) {
  if (state === 'loading') return <div className="h-14 bg-white/5 rounded-xl animate-pulse" />

  if (state === 'active') {
    return (
      <div className="flex items-center gap-3 p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
        <CheckCircleIcon className="w-4 h-4 text-emerald-400 shrink-0" />
        <div>
          <p className="text-white font-semibold text-sm">Payouts active</p>
          <p className="text-text-gray text-xs">Your Stripe account is verified and ready to receive payouts.</p>
        </div>
      </div>
    )
  }

  if (state === 'verifying') {
    return (
      <div className="flex items-center gap-3 p-4 bg-sky-500/5 border border-sky-500/20 rounded-xl" role="status" aria-live="polite">
        <ArrowPathIcon className="w-4 h-4 text-sky-300 shrink-0 animate-spin motion-reduce:animate-none" />
        <div>
          <p className="text-white font-semibold text-sm">{VERIFYING_COPY.title}</p>
          <p className="text-text-gray text-xs">{longWait ? VERIFYING_COPY.longWait : VERIFYING_COPY.body}</p>
        </div>
      </div>
    )
  }

  if (state === 'needs_info') {
    return (
      // min-w-0 at BOTH flex levels (the row's item and the icon+text item inside it), or the
      // text holds the old width open and the button wraps. Ported from the vendor settings copy.
      <div className="flex items-center justify-between gap-4 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
        <div className="flex items-start gap-3 min-w-0">
          <ExclamationCircleIcon className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm">{needs ?? needsLine([])}</p>
            <p className="text-text-gray text-xs">Payouts start once Stripe has this.</p>
          </div>
        </div>
        <button onClick={onStart} disabled={busy} className={BUTTON}>
          {busy ? 'Opening…' : 'Finish payout setup'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-white font-semibold text-sm mb-1">Set up payouts</p>
        <p className="text-text-gray text-xs">{description}</p>
      </div>
      <button onClick={onStart} disabled={busy} className={BUTTON}>
        {busy ? 'Opening…' : 'Set up payouts'}
      </button>
    </div>
  )
}

export default function StripeConnectCard({
  basePath,
  description = 'Connect a Stripe account to receive payouts from FairSynq.',
}: {
  basePath: string
  description?: string
}) {
  const [state, setState] = useState<ConnectCardState | 'loading'>('loading')
  const [needs, setNeeds] = useState<string | undefined>()
  const [longWait, setLongWait] = useState(false)
  const [busy, setBusy] = useState(false)
  const verifyingSince = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadStatus = useCallback(async (fresh = false) => {
    try {
      const json = await fetch(`${basePath}/status${fresh ? '?fresh=1' : ''}`).then(r => r.json())
      if (!json.success) { setState('not_connected'); return }
      const data = json.data as ConnectStatusView
      const next = deriveConnectCardState(data)
      setState(next)
      setNeeds(next === 'needs_info' ? needsLine(data.dueItems) : undefined)
    } catch {
      /* leave prior state; the next poll retries */
    }
  }, [basePath])

  // Poll only while verifying, on the shared schedule.
  useEffect(() => {
    if (state !== 'verifying') { verifyingSince.current = null; setLongWait(false); return }
    if (verifyingSince.current === null) verifyingSince.current = Date.now()
    const { delayMs, fresh, longWait: lw } = verifyingPoll(Date.now() - verifyingSince.current)
    setLongWait(lw)
    timer.current = setTimeout(() => { void loadStatus(fresh) }, delayMs)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [state, loadStatus, needs, longWait])

  // Ensure an account exists, then redirect to the hosted Stripe onboarding link.
  const startOnboarding = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const connect = await fetch(`${basePath}/connect`, { method: 'POST' }).then(r => r.json())
      if (!connect.success) { toast.error('Could not start payout setup'); return }
      const link = await fetch(`${basePath}/onboarding-link`, { method: 'POST' }).then(r => r.json())
      if (!link.success || !link.data?.url) { toast.error('Could not create onboarding link'); return }
      window.location.href = link.data.url
    } catch {
      toast.error('Network error — please try again')
    } finally {
      setBusy(false)
    }
  }, [basePath, busy])

  // Initial load; a fresh read on return from the hosted flow (?stripe=return).
  useEffect(() => {
    const returning = new URLSearchParams(window.location.search).get('stripe') === 'return'
    void loadStatus(returning)
  }, [loadStatus])

  return <ConnectCardView state={state} needs={needs} longWait={longWait} busy={busy} onStart={startOnboarding} description={description} />
}
