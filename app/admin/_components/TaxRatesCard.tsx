'use client'

// B1.19 — the admin-only "Sales tax" card on /admin/[eventSlug]/settings. Two optional rates (sales, local food &
// beverage), exact text (≤ 3 decimals, 0–15%), a REQUIRED reason, and the change log. Honest states: the values
// shown after Save are the server's re-read, never an optimistic echo. Organizers never see this card or its route.
import { useCallback, useEffect, useState } from 'react'
import { formatTaxRate, parseTaxRatePercent } from '@/lib/fees/tax'
import { adminErrorText } from '@/lib/admin-error-text'

const INPUT = 'w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-inter outline-none focus:border-[#FF0077] transition-colors placeholder:text-[#444]'

interface Change { id: string; part: string; oldValue: number | null; newValue: number | null; actorId: string; reason: string; createdAt: string }
interface Rates { salesTaxRateMilli: number | null; localTaxRateMilli: number | null; changes: Change[] }

const toInput = (milli: number | null) => (milli === null ? '' : formatTaxRate(milli).replace('%', ''))

export default function TaxRatesCard({ eventSlug }: { eventSlug: string }) {
  const [rates, setRates] = useState<Rates | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sales, setSales] = useState('')
  const [local, setLocal] = useState('')
  const [reason, setReason] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const adopt = useCallback((r: Rates) => {
    setRates(r)
    setSales(toInput(r.salesTaxRateMilli))
    setLocal(toInput(r.localTaxRateMilli))
  }, [])

  useEffect(() => {
    fetch(`/api/admin/events/${eventSlug}/tax`)
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (!res.ok || !json.success) throw new Error(adminErrorText(res.status, json.error?.message ?? 'Failed to load tax rates'))
        adopt(json.data)
      })
      .catch(e => setLoadError(String(e.message ?? e)))
  }, [eventSlug, adopt])

  const salesCheck = parseTaxRatePercent(sales), localCheck = parseTaxRatePercent(local)
  const dirty = !!rates && ((salesCheck.ok ? salesCheck.value : NaN) !== rates.salesTaxRateMilli || (localCheck.ok ? localCheck.value : NaN) !== rates.localTaxRateMilli)
  const canSave = dirty && salesCheck.ok && localCheck.ok && reason.trim().length > 0 && state !== 'saving'

  async function save() {
    setState('saving'); setError(null)
    try {
      const res = await fetch(`/api/admin/events/${eventSlug}/tax`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salesTaxRate: sales, localTaxRate: local, reason }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) throw new Error(adminErrorText(res.status, json.error?.message ?? 'Save failed'))
      adopt(json.data)
      setReason('')
      setState('saved')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setState('error')
    }
  }

  return (
    <div className="bg-[#111111] border border-white/5 rounded-xl p-5 sm:p-6">
      <h2 className="font-bebas text-xl text-white tracking-wide mb-2">Sales Tax</h2>
      <p className="text-sm text-[#666] font-inter mb-5">
        Charged on food only, per vendor, shown as one Tax line at checkout. Leave a rate empty to not charge it.
        New orders use the rates saved here; orders already placed never change.
      </p>
      {loadError && <p className="text-sm text-red-400 font-inter">{loadError}</p>}
      {!rates && !loadError && <div className="h-24 rounded-xl bg-white/5 animate-pulse" aria-hidden="true" />}
      {rates && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[0.6875rem] uppercase tracking-wide text-[#666] font-semibold mb-1.5 font-inter">Sales tax rate (%)</span>
              <input inputMode="decimal" value={sales} onChange={e => { setSales(e.target.value); setState('idle') }} placeholder="e.g. 8.35" className={INPUT} />
              {!salesCheck.ok && <span className="mt-1.5 block text-xs text-red-400 font-inter">{salesCheck.error}</span>}
            </label>
            <label className="block">
              <span className="block text-[0.6875rem] uppercase tracking-wide text-[#666] font-semibold mb-1.5 font-inter">Local food &amp; beverage tax (%)</span>
              <input inputMode="decimal" value={local} onChange={e => { setLocal(e.target.value); setState('idle') }} placeholder="e.g. 1" className={INPUT} />
              {!localCheck.ok && <span className="mt-1.5 block text-xs text-red-400 font-inter">{localCheck.error}</span>}
            </label>
          </div>
          <label className="block">
            <span className="block text-[0.6875rem] uppercase tracking-wide text-[#666] font-semibold mb-1.5 font-inter">Reason for the change (required)</span>
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Rates from the client for Collinsville" className={INPUT} />
          </label>
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={!canSave}
              className="px-5 py-2.5 bg-[#FF0077] text-white text-sm font-semibold rounded-xl hover:bg-[#e0006b] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {state === 'saving' ? 'Saving…' : 'Save tax rates'}
            </button>
            {state === 'saved' && <span className="text-sm text-green-400 font-inter">Saved</span>}
            {state === 'error' && error && <span className="text-sm text-red-400 font-inter">{error}</span>}
          </div>
          {rates.changes.length > 0 && (
            <div className="pt-2 border-t border-white/5">
              <p className="text-[0.6875rem] uppercase tracking-wide text-[#666] font-semibold mb-2 font-inter">Change log</p>
              <ul className="space-y-1.5">
                {rates.changes.map(c => (
                  <li key={c.id} className="text-xs text-[#888] font-inter">
                    {new Date(c.createdAt).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                    {c.part === 'sales' ? 'Sales tax' : 'Local tax'} {formatTaxRate(c.oldValue)} → {formatTaxRate(c.newValue)} · {c.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
