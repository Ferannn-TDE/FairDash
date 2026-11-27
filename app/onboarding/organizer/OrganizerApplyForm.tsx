'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import DateRangePicker from '@/app/_components/ui/DateRangePicker'
import { Label, iCls, ProgressBar } from '@/app/become-vendor/VendorOnboarding'
import { creationDateBounds } from '@/lib/calendar-date'
import { toastError } from '@/lib/toast-error'
import { US_STATES } from '@/lib/partner-application'
import { WEBSITE_TERMS_PATH } from '@/lib/legal/website-terms'
import { PRIVACY_POLICY_PATH } from '@/lib/legal/privacy-policy'
import type { ContactPrefill } from '@/lib/contact-prefill'
import {
  validateOrganizerApplication, ORGANIZER_EMAIL_HINT, ORGANIZER_MAX_LEN,
  type OrganizerApplicationInput,
} from '@/lib/organizer-application'

// The organizer sign-up form (sign-up-fixes commit 4): the vendor sign-up's step style and field
// styles, two steps — your organization, then your event. Every rule is the shared validator
// (lib/organizer-application.ts) that POST /api/organizer/apply also runs. Submitting creates the
// organizer, saves the event as a hidden draft, and opens the "Application under review" screen.

const STEPS = [
  { num: 1, label: 'Organization' },
  { num: 2, label: 'Your event' },
] as const

const STEP_FIELDS: Record<1 | 2, readonly string[]> = {
  1: ['organizationName', 'phone', 'email', 'website'],
  2: ['eventName', 'city', 'state', 'startDate', 'endDate', 'openTime', 'closeTime', 'address', 'agreedToTerms'],
}

const SUBMIT_FALLBACK = 'Couldn’t send your application. Please try again.'

interface Form {
  organizationName: string; phone: string; email: string; website: string
  eventName: string; city: string; state: string; startDate: string; endDate: string
  openTime: string; closeTime: string; address: string; agreedToTerms: boolean
}

