'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Settings, History } from 'lucide-react'

// /admin/settings panel (Batch 1 item 5). One card per setting with its own Save and an optional
// reason; the change log underneath. Loading renders skeletons, never placeholder values
// (flicker-class rule). A 409 keeps what you typed and shows the value someone else saved.

interface SettingView {
  key: string
  label: string
  help: string
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

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const inputCls =
  'w-full bg-[#0F0F0F] border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40 disabled:opacity-50'
const labelCls = 'text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5 block'

function SettingCard({ setting, onSaved }: { setting: SettingView; onSaved: () => void }) {
  const [draft, setDraft] = useState(toInput(setting.value))
  const [reason, setReason] = useState('')
  const [version, setVersion] = useState(setting.version)
  const [saving, setSaving] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<SettingView | null>(null)

  // A fresh load (after any save) re-seeds the card, except while a conflict is on screen:
  // then the typed value stays put so it can be re-applied.
  useEffect(() => {
    if (conflict) return
    setDraft(toInput(setting.value))
    setVersion(setting.version)
  }, [setting.value, setting.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true)
    setFieldError(null)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: setting.key, value: draft, expectedVersion: version, reason }),
      })
      const json = await res.json()
      if (res.status === 409) {
        const current = json.error?.details?.current as SettingView | undefined
        setConflict(current ?? null)
        if (current) setVersion(current.version) // the next Save re-applies over what's there now
        return
      }
      if (!json.success) {
        setFieldError(json.error?.details?.fieldErrors?.[setting.key] ?? json.error?.message ?? 'Save failed')
        return
      }
      setConflict(null)
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

      <label className={labelCls} htmlFor={`setting-${setting.key}`}>Value</label>
      <input
        id={`setting-${setting.key}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={saving}
        placeholder="Not set"
        aria-invalid={!!fieldError}
        className={`${inputCls} ${fieldError ? 'border-red-500/70 focus:border-red-500' : ''}`}
      />
      {fieldError && <p className="mt-1.5 text-xs text-red-400">{fieldError}</p>}

      <label className={`${labelCls} mt-4`} htmlFor={`reason-${setting.key}`}>Reason (optional)</label>
      <input
        id={`reason-${setting.key}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={saving}
        placeholder="Why the change, for the log"
        className={inputCls}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.6875rem] text-text-gray">
          {setting.isSet && setting.updatedAt ? `Last changed ${fmtTime(setting.updatedAt)}` : 'Not set'}
          {' · '}Clear the field and save to remove it.
        </p>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-neon-pink text-white text-sm font-semibold hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors cursor-pointer border-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export default function PlatformSettingsPanel() {
  const [data, setData] = useState<{ settings: SettingView[]; changes: SettingChangeView[] } | null>(null)
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
        <h1 className="font-bebas text-4xl sm:text-5xl text-white tracking-wide flex items-center gap-3">
          <Settings className="w-7 h-7 text-neon-pink" /> Platform settings
        </h1>
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
            {data.settings.map((s) => <SettingCard key={s.key} setting={s} onSaved={load} />)}
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
                      {c.actor} · {c.actorType}
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
