'use client'

import { useState, useCallback, useEffect, Fragment } from 'react'
import Link from 'next/link'
import {
  BuildingStorefrontIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MenuItemData {
  id: string
  name: string
  description: string
  price: string
  prepTime: string
  photo: File | null
  photoPreview: string | null
}

interface BoothPhotoData {
  id: string
  file: File
  preview: string
}

interface FormData {
  businessName: string
  contactName: string
  email: string
  phone: string
  cuisineTypes: string[]     // multi-select; joined into the server's cuisineType string on submit
  customCuisine: string      // free text when "Other" is selected
  description: string
  foodHandlerPermit: File | null
  liabilityInsurance: File | null
  menuItems: MenuItemData[]
  boothPhotos: BoothPhotoData[]
  legalName: string
  stripeConnected: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CUISINE_OPTIONS = [
  'BBQ & Grilled', 'American', 'Mexican', 'Italian', 'Asian Fusion',
  'Japanese', 'Seafood', 'Vegan / Vegetarian', 'Desserts & Sweets',
  'Fried Food', 'Drinks & Beverages', 'Fair Classics', 'Merchandise', 'Other',
]

// Leaned to ONLY what the application persists + the legal gate. The application
// is "apply to this fair" (business identity); menu, payouts (Stripe), documents,
// booth, and photos are completed AFTER approval in the guided checklist
// (/vendor/[fairSlug]/onboarding → real settings/menu pages). The old flow
// collected those here and silently discarded them (and faked the Stripe step).
const STEPS = [
  { num: 1, label: 'Account',     hardBlock: false },
  { num: 2, label: 'Application', hardBlock: false },
  { num: 3, label: 'Agreement',   hardBlock: false },
]

const VENDOR_TERMS = `FAIRSYNQ VENDOR AGREEMENT
Last Updated: January 1, 2026

This Vendor Agreement is entered into between FairSynq LLC ("FairSynq") and the vendor applying to participate on the FairSynq platform.

1. VENDOR ELIGIBILITY
To become a FairSynq vendor, you must: (a) be a legally registered business or sole proprietor; (b) hold all required food handler permits and health department certifications; (c) maintain valid general liability insurance of at least $1,000,000 per occurrence; and (d) agree to operate within the designated FairSynq service area during scheduled fair events.

2. PLATFORM FEES
FairSynq charges customers a 10% service fee on top of your menu prices. That fee is FairSynq's and is NOT deducted from your earnings — you keep your full item subtotal. Standard Stripe payment-processing fees (approximately 2.9% + $0.30 per order, split proportionally across vendors on shared orders) are deducted from your payout, the same as any card payment. Vendors receive payment via Stripe within 3–5 business days after each event settlement period. FairSynq reserves the right to adjust the service fee with 30 days' written notice.

3. MENU & PRICING
Vendors are responsible for maintaining accurate, up-to-date menu listings including item names, descriptions, allergen information, and pricing. Prices listed on FairSynq must match or be lower than prices charged at your on-site booth.

4. ORDER FULFILLMENT & QUALITY
You agree to: (a) prepare orders promptly; (b) notify FairSynq immediately if an item becomes unavailable; (c) package orders securely for delivery or curbside pickup; and (d) maintain a minimum order fulfillment rate of 95% per event.

5. FOOD SAFETY & COMPLIANCE
All food prepared and sold through FairSynq must comply with applicable food safety regulations. Vendors indemnify FairSynq against any claims arising from foodborne illness or improper food handling.

6. CUSTOMER REVIEWS & RATINGS
Vendors with an average rating below 3.5 stars over 30 days may receive a performance notice. Continued low ratings may result in reduced visibility or account suspension.

7. TERMINATION
Either party may terminate this Agreement with 14 days' written notice. FairSynq may terminate immediately for violations, fraudulent activity, or repeated food safety complaints.

8. GOVERNING LAW
This Agreement is governed by the laws of the State of Illinois. Disputes shall be resolved by binding arbitration.

By typing your full legal name below, you confirm you have read, understood, and agree to be bound by this Agreement.`

// Version identifier for VENDOR_TERMS (their "Last Updated" date). Sent with the
// application so the consent record captures WHICH terms were agreed to. Bump this
// whenever VENDOR_TERMS changes.
const VENDOR_TERMS_VERSION = '2026-01-01'

const INITIAL_ITEM: MenuItemData = { id: '1', name: '', description: '', price: '', prepTime: '', photo: null, photoPreview: null }

const INITIAL: FormData = {
  businessName: '', contactName: '', email: '', phone: '',
  cuisineTypes: [], customCuisine: '', description: '',
  foodHandlerPermit: null, liabilityInsurance: null,
  menuItems: [{ ...INITIAL_ITEM }],
  boothPhotos: [], legalName: '', stripeConnected: false,
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
      {children}{required && <span className="text-neon-pink ml-0.5">*</span>}
    </p>
  )
}

const iCls = 'w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-white/20'

function HardBlockBanner({ satisfied, label }: { satisfied: boolean; label: string }) {
  if (satisfied) return (
    <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
      <CheckCircleIcon className="w-4 h-4 text-emerald-400 shrink-0" />
      <p className="text-sm text-emerald-400"><span className="font-semibold">{label}</span> — Step unlocked</p>
    </div>
  )
  return (
    <div className="flex items-center gap-2.5 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
      <LockClosedIcon className="w-4 h-4 text-amber-400 shrink-0" />
      <p className="text-sm text-amber-400"><span className="font-semibold">{label}</span> — Required to continue</p>
    </div>
  )
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="mb-8">
      {/* Mobile */}
      <div className="sm:hidden mb-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-gray uppercase tracking-wide">Step {step} of {STEPS.length}</span>
          <span className="text-xs font-bold text-white uppercase tracking-wide">{STEPS.find(s => s.num === step)?.label}</span>
        </div>
        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-neon-pink to-[#ff4488] rounded-full transition-all duration-500 ease-out"
            style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }} />
        </div>
      </div>
      {/* Desktop */}
      <div className="hidden sm:flex items-start w-full">
        {STEPS.map((s, i) => {
          const done = step > s.num
          const active = step === s.num
          return (
            <Fragment key={s.num}>
              <div className="flex flex-col items-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[0.625rem] font-bold border-2 transition-all duration-300 ${
                  done ? 'bg-neon-pink border-neon-pink text-white' :
                  active ? 'border-neon-pink text-neon-pink bg-neon-pink/10' :
                  'border-white/10 text-white/30 bg-transparent'
                }`}>
                  {done ? <CheckIcon className="w-3.5 h-3.5" /> : s.num}
                </div>
                <span className={`text-[0.5rem] mt-1 font-bold uppercase tracking-wide whitespace-nowrap transition-colors ${
                  active ? 'text-white' : done ? 'text-neon-pink' : 'text-white/20'
                }`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px mt-3.5 mx-1.5 transition-all duration-500 ${done ? 'bg-neon-pink/50' : 'bg-white/[0.06]'}`} />
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

// ─── Step components ──────────────────────────────────────────────────────────

function Step1({ data, update, fairs, eventSlug, setEventSlug }: {
  data: FormData
  update: (p: Partial<FormData>) => void
  fairs: { slug: string; name: string }[]
  eventSlug: string | null
  setEventSlug: (s: string) => void
}) {
  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="font-bebas text-2xl tracking-wide text-white mb-1">Account Setup</h2>
        <p className="text-text-gray text-sm">Your business identity on FairSynq.</p>
      </div>

      {/* Which fair — a Vendor application is per-fair, so this must be set (was the
          missing eventSlug that 400'd on submit). Auto-selected when there's one fair. */}
      <div>
        <Label required>Which fair are you applying to?</Label>
        {fairs.length === 0 ? (
          <p className="text-sm text-text-gray">Loading fairs…</p>
        ) : (
          <select
            className={`${iCls} cursor-pointer`}
            value={eventSlug ?? ''}
            onChange={e => setEventSlug(e.target.value)}
          >
            <option value="" disabled>Select a fair…</option>
            {fairs.map(f => <option key={f.slug} value={f.slug}>{f.name}</option>)}
          </select>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label required>Business Name</Label>
          <input className={iCls} placeholder="Big Bob's Corn Dogs" value={data.businessName}
            onChange={e => update({ businessName: e.target.value })} />
        </div>
        <div>
          <Label required>Contact Name</Label>
          <input className={iCls} placeholder="Jane Smith" value={data.contactName}
            onChange={e => update({ contactName: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label required>Email Address</Label>
          <input type="email" className={iCls} placeholder="jane@business.com" value={data.email}
            onChange={e => update({ email: e.target.value })} />
        </div>
        <div>
          <Label required>Phone Number</Label>
          <input type="tel" className={iCls} placeholder="(555) 000-0000" value={data.phone}
            onChange={e => update({ phone: e.target.value })} />
        </div>
      </div>
    </div>
  )
}

function Step2({ data, update }: { data: FormData; update: (p: Partial<FormData>) => void }) {
  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 space-y-6">
      <div>
        <h2 className="font-bebas text-2xl tracking-wide text-white mb-1">Application Details</h2>
        <p className="text-text-gray text-sm">Tell fair-goers what you serve. Booth, menu &amp; payouts come after approval.</p>
      </div>

      {/* Cuisine type — multi-select (pick as many as apply) */}
      <div>
        <Label required>Cuisine Type <span className="text-text-gray font-normal normal-case">(select all that apply)</span></Label>
        <div className="flex flex-wrap gap-2 mt-1">
          {CUISINE_OPTIONS.map(c => {
            const selected = data.cuisineTypes.includes(c)
            return (
              <button key={c} type="button"
                onClick={() => {
                  const next = selected
                    ? data.cuisineTypes.filter(x => x !== c)
                    : [...data.cuisineTypes, c]
                  update({ cuisineTypes: next, ...(c === 'Other' && selected ? { customCuisine: '' } : {}) })
                }}
                className={`px-3.5 py-2 rounded-full text-sm font-medium border cursor-pointer transition-all duration-200 ${
                  selected
                    ? 'bg-neon-pink border-neon-pink text-white shadow-[0_2px_8px_rgba(255,0,119,0.3)]'
                    : 'bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white'
                }`}>
                {c}
              </button>
            )
          })}
        </div>
        {/* "Other" reveals a free-text field for a custom cuisine */}
        {data.cuisineTypes.includes('Other') && (
          <input className={`${iCls} mt-3`} placeholder="Enter your cuisine type (e.g. Ethiopian, Filipino)"
            value={data.customCuisine} onChange={e => update({ customCuisine: e.target.value })} />
        )}
      </div>

      {/* Description */}
      <div>
        <Label required>Short Description</Label>
        <textarea value={data.description} onChange={e => update({ description: e.target.value })} rows={4}
          className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-white/20 resize-none"
          placeholder="Tell fair-goers about your food and what makes it special... (20+ characters required)" />
        <p className={`text-xs mt-1 transition-colors ${data.description.trim().length >= 20 ? 'text-emerald-400' : 'text-text-gray'}`}>
          {data.description.trim().length} / 20 characters minimum
        </p>
      </div>
    </div>
  )
}

function Step6({ data, update }: { data: FormData; update: (p: Partial<FormData>) => void }) {
  const signed = data.legalName.trim().length >= 3
  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="font-bebas text-2xl tracking-wide text-white mb-1">Digital Agreement</h2>
        <p className="text-text-gray text-sm">Read the vendor agreement and sign with your full legal name.</p>
      </div>

      {/* Pre-filled details */}
      <div className="grid grid-cols-2 gap-3 p-4 bg-white/[0.03] border border-white/5 rounded-xl">
        {[
          { label: 'Business', value: data.businessName },
          { label: 'Contact',  value: data.contactName  },
          { label: 'Email',    value: data.email        },
          { label: 'Date',     value: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-[0.5625rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">{label}</p>
            <p className="text-sm text-white truncate">{value || '—'}</p>
          </div>
        ))}
      </div>

      {/* Agreement text */}
      <div className="h-52 overflow-y-auto bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-text-gray text-[0.8125rem] leading-relaxed whitespace-pre-line">
        {VENDOR_TERMS}
      </div>

      {/* Signature */}
      <div>
        <Label required>Type your full legal name to sign</Label>
        <input className={iCls} placeholder="e.g. Jane Elizabeth Smith"
          value={data.legalName} onChange={e => update({ legalName: e.target.value })} />
        {signed && (
          <div className="mt-3 flex items-center gap-2.5 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
            <ShieldCheckIcon className="w-4 h-4 text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-400">
              Signed by <span className="font-semibold text-white">{data.legalName}</span>
              <span className="text-emerald-500/70"> · {new Date().toLocaleDateString()}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Step8({ data }: { data: FormData }) {
  return (
    <div className="py-4 text-center space-y-6 animate-fadeIn">
      <div className="relative inline-flex">
        <div className="w-24 h-24 bg-neon-pink/10 border border-neon-pink/20 rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(255,0,119,0.15)]">
          <SparklesIcon className="w-12 h-12 text-neon-pink" />
        </div>
      </div>

      <div>
        <h2 className="font-bebas text-[clamp(2rem,6vw,3rem)] tracking-wide text-white leading-tight mb-2">
          Application <span className="text-neon-pink">Submitted!</span>
        </h2>
        <p className="text-text-gray">
          Thank you, <span className="text-white font-semibold">{data.businessName || 'your business'}</span>. We received everything.
        </p>
      </div>

      <div className="max-w-sm mx-auto p-5 bg-bg-card border border-white/10 rounded-2xl text-left space-y-3.5">
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold">What Happens Next</p>
        {[
          { n: '01', t: 'The event operator reviews your application (24–48 hrs)' },
          { n: '02', t: 'You receive approval or decline with reason via email' },
          { n: '03', t: 'If approved, you gain immediate access to your vendor dashboard' },
          { n: '04', t: 'You are NOT live until the operator sets your go-live date' },
        ].map(({ n, t }) => (
          <div key={n} className="flex items-start gap-3">
            <span className="font-bebas text-lg text-neon-pink leading-none shrink-0 w-6">{n}</span>
            <p className="text-sm text-text-gray leading-relaxed">{t}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-text-gray">
        Confirmation sent to <span className="text-white">{data.email}</span>
      </p>

      <Link href="/"
        className="inline-flex items-center px-8 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 transition-all no-underline">
        Back to Home
      </Link>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VendorOnboarding() {
  const [step, setStep] = useState(1)
  const [data, setData] = useState<FormData>(INITIAL)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fairs, setFairs] = useState<{ slug: string; name: string }[]>([])
  const [eventSlug, setEventSlug] = useState<string | null>(null)

  // Resolve which fair to apply to (a Vendor is per-fair). Prefer the ?event URL
  // param; else load the public fair list and auto-pick when there's exactly one.
  // This replaces the old "read ?event or send null" that 400'd every submission.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('event')
    fetch('/api/fairs')
      .then(r => r.json())
      .then(json => {
        const list: { slug: string; name: string }[] = (json?.success ? json.data : [])
          .map((f: { slug: string; name: string }) => ({ slug: f.slug, name: f.name }))
        setFairs(list)
        if (fromUrl) setEventSlug(fromUrl)
        else if (list.length === 1) setEventSlug(list[0].slug)
      })
      .catch(() => { if (fromUrl) setEventSlug(fromUrl) })
  }, [])

  const update = useCallback((patch: Partial<FormData>) => setData(d => ({ ...d, ...patch })), [])

  const cuisineChosen = data.cuisineTypes.length > 0 &&
    (!data.cuisineTypes.includes('Other') || data.customCuisine.trim().length > 0)

  const canProceed = (() => {
    switch (step) {
      case 1: return !!(eventSlug && data.businessName.trim() && data.contactName.trim() && data.email.trim() && data.phone.trim())
      case 2: return !!(cuisineChosen && data.description.trim().length >= 20)
      case 3: return data.legalName.trim().length >= 3
      default: return true
    }
  })()

  const handleSubmit = async () => {
    if (!eventSlug) { toast.error('Please select a fair to apply to.'); return }
    // Join the multi-select into the single cuisineType string the server stores,
    // substituting the custom value where "Other" was chosen.
    const cuisineType = data.cuisineTypes
      .map(c => (c === 'Other' ? data.customCuisine.trim() : c))
      .filter(Boolean)
      .join(', ')
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventSlug,
          name: data.businessName,
          description: data.description,
          cuisineType,
          // Contact (the application's contact) + signed legal consent — now
          // persisted, no longer collected-then-discarded.
          contactName:  data.contactName,
          contactEmail: data.email,
          contactPhone: data.phone,
          legalName:    data.legalName,
          termsVersion: VENDOR_TERMS_VERSION,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json?.error ?? 'Registration failed')
      }
      toast.success('Application submitted!')
      setStep(4) // success step (was 8)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="pt-20 min-h-screen pb-20 bg-bg-dark">
      <div className="max-w-[680px] mx-auto px-5 py-10">

        {step < 4 && (
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-neon-pink/10 border border-neon-pink/20 rounded-2xl mb-4 shadow-[0_0_24px_rgba(255,0,119,0.12)]">
              <BuildingStorefrontIcon className="w-7 h-7 text-neon-pink" />
            </div>
            <h1 className="font-bebas text-[clamp(2rem,5vw,3rem)] tracking-wide text-white leading-tight mb-2">
              Become a <span className="text-neon-pink">Vendor</span>
            </h1>
            <p className="text-text-gray text-sm">Apply to this fair — you&apos;ll set up payouts and your menu after approval.</p>
          </div>
        )}

        {step < 4 && <ProgressBar step={step} />}

        {/* Step content with key for animation re-trigger */}
        <div key={step} className="animate-fadeIn">
          {step === 1 && <Step1 data={data} update={update} fairs={fairs} eventSlug={eventSlug} setEventSlug={setEventSlug} />}
          {step === 2 && <Step2 data={data} update={update} />}
          {step === 3 && <Step6 data={data} update={update} />}
          {step === 4 && <Step8 data={data} />}
        </div>

        {/* Navigation */}
        {step < 4 && (
          <div className="flex justify-between mt-6">
            {step > 1 ? (
              <button onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-2 px-5 py-2.5 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 transition-all cursor-pointer">
                <ChevronLeftIcon className="w-4 h-4" />Back
              </button>
            ) : (
              <Link href="/"
                className="flex items-center gap-2 px-5 py-2.5 bg-white/5 border border-white/10 text-text-gray rounded-xl font-semibold text-sm hover:bg-white/10 transition-all no-underline">
                Cancel
              </Link>
            )}

            {step < 3 ? (
              <button onClick={() => setStep(s => s + 1)} disabled={!canProceed}
                className="flex items-center gap-2 px-6 py-2.5 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-all cursor-pointer border-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-neon-pink">
                Continue<ChevronRightIcon className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={!canProceed || isSubmitting}
                className="flex items-center gap-2 px-6 py-2.5 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-all cursor-pointer border-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-neon-pink">
                {isSubmitting ? 'Submitting…' : (<>Submit Application<CheckIcon className="w-4 h-4" /></>)}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