export default function OrganizerApplyForm({ prefill }: { prefill: ContactPrefill }) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [form, setForm] = useState<Form>({
    organizationName: '', phone: prefill.phone ?? '', email: prefill.email ?? '', website: '',
    eventName: '', city: '', state: '', startDate: '', endDate: '',
    openTime: '', closeTime: '', address: '', agreedToTerms: false,
  })
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  // The picker's window: today to 18 months ahead (lib/calendar-date), the same as the wizard's.
  const { minDate, maxDate, defaultMonth } = useMemo(() => creationDateBounds(), [])

  const errors = validateOrganizerApplication(form as OrganizerApplicationInput)
  const errorFor = (k: string) => (touched[k] ? errors[k] : undefined)
  const stepValid = (s: 1 | 2) => STEP_FIELDS[s].every(k => !errors[k])
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }))
  const touch = (k: string) => setTouched(t => ({ ...t, [k]: true }))
  const touchStep = (s: 1 | 2) => setTouched(t => ({ ...t, ...Object.fromEntries(STEP_FIELDS[s].map(k => [k, true])) }))

  const fieldError = (k: string) => {
    const e = errorFor(k)
    return e ? <p role="alert" className="text-xs text-red-400 mt-1.5">{e}</p> : null
  }

  async function submit() {
    touchStep(2)
    if (!stepValid(1)) { touchStep(1); setStep(1); return }
    if (!stepValid(2)) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/organizer/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      const json = await res.json().catch(() => null)
      if (res.ok && json?.success) {
        router.push('/organizer')
        router.refresh()
        return
      }
      // Never the server's text: the code picks a fixed sentence (lib/toast-error.ts).
      toastError(json?.error?.code, SUBMIT_FALLBACK)
    } catch {
      toastError(undefined, SUBMIT_FALLBACK)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-dark pt-24 pb-16 px-4">
      <div className="max-w-xl mx-auto">
        <h1 className="font-bebas text-4xl tracking-wide text-white mb-1">Apply to host events on FairSynq</h1>
        <p className="text-text-gray text-sm mb-6">
          Tell us about your organization and the event you run. FairSynq reviews every organizer before their event can go public.
        </p>
        <ProgressBar step={step} steps={STEPS} />

        {step === 1 && (
          <div className="bg-bg-card border border-white/10 rounded-2xl p-6 space-y-5">
            <div>
              <Label required>Organization name</Label>
              <input className={iCls} value={form.organizationName} maxLength={ORGANIZER_MAX_LEN.organizationName}
                onChange={e => set('organizationName', e.target.value)} onBlur={() => touch('organizationName')} />
              {fieldError('organizationName')}
            </div>
            <div>
              <Label required>Phone</Label>
              <input type="tel" className={iCls} placeholder="(217) 555-0134" value={form.phone} autoComplete="tel"
                onChange={e => set('phone', e.target.value)} onBlur={() => touch('phone')} />
              {fieldError('phone')}
            </div>
            <div>
              <Label required>Organization email</Label>
              <input type="email" className={iCls} value={form.email} autoComplete="email"
                onChange={e => set('email', e.target.value)} onBlur={() => touch('email')} />
              <p className="text-xs text-text-gray mt-1.5">{ORGANIZER_EMAIL_HINT}</p>
              {fieldError('email')}
            </div>
            <div>
              <Label>Website or Facebook</Label>
              <input className={iCls} value={form.website} maxLength={ORGANIZER_MAX_LEN.website} placeholder="https://"
                onChange={e => set('website', e.target.value)} onBlur={() => touch('website')} />
              {fieldError('website')}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="bg-bg-card border border-white/10 rounded-2xl p-6 space-y-5">
            <div>
              <Label required>What event do you run?</Label>
              <input className={iCls} value={form.eventName} maxLength={ORGANIZER_MAX_LEN.eventName}
                onChange={e => set('eventName', e.target.value)} onBlur={() => touch('eventName')} />
              {fieldError('eventName')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label required>City</Label>
                <input className={iCls} value={form.city} maxLength={ORGANIZER_MAX_LEN.city}
                  onChange={e => set('city', e.target.value)} onBlur={() => touch('city')} />
                {fieldError('city')}
              </div>
              <div>
                <Label required>State</Label>
                <select className={`${iCls} cursor-pointer`} value={form.state}
                  onChange={e => { set('state', e.target.value); touch('state') }}>
                  <option value="" disabled>Choose a state…</option>
                  {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
                {fieldError('state')}
              </div>
            </div>
            <div>
              <Label required>Event dates</Label>
              <DateRangePicker
                value={{ start: form.startDate, end: form.endDate }}
                onChange={v => { setForm(f => ({ ...f, startDate: v.start, endDate: v.end })); setTouched(t => ({ ...t, startDate: true, endDate: true })) }}
                minDate={minDate}
                maxDate={maxDate}
                defaultMonth={defaultMonth}
              />
              {fieldError('startDate')}
              {fieldError('endDate')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Daily start time</Label>
                <input type="time" className={iCls} value={form.openTime}
                  onChange={e => set('openTime', e.target.value)} onBlur={() => touch('openTime')} />
                {fieldError('openTime')}
              </div>
              <div>
                <Label>Daily end time</Label>
                <input type="time" className={iCls} value={form.closeTime}
                  onChange={e => set('closeTime', e.target.value)} onBlur={() => touch('closeTime')} />
                {fieldError('closeTime')}
              </div>
            </div>
            <div>
              <Label>Address</Label>
              <input className={iCls} value={form.address} maxLength={ORGANIZER_MAX_LEN.address} autoComplete="street-address"
                onChange={e => set('address', e.target.value)} onBlur={() => touch('address')} />
              {fieldError('address')}
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1 accent-neon-pink" checked={form.agreedToTerms}
                onChange={e => { set('agreedToTerms', e.target.checked); touch('agreedToTerms') }} />
              <span className="text-sm text-white/90">
                I agree to the FairSynq{' '}
                <a href={WEBSITE_TERMS_PATH} target="_blank" rel="noopener noreferrer" className="text-neon-pink underline">Terms</a>
                {' '}and{' '}
                <a href={PRIVACY_POLICY_PATH} target="_blank" rel="noopener noreferrer" className="text-neon-pink underline">Privacy Policy</a>
              </span>
            </label>
            {fieldError('agreedToTerms')}
          </div>
        )}

        <div className="flex items-center justify-between mt-6">
          {step === 2 ? (
            <button type="button" onClick={() => setStep(1)} className="inline-flex items-center gap-1 text-sm text-text-gray hover:text-white">
              <ChevronLeftIcon className="w-4 h-4" /> Back
            </button>
          ) : <span />}
          {step === 1 ? (
            <button type="button"
              onClick={() => { touchStep(1); if (stepValid(1)) setStep(2) }}
              className="inline-flex items-center gap-1 px-6 py-3 bg-neon-pink text-white text-sm font-bold rounded-xl hover:opacity-90">
              Next <ChevronRightIcon className="w-4 h-4" />
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={submitting}
              className="px-6 py-3 bg-neon-pink text-white text-sm font-bold rounded-xl hover:opacity-90 disabled:opacity-60">
              {submitting ? 'Sending…' : 'Submit application'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
