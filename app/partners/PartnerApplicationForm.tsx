'use client'

import { useState } from 'react'
import {
  GROUP_TYPES, US_STATES, HONEYPOT_FIELD, PARTNER_APPLY_SUCCESS,
  validatePartnerApplication, type PartnerFieldErrors,
} from '@/lib/partner-application'

// The partner application form. Validation is the same module the server runs
// (lib/partner-application.ts): feedback here, the real gate on POST /api/partners/apply.

const inputCls = (bad?: string) =>
  `w-full bg-bg-dark border rounded-xl px-4 py-3 text-white text-sm outline-none transition-colors placeholder:text-text-gray/40 ${
    bad ? 'border-red-500/70 focus:border-red-500' : 'border-white/10 focus:border-neon-pink'
  }`
const labelCls = 'text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5 block'

type Form = Record<'name' | 'groupType' | 'groupTypeOther' | 'contactName' | 'email' | 'phone' | 'city' | 'state' | 'interests' | 'staffHours' | 'note', string>
const EMPTY: Form = { name: '', groupType: '', groupTypeOther: '', contactName: '', email: '', phone: '', city: '', state: '', interests: '', staffHours: '', note: '' }

function Field({ label, required, error, children, htmlFor }: { label: string; required?: boolean; error?: string; children: React.ReactNode; htmlFor: string }) {
  return (
    <div>
      <label className={labelCls} htmlFor={htmlFor}>{label}{required && <span className="text-neon-pink"> *</span>}</label>
      {children}
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
    </div>
  )
}

export default function PartnerApplicationForm() {
  const [form, setForm] = useState<Form>(EMPTY)
  const [honeypot, setHoneypot] = useState('')
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [serverErrors, setServerErrors] = useState<PartnerFieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const errors = validatePartnerApplication(form)
  const errorFor = (k: keyof Form) => (touched[k] ? errors[k] ?? serverErrors[k] : serverErrors[k])
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(f => ({ ...f, [k]: e.target.value }))
    setServerErrors(s => { const n = { ...s }; delete n[k]; return n })
  }
  const blur = (k: keyof Form) => () => setTouched(t => ({ ...t, [k]: true }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFailure(null)
    if (Object.keys(errors).length) {
      setTouched(Object.fromEntries(Object.keys(EMPTY).map(k => [k, true])))
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/partners/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, [HONEYPOT_FIELD]: honeypot }),
      })
      const json = await res.json().catch(() => ({}))
      if (json?.success) { setDone(json.data?.message ?? PARTNER_APPLY_SUCCESS); return }
      if (json?.error?.details?.fieldErrors) setServerErrors(json.error.details.fieldErrors)
      setFailure(json?.error?.message ?? 'Something went wrong. Please try again.')
    } catch {
      setFailure('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div role="status" className="mt-10 bg-bg-card border border-neon-pink/30 rounded-2xl p-6 sm:p-8 text-center">
        <p className="text-white text-base sm:text-lg leading-relaxed">{done}</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="mt-10 bg-bg-card border border-white/10 rounded-2xl p-5 sm:p-8 space-y-5">
      <h2 className="font-bebas text-2xl sm:text-3xl tracking-wide">Apply to partner with us</h2>

      <Field label="Organization name" required error={errorFor('name')} htmlFor="p-name">
        <input id="p-name" value={form.name} onChange={set('name')} onBlur={blur('name')} className={inputCls(errorFor('name'))} autoComplete="organization" />
      </Field>

      <Field label="Type of group" required error={errorFor('groupType')} htmlFor="p-type">
        <select id="p-type" value={form.groupType} onChange={set('groupType')} onBlur={blur('groupType')} className={`${inputCls(errorFor('groupType'))} cursor-pointer`}>
          <option value="" disabled>Choose one…</option>
          {GROUP_TYPES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
      </Field>

      {form.groupType === 'other' && (
        <Field label="Describe your group" required error={errorFor('groupTypeOther')} htmlFor="p-type-other">
          <input id="p-type-other" value={form.groupTypeOther} onChange={set('groupTypeOther')} onBlur={blur('groupTypeOther')} className={inputCls(errorFor('groupTypeOther'))} />
        </Field>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Contact name" required error={errorFor('contactName')} htmlFor="p-contact">
          <input id="p-contact" value={form.contactName} onChange={set('contactName')} onBlur={blur('contactName')} className={inputCls(errorFor('contactName'))} autoComplete="name" />
        </Field>
        <Field label="Phone" required error={errorFor('phone')} htmlFor="p-phone">
          <input id="p-phone" type="tel" value={form.phone} onChange={set('phone')} onBlur={blur('phone')} className={inputCls(errorFor('phone'))} autoComplete="tel" />
        </Field>
      </div>

      <Field label="Email" required error={errorFor('email')} htmlFor="p-email">
        <input id="p-email" type="email" value={form.email} onChange={set('email')} onBlur={blur('email')} className={inputCls(errorFor('email'))} autoComplete="email" />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-5">
        <Field label="City" required error={errorFor('city')} htmlFor="p-city">
          <input id="p-city" value={form.city} onChange={set('city')} onBlur={blur('city')} className={inputCls(errorFor('city'))} autoComplete="address-level2" />
        </Field>
        <Field label="State" required error={errorFor('state')} htmlFor="p-state">
          <select id="p-state" value={form.state} onChange={set('state')} onBlur={blur('state')} className={`${inputCls(errorFor('state'))} cursor-pointer`} autoComplete="address-level1">
            <option value="" disabled>Choose…</option>
            {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Which fairs or events would your group like to work?" error={errorFor('interests')} htmlFor="p-interests">
        <textarea id="p-interests" rows={2} value={form.interests} onChange={set('interests')} onBlur={blur('interests')} className={inputCls(errorFor('interests'))} />
      </Field>
      <Field label="Hours your group could staff" error={errorFor('staffHours')} htmlFor="p-hours">
        <textarea id="p-hours" rows={2} value={form.staffHours} onChange={set('staffHours')} onBlur={blur('staffHours')} className={inputCls(errorFor('staffHours'))} />
      </Field>
      <Field label="Anything else we should know?" error={errorFor('note')} htmlFor="p-note">
        <textarea id="p-note" rows={3} value={form.note} onChange={set('note')} onBlur={blur('note')} className={inputCls(errorFor('note'))} />
      </Field>

      {/* Honeypot: hidden from people and screen readers; bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
        <label htmlFor="p-website">Website</label>
        <input id="p-website" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" value={honeypot} onChange={e => setHoneypot(e.target.value)} />
      </div>

      {failure && <p role="alert" className="text-sm text-red-400">{failure}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3.5 rounded-xl bg-neon-pink text-white font-semibold text-sm hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Sending…' : 'Send application'}
      </button>
    </form>
  )
}
