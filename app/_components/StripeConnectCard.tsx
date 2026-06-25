'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'

// Reusable Stripe Connect onboarding control for any payee type. The Connect
// helpers are payee-agnostic, so this card only needs the API base path:
//   runner    → /api/runners/me/stripe
//   organizer → /api/organizer/stripe
// It reads live status (GET basePath/status), and on "set up" ensures an account
// exists (POST basePath/connect) then redirects to the hosted onboarding link
// (POST basePath/onboarding-link). DESTINATIONS ONLY — it never moves money.

type StripeState = 'loading' | 'active' | 'incomplete' | 'not_connected'

export default function StripeConnectCard({
  basePath,
  description = 'Connect a Stripe account to receive payouts from FairSynq.',
}: {
  basePath: string
  description?: string
}) {
  const [state, setState] = useState<StripeState>('loading')
  const [busy, setBusy] = useState(false)

  const applyStatus = (data: { connected: boolean; readyToReceivePayments: boolean }) => {
    if (!data.connected) setState('not_connected')
    else if (data.readyToReceivePayments) setState('active')
    else setState('incomplete')
  }

  const loadStatus = useCallback(async () => {
    try {
      const json = await fetch(`${basePath}/status`).then(r => r.json())
      if (json.success) applyStatus(json.data)
      else setState('not_connected')
    } catch {
      /* leave prior state */
    }
  }, [basePath])

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

  // Initial load + re-read on return from the hosted flow (?stripe=return|refresh).
  useEffect(() => {
    loadStatus()
    const param = new URLSearchParams(window.location.search).get('stripe')
    if (param === 'return') toast.success('Returned from Stripe — checking status…')
  }, [loadStatus])

  if (state === 'loading') {
    return <div className="h-14 bg-white/5 rounded-xl animate-pulse" />
  }

  if (state === 'active') {
    return (
      <div className="flex items-center gap-3 p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
        <CheckCircleIcon className="w-4 h-4 text-emerald-400 shrink-0" />
        <div>
          <p className="text-white font-semibold text-sm">Payouts active — verified</p>
          <p className="text-text-gray text-xs">Your Stripe account is ready to receive payouts.</p>
        </div>
      </div>
    )
  }

  if (state === 'incomplete') {
    return (
      <div className="flex items-center justify-between gap-4 flex-wrap p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
        <div className="flex items-start gap-3">
          <ExclamationCircleIcon className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-white font-semibold text-sm">Payout setup unfinished</p>
            <p className="text-text-gray text-xs">Your account exists but onboarding isn&apos;t complete. Payouts are blocked until you finish.</p>
          </div>
        </div>
        <button
          onClick={startOnboarding}
          disabled={busy}
          className="px-4 py-2.5 bg-[#FF0077] text-white rounded-xl text-sm font-semibold hover:bg-[#FF0077]/85 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Opening…' : 'Finish payout setup'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <p className="text-white font-semibold text-sm mb-1">Set up payouts</p>
        <p className="text-text-gray text-xs">{description}</p>
      </div>
      <button
        onClick={startOnboarding}
        disabled={busy}
        className="px-4 py-2.5 bg-[#FF0077] text-white rounded-xl text-sm font-semibold hover:bg-[#FF0077]/85 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Opening…' : 'Set up payouts'}
      </button>
    </div>
  )
}
