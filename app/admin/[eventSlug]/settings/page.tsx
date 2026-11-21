'use client'

import { useState, useEffect, use, useCallback, useMemo } from 'react'
import { CheckCircleIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import DateRangePicker from '@/app/_components/ui/DateRangePicker'
import { editDateBounds } from '@/lib/calendar-date'
import { bpsToPercent, parseMarkupPercentInput } from '@/lib/menu/price'
import { onlineUnitPrice } from '@/lib/checkout-total'
import { adminErrorText } from '@/lib/admin-error-text'

/** The example item the markup preview prices: "On a $10.00 item, customers pay …". */
const MARKUP_EXAMPLE_PRICE = 10
import TaxRatesCard from '@/app/admin/_components/TaxRatesCard'

const INPUT = 'w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-inter outline-none focus:border-[#FF0077] transition-colors placeholder:text-[#444]'

interface Settings {
  slug: string
  name: string
  startDate: string
  endDate: string
  eventLat: number | null
  eventLng: number | null
  /** Online price markup, basis points 0–1000 (audit H5, 2h). */
  onlineMarkupBps: number
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-[0.6875rem] uppercase tracking-wide text-[#666] font-semibold mb-1.5 font-inter">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-[#555] font-inter">{hint}</p>}
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#111111] border border-white/5 rounded-xl p-5 sm:p-6">
      <h2 className="font-bebas text-xl text-white tracking-wide mb-5">{title}</h2>
      {children}
    </div>
  )
}

export default function AdminSettingsPage({ params: paramsPromise }: { params: Promise<{ eventSlug: string }> }) {
  const params = use(paramsPromise)

  // Real values, loaded from the API — never a mock/default. Until they load the form is
  // in a loading state; we NEVER render a guessed value that could later snap.
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [eventLat, setEventLat] = useState('')
  const [eventLng, setEventLng] = useState('')
  // Online price markup (audit H5, 2h): typed in percent, checked by parseMarkupPercentInput (never
  // clamped). savedMarkupBps is the server's value, so only a real change is sent (and logged).
  const [markupInput, setMarkupInput] = useState('')
  const [savedMarkupBps, setSavedMarkupBps] = useState(0)

  // Honest save states: idle | saving | saved | error. No fake "Saved!" that isn't a real
  // round-trip — 'saved' is set ONLY after the PATCH resolves and we adopt the re-read values.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [qrCopied, setQrCopied] = useState(false)

  const adopt = useCallback((s: Settings) => {
    setSlug(s.slug)
    setName(s.name)
    setStartDate(s.startDate)
    setEndDate(s.endDate)
    setEventLat(s.eventLat != null ? String(s.eventLat) : '')
    setEventLng(s.eventLng != null ? String(s.eventLng) : '')
    setSavedMarkupBps(s.onlineMarkupBps ?? 0)
    setMarkupInput(String(bpsToPercent(s.onlineMarkupBps ?? 0)))
  }, [])

  useEffect(() => {
    let active = true
    fetch(`/api/admin/events/${params.eventSlug}/settings`)
      .then(r => r.json().then(json => ({ status: r.status, json })))
      .then(({ status, json }) => {
        if (!active) return
        if (!json.success) { setLoadError(adminErrorText(status, json.error?.message ?? 'Failed to load settings')); return }
        adopt(json.data as Settings)
      })
      .catch(() => { if (active) setLoadError('Failed to load settings') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [params.eventSlug, adopt])

  // ⚠️ EDIT bounds, NOT creation bounds — they widen around the fair's existing dates so a
  // running or already-started fair stays editable. The rule and the no-lockout proof live in
  // lib/calendar-date + scripts/date-bounds-guard; do not inline a "today" floor here.
  //
  // ⚠️ AND IT LIVES UP HERE, ABOVE THE EARLY RETURNS, ON PURPOSE. It used to sit below
  // `if (loading) return …`, so the first render (loading) skipped it and the second (loaded)
  // ran it — React counted a different number of hooks between renders and threw "Rendered
  // more hooks than during the previous render", taking the whole page down for every admin on
  // every fair. Hooks must precede EVERY conditional return; scripts/settings-hooks-guard.ts
  // asserts that for this file. Safe to call before the fetch resolves: editDateBounds
  // tolerates empty strings (toPickerDate('') yields no date → today/horizon fallbacks).
  const { minDate, maxDate, defaultMonth } = useMemo(
    () => editDateBounds(startDate, endDate),
    [startDate, endDate],
  )

  const markupParse = parseMarkupPercentInput(markupInput)

  const handleSave = async () => {
    // An invalid markup (over 10%, below 0, not a number, too many decimals) blocks the WHOLE save:
    // nothing is clamped and nothing is half-saved.
    if (!markupParse.ok) {
      setSaveError(markupParse.message)
      setSaveState('error')
      return
    }
    const markupChanged = markupParse.bps !== savedMarkupBps
    setSaveState('saving')
    setSaveError(null)
    try {
      const res = await fetch(`/api/admin/events/${params.eventSlug}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          startDate,
          endDate,
          eventLat: eventLat.trim() === '' ? null : eventLat,
          eventLng: eventLng.trim() === '' ? null : eventLng,
          // Only a real change is sent; the server logs it (EventMarkupChange) in the same
          // transaction. Strict admins are not locked after the event starts.
          ...(markupChanged && { onlineMarkupBps: markupParse.bps }),
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(adminErrorText(res.status, json.error?.message ?? 'Save failed'))
      // Adopt the SERVER's re-read values as the new truth — not what we typed. If the server
      // normalised anything, the form now shows what actually persisted.
      adopt(json.data as Settings)
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
      setSaveState('error')
    }
  }

  const copyUrl = () => {
    // The REAL customer route is /fair/[fairSlug] — the old page copied /e/[slug], a dead
    // link. Copy the actual origin + real path so the button hands out something that works.
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    navigator.clipboard.writeText(`${origin}/fair/${slug}`).catch(() => {})
    setQrCopied(true)
    setTimeout(() => setQrCopied(false), 2000)
  }

  if (loading) return <div className="p-6 text-[#666] text-sm">Loading settings…</div>
  if (loadError) return <div className="p-6 text-red-400 text-sm">{loadError}</div>

  const saving = saveState === 'saving'


  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">Event Settings</h1>
          <p className="text-sm text-[#666] font-inter mt-1">{slug}</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60
            ${saveState === 'saved'
              ? 'bg-green-600/20 border border-green-600/30 text-green-400'
              : saveState === 'error'
                ? 'bg-red-600/20 border border-red-600/30 text-red-400'
                : 'bg-[#FF0077] text-white hover:bg-[#e0006b]'}`}
        >
          {saveState === 'saved' ? <><CheckCircleIcon className="w-4 h-4" /> Saved</>
            : saving ? 'Saving…'
            : saveState === 'error' ? 'Retry'
            : 'Save Changes'}
        </button>
      </div>

      {saveError && (
        <div className="mb-5 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-red-300 text-xs font-inter">{saveError}</p>
        </div>
      )}

      <div className="space-y-5">
        <SectionCard title="Event Details">
          <div className="space-y-4">
            <Field label="Event Name">
              <input type="text" value={name} onChange={e => setName(e.target.value)} className={INPUT} />
            </Field>
            {/* One range picker for both dates. Same 'YYYY-MM-DD' strings into the same
                state, so the PATCH body at :94 is byte-identical to what the native inputs
                sent — and the server's end<start check (admin-event-settings.ts:53) is now
                also unreachable by construction, since a range cannot be inverted. */}
            <Field label="Event Dates">
              <DateRangePicker
                value={{ start: startDate, end: endDate }}
                onChange={v => { setStartDate(v.start); setEndDate(v.end) }}
                minDate={minDate}
                maxDate={maxDate}
                defaultMonth={defaultMonth}
              />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Event Location">
          <div className="space-y-4">
            <p className="text-sm text-[#666] font-inter">Used for the customer-facing map pin and the Go Live checklist.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude">
                <input type="number" step="any" value={eventLat} onChange={e => setEventLat(e.target.value)} placeholder="39.7817" className={INPUT} />
              </Field>
              <Field label="Longitude">
                <input type="number" step="any" value={eventLng} onChange={e => setEventLng(e.target.value)} placeholder="-89.6501" className={INPUT} />
              </Field>
            </div>
          </div>
        </SectionCard>

        {/* No "Service Charge" card (C-7, item 10 stage 3): the old per-event charge is never applied to
            new orders. The columns and stored values stay; the API ignores them. */}

        <SectionCard title="Online Prices">
          <div className="space-y-3">
            <p className="text-sm text-[#666] font-inter">
              A markup added to every menu price for online orders. It goes to the vendors; FairSynq&apos;s service fee stays on the booth price.
            </p>
            <Field label="Online Price Markup (%)" hint="0% (online price = booth price) to 10%">
              <input
                type="text"
                inputMode="decimal"
                value={markupInput}
                onChange={e => setMarkupInput(e.target.value)}
                aria-invalid={!markupParse.ok}
                className={`${INPUT} max-w-xs ${markupParse.ok ? '' : 'border-red-500 focus:border-red-500'}`}
              />
            </Field>
            {!markupParse.ok ? (
              <p role="alert" className="text-xs text-red-400 font-inter">{markupParse.message}</p>
            ) : (
              <p className="text-xs text-[#888] font-inter">
                On a ${MARKUP_EXAMPLE_PRICE.toFixed(2)} item, customers pay{' '}
                <span className="text-white">${onlineUnitPrice(MARKUP_EXAMPLE_PRICE, markupParse.bps).toFixed(2)}</span> online.
              </p>
            )}
            <p className="text-xs text-[#555] font-inter">
              Every change is logged (who, old value, new value, when). FairSynq admins can change it at any time, including after the event has started; organizers cannot once it has started.
            </p>
          </div>
        </SectionCard>
        {/* B1.19: admin-only tax rates, saved on their own (reason required, logged). */}
        <TaxRatesCard eventSlug={params.eventSlug} />

        <SectionCard title="Customer Link">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-white font-inter mb-1">Customer ordering URL</p>
              <p className="text-xs text-[#666] font-inter font-mono truncate">/fair/{slug}</p>
            </div>
            <button
              onClick={copyUrl}
              className="flex items-center gap-2 px-4 py-2.5 bg-white/5 border border-white/10 text-white text-sm font-semibold rounded-xl hover:bg-white/10 transition-colors shrink-0"
            >
              {qrCopied ? <><CheckCircleIcon className="w-4 h-4 text-green-400" /> Copied!</> : <><ClipboardDocumentIcon className="w-4 h-4" /> Copy URL</>}
            </button>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
