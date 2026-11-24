'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { History } from 'lucide-react'
import { bpsToText, centsToText } from '@/lib/money-input'
import { BANNER_MAX_CHARS } from '@/lib/homepage-copy-rules'

// /admin/settings panel (Batch 1 item 5). One card per setting with its own Save and an optional
// reason; the change log underneath. Loading renders skeletons, never placeholder values
// (flicker-class rule). A 409 keeps what you typed and shows the value someone else saved.
// MONEY cards (fees.*, item 10 stage 2): a required reason, never cleared, the stored cents/bps shown
// as editable text; read-only for platform_manager ("Only an admin can change fees.").

interface SettingView {
  key: string
  label: string
  help: string
  class: 'ops' | 'content' | 'money'
  notInEffect: string | null
  value: unknown
  display: string
  isSet: boolean
  version: string
  updatedAt: string | null
}

interface SettingChangeView {
  id: string
  label: string
  from: string
  to: string
  actor: string
  actorType: string
  reason: string | null
  createdAt: string
}

const toInput = (value: unknown) =>
  Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : ''

// A money value as the admin edits it: bps as a percent, cents as dollars, the card choice as-is.
function moneyToInput(key: string, value: unknown): string {
  if (typeof value === 'number') return key === 'fees.serviceFee.percentBps' ? bpsToText(value) : centsToText(value)
  return typeof value === 'string' ? value : ''
}
const CARD_FEE_CHOICES = [{ value: 'VENDOR', label: 'Vendor pays' }, { value: 'PLATFORM', label: 'FairSynq pays' }]

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const inputCls =
  'w-full bg-[#0F0F0F] border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40 disabled:opacity-50'
const labelCls = 'text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5 block'

interface DeliveryEvent { name: string; slug: string }

function SettingCard({ setting, onSaved, deliveryEventsOn, viewerRole }: { setting: SettingView; onSaved: () => void; deliveryEventsOn: DeliveryEvent[]; viewerRole: string | null }) {
  const isSwitch = typeof setting.value === 'boolean'
  const isMoney = setting.class === 'money'
  const isChoice = setting.key === 'fees.cardFeesPaidBy'
  // Only the delivery switch asks before turning on (it lists the events that start offering
  // delivery). Every other switch, e.g. the homepage banner, saves straight away.
  const confirmBeforeOn = setting.key === 'delivery.enabled'
  const maxLength = setting.key === 'homepage.vendorBanner.text' ? BANNER_MAX_CHARS : undefined
  // The server refuses platform_manager on money keys (403); the card says so up front.
  const readOnly = isMoney && viewerRole !== 'admin' && viewerRole !== 'super_admin'
  const asInput = (v: unknown) => (isMoney ? moneyToInput(setting.key, v) : toInput(v))
  // Turning delivery ON is a two-step action: show which events start offering it, then confirm.
  const [confirmingOn, setConfirmingOn] = useState(false)
  const [draft, setDraft] = useState(asInput(setting.value))
  const [reason, setReason] = useState('')
  const [version, setVersion] = useState(setting.version)
  const [saving, setSaving] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<SettingView | null>(null)

  // A fresh load (after any save) re-seeds the card, except while a conflict is on screen:
  // then the typed value stays put so it can be re-applied.
  useEffect(() => {
    if (conflict) return
    setDraft(asInput(setting.value))
    setVersion(setting.version)
  }, [setting.value, setting.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (valueOverride?: unknown) => {
    setSaving(true)
    setFieldError(null)
    setReasonError(null)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: setting.key, value: valueOverride !== undefined ? valueOverride : draft, expectedVersion: version, reason }),
      })
      const json = await res.json()
      if (res.status === 409) {
        const current = json.error?.details?.current as SettingView | undefined
        setConflict(current ?? null)
        if (current) setVersion(current.version) // the next Save re-applies over what's there now
        return
      }
      if (!json.success) {
        const fe = json.error?.details?.fieldErrors
        if (fe?.reason) setReasonError(fe.reason)
        else setFieldError(fe?.[setting.key] ?? json.error?.message ?? 'Save failed')
        return
      }
      setConflict(null)
      setConfirmingOn(false)
      setReason('')
      const outcome = json.data.outcome as 'saved' | 'cleared' | 'unchanged'
      toast.success(outcome === 'unchanged' ? 'No change to save' : outcome === 'cleared' ? `${setting.label} cleared` : `${setting.label} saved`)
      onSaved()
    } catch {
      toast.error('Could not reach the server. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
        <h3 className="text-white font-semibold">{setting.label}</h3>
        {setting.notInEffect && (
          <span className="text-[0.6875rem] font-semibold text-amber-300 bg-amber-400/10 border border-amber-400/20 rounded-full px-2.5 py-0.5">
            {setting.notInEffect}
          </span>
        )}
      </div>
      <p className="text-text-gray text-xs leading-relaxed mb-4">{setting.help}</p>

      {conflict && (
        <div role="alert" className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs text-amber-200 leading-relaxed">
          Changed by someone else since you opened this page. It is now{' '}
          <strong className="text-white">{conflict.display}</strong>. Your value is still in the field:
          press Save again to replace it, or reload to keep theirs.
        </div>
      )}

      {isSwitch ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[#0F0F0F] border border-white/10 px-4 py-3">
          <span className="text-sm font-semibold text-white">{setting.value ? 'On' : 'Off'}</span>
          <button
            type="button"
            role="switch"
            aria-checked={setting.value === true}
            disabled={saving}
            onClick={() => (setting.value ? save(false) : confirmBeforeOn ? setConfirmingOn(true) : save(true))}
            className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer border-0 shrink-0 disabled:opacity-50 ${setting.value ? 'bg-neon-pink' : 'bg-white/10'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${setting.value ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      ) : isChoice ? (
        <>
          <label className={labelCls} htmlFor={`setting-${setting.key}`}>Value</label>
          <select
            id={`setting-${setting.key}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving || readOnly}
            aria-invalid={!!fieldError}
            className={`${inputCls} ${fieldError ? 'border-red-500/70 focus:border-red-500' : ''}`}
          >
            {CARD_FEE_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </>
      ) : (
        <>
          <label className={labelCls} htmlFor={`setting-${setting.key}`}>
            {isMoney ? (setting.key === 'fees.serviceFee.percentBps' ? 'Percent' : 'Dollars') : 'Value'}
          </label>
          <input
            id={`setting-${setting.key}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving || readOnly}
            inputMode={isMoney ? 'decimal' : undefined}
            maxLength={maxLength}
            placeholder={isMoney ? '' : 'Not set'}
            aria-invalid={!!fieldError}
            className={`${inputCls} ${fieldError ? 'border-red-500/70 focus:border-red-500' : ''}`}
          />
        </>
      )}
      {fieldError && <p className="mt-1.5 text-xs text-red-400">{fieldError}</p>}

      {isSwitch && confirmBeforeOn && confirmingOn && (
        <div role="alert" className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs text-amber-100 leading-relaxed">
          {deliveryEventsOn.length === 0 ? (
            <p>No event has home delivery switched on, so nothing changes for customers until an event turns it on.</p>
          ) : (
            <>
              <p className="mb-2">
                {deliveryEventsOn.length === 1 ? 'This event already has' : `These ${deliveryEventsOn.length} events already have`} delivery switched
                on and will start offering it immediately:
              </p>
              <ul className="list-disc pl-5 space-y-0.5 text-white">
                {deliveryEventsOn.map(e => <li key={e.slug}>{e.name}</li>)}
              </ul>
            </>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => save(true)} disabled={saving}
              className="px-4 py-2 rounded-xl bg-neon-pink text-white text-xs font-semibold border-0 cursor-pointer disabled:opacity-50">
              Turn on delivery
            </button>
            <button type="button" onClick={() => setConfirmingOn(false)} disabled={saving}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-semibold cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      )}

      {readOnly ? (
        <p className="mt-4 text-xs text-text-gray">Only an admin can change fees.</p>
      ) : (
        <>
          <label className={`${labelCls} mt-4`} htmlFor={`reason-${setting.key}`}>{isMoney ? 'Reason (required)' : 'Reason (optional)'}</label>
          <input
            id={`reason-${setting.key}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={saving}
            placeholder="Why the change, for the log"
            aria-invalid={!!reasonError}
            className={`${inputCls} ${reasonError ? 'border-red-500/70 focus:border-red-500' : ''}`}
          />
          {reasonError && <p className="mt-1.5 text-xs text-red-400">{reasonError}</p>}
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.6875rem] text-text-gray">
          {setting.isSet && setting.updatedAt ? `Last changed ${fmtTime(setting.updatedAt)}` : isSwitch ? 'Using the default' : 'Not set'}
          {!isSwitch && !isMoney && <>{' · '}Clear the field and save to remove it.</>}
          {isMoney && <>{' · '}A change applies only to orders placed after it.</>}
        </p>
        {!isSwitch && !readOnly && <button
          type="button"
          onClick={() => save()}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-neon-pink text-white text-sm font-semibold hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors cursor-pointer border-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>}
      </div>
    </div>
  )
}

export default function PlatformSettingsPanel() {
  const [data, setData] = useState<{ settings: SettingView[]; changes: SettingChangeView[]; deliveryEventsOn?: DeliveryEvent[]; viewerRole?: string } | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings', { cache: 'no-store' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message)
      setData(json.data)
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-bebas text-4xl sm:text-5xl text-white tracking-wide">Platform settings</h1>
        <p className="text-text-gray text-sm mt-1">Settings that apply to every fair. Each change is logged below.</p>
      </div>

      {error && !data && (
        <div className="bg-bg-card border border-white/10 rounded-2xl p-6 text-sm text-text-gray">
          Couldn&apos;t load settings.{' '}
          <button type="button" onClick={load} className="text-neon-pink font-semibold bg-transparent border-0 cursor-pointer">Try again</button>
        </div>
      )}

      {!data && !error && (
        <div className="space-y-4" aria-hidden="true">
          {[0, 1].map((i) => <div key={i} className="h-64 bg-bg-card border border-white/10 rounded-2xl animate-pulse" />)}
        </div>
      )}

      {data && (
        <>
          <div className="space-y-4">
            {data.settings.map((s) => <SettingCard key={s.key} setting={s} onSaved={load} deliveryEventsOn={data.deliveryEventsOn ?? []} viewerRole={data.viewerRole ?? null} />)}
          </div>

          <section className="mt-10">
            <h2 className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold flex items-center gap-2 mb-3">
              <History className="w-3.5 h-3.5" /> Change log (latest 50)
            </h2>
            {data.changes.length === 0 ? (
              <p className="text-text-gray text-sm">No changes yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.changes.map((c) => (
                  <li key={c.id} className="bg-bg-card border border-white/10 rounded-xl px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="text-white font-semibold">{c.label}</span>
                      <span className="text-text-gray text-xs">{fmtTime(c.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-text-gray break-words">
                      <span className="text-white/80">{c.from}</span> → <span className="text-white">{c.to}</span>
                    </p>
                    <p className="mt-1 text-xs text-text-gray break-words">
                      {c.actorType === 'system' ? c.actor : <>{c.actor} · {c.actorType}</>}
                      {c.reason ? <> · &ldquo;{c.reason}&rdquo;</> : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
