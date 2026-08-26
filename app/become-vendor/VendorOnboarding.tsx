'use client'

import { useState, useCallback, useEffect, Fragment } from 'react'
import Link from 'next/link'
import {
  BuildingStorefrontIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  DocumentArrowUpIcon,
  CheckCircleIcon,
  XMarkIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import {
  ACCEPT_DOC,
  ALLOWED_DOC_MIME,
  invalidMimeMessage,
  isWithinUploadCap,
  uploadTooLargeMessage,
} from '@/lib/upload-limits'
import {
  REQUIRED_VENDOR_DOCS,
  VENDOR_DOC_LABELS,
  type RequiredVendorDoc,
} from '@/lib/vendor-documents'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormData {
  businessName: string
  contactName: string
  email: string
  phone: string
  cuisineTypes: string[]     // multi-select; joined into the server's cuisineType string on submit
  customCuisine: string      // free text when "Other" is selected
  description: string
  legalName: string
}

/**
 * Documents chosen in the wizard, held IN MEMORY until the Vendor row exists.
 *
 * They cannot be uploaded any earlier: POST /api/vendors/[id]/documents is keyed by
 * vendor id and gated on membership in a row that does not exist until submit. So the
 * step collects Files, and handleSubmit uploads them the moment the id comes back.
 */
type DocFiles = Record<RequiredVendorDoc, File | null>

// ─── Constants ────────────────────────────────────────────────────────────────

const CUISINE_OPTIONS = [
  'BBQ & Grilled', 'American', 'Mexican', 'Italian', 'Asian Fusion',
  'Japanese', 'Seafood', 'Vegan / Vegetarian', 'Desserts & Sweets',
  'Fried Food', 'Drinks & Beverages', 'Fair Classics', 'Merchandise', 'Other',
]

// Business identity + required compliance documents + the legal gate. Menu, payouts
// (Stripe) and booth are still completed AFTER approval in the guided checklist
// (/vendor/[fairSlug]/onboarding → real settings/menu pages).
//
// DOCUMENTS ARE BACK, AND REAL THIS TIME. An earlier version of this wizard had a
// document step whose upload box said "Uploaded" over a File that was never sent
// anywhere (removed in c7e85b6 as dead code). Here the files are held in memory and
// labelled "Selected" until POST /api/vendors/[id]/documents actually resolves —
// nothing claims an upload that has not happened. They are collected here because
// approval now REQUIRES them: both approve doors refuse a docs-incomplete vendor.
//
// Step 5 is the success screen and is deliberately not in this list (the progress
// bar covers the four steps the applicant fills in).
const STEPS = [
  { num: 1, label: 'Account'     },
  { num: 2, label: 'Application' },
  { num: 3, label: 'Documents'   },
  { num: 4, label: 'Agreement'   },
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

const INITIAL: FormData = {
  businessName: '', contactName: '', email: '', phone: '',
  cuisineTypes: [], customCuisine: '', description: '',
  legalName: '',
}

const INITIAL_DOCS: DocFiles = { foodHandler: null, insurance: null, businessLicense: null }

/** Per-document guidance shown under each label in the upload step. */
const DOC_HINTS: Record<RequiredVendorDoc, string> = {
  foodHandler:     'Current permit or health department certification.',
  insurance:       'Proof of general liability coverage ($1M per occurrence).',
  businessLicense: 'Your registered business license.',
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

// ─── Step 3: Documents ────────────────────────────────────────────────────────
// Files live in component state until the Vendor row exists. The label says
// "Selected", never "Uploaded" — the previous incarnation of this step showed
// "Uploaded" over a File it never sent, and that lie is the reason it was deleted.
function DocUploadStep({ files, onPick, onClear, uploading }: {
  files: DocFiles
  onPick: (k: RequiredVendorDoc, f: File) => void
  onClear: (k: RequiredVendorDoc) => void
  uploading: boolean
}) {
  // Courtesy pre-checks only — POST /api/vendors/[id]/documents re-checks both, and
  // that check is the boundary. Constants come from lib/upload-limits.ts so this
  // message and the route's rejection are the same number by construction.
  const handle = (k: RequiredVendorDoc, list: FileList | null) => {
    const f = list?.[0]
    if (!f) return
    if (!ALLOWED_DOC_MIME.has(f.type)) { toast.error(invalidMimeMessage(ALLOWED_DOC_MIME)); return }
    if (!isWithinUploadCap(f.size))    { toast.error(uploadTooLargeMessage()); return }
    onPick(k, f)
  }

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="font-bebas text-2xl tracking-wide text-white mb-1">Required Documents</h2>
        <p className="text-text-gray text-sm">
          The organizer can&apos;t approve your application until all three are on file.
        </p>
      </div>

      {REQUIRED_VENDOR_DOCS.map(key => {
        const file = files[key]
        return (
          <div key={key}>
            <Label required>{VENDOR_DOC_LABELS[key]}</Label>
            {!file ? (
              <label className="group flex flex-col items-center justify-center py-7 border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:border-neon-pink/40 hover:bg-white/[0.02] transition-all">
                <DocumentArrowUpIcon className="w-7 h-7 text-text-gray group-hover:text-neon-pink transition-colors mb-2" />
                <p className="text-sm text-text-gray group-hover:text-white transition-colors text-center">
                  <span className="text-neon-pink font-semibold">Click to upload</span> a PDF or photo
                </p>
                <p className="text-xs text-white/25 mt-1">{DOC_HINTS[key]}</p>
                <input type="file" accept={ACCEPT_DOC} className="hidden" disabled={uploading}
                  onChange={e => { handle(key, e.target.files); e.target.value = '' }} />
              </label>
            ) : (
              <div className="flex items-center gap-3 px-4 py-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <CheckCircleIcon className="w-5 h-5 text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">{file.name}</p>
                  {/* In memory only — NOT sent yet. Never say "Uploaded" here. */}
                  <p className="text-xs text-text-gray">{(file.size / 1024).toFixed(0)} KB · Selected</p>
                </div>
                {!uploading && (
                  <button type="button" onClick={() => onClear(key)}
                    aria-label={`Remove ${VENDOR_DOC_LABELS[key]}`}
                    className="p-1.5 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0">
                    <XMarkIcon className="w-4 h-4 text-text-gray" />
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      <p className="text-xs text-text-gray">
        Files are sent securely when you submit and are visible only to you, your event
        organizer, and FairSynq staff.
      </p>
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

// eventSlug is REQUIRED for the CTA. The vendor portal is fair-scoped
// (/vendor/[fairSlug]/dashboard), so a bare /vendor link would land nowhere. Submission
// cannot succeed without an eventSlug (it is validated before the POST and the API 400s
// without it), so by the time this screen renders we always have one — but it is typed
// nullable and the CTA falls back to home rather than routing to /vendor/null.
function Step8({ data, eventSlug }: { data: FormData; eventSlug: string | null }) {
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
          // 03 used to read "If approved, you gain immediate access to your vendor
          // dashboard" — which now contradicts the button below it, since the portal is
          // reachable right away in its awaiting-approval state.
          { n: '01', t: 'The event operator reviews your application (24–48 hrs)' },
          { n: '02', t: 'You receive approval or decline with reason via email' },
          { n: '03', t: 'Your portal is open now — you can look around while you wait' },
          { n: '04', t: 'You are NOT live until the operator sets your go-live date' },
        ].map(({ n, t }) => (
          // Grid, not flex: a fixed number column + a text column so wrapped lines indent
          // under the first line, never back under the number. leading-relaxed on the
          // number matches the paragraph's first-line box, so the two align on line one
          // despite the size difference (the old items-start + leading-none left the big
          // number sitting above the smaller text).
          <div key={n} className="grid grid-cols-[1.5rem_1fr] gap-3 items-start">
            <span className="font-bebas text-lg text-neon-pink leading-relaxed tabular-nums text-right">{n}</span>
            <p className="text-sm text-text-gray leading-relaxed">{t}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-text-gray">
        Confirmation sent to <span className="text-white">{data.email}</span>
      </p>

      {/* ONE button, and it points at the thing they can actually use. POST /api/vendors
          creates a PENDING Vendor AND a VendorMember (owner) and syncs the role metadata,
          so this applicant is already authorised for the portal — /api/vendors/me resolves
          by MEMBERSHIP, not by approval status, and the dashboard renders the "Application
          under review" state. So the portal is a real destination right now, not a wall.
          Mirrors the runner flow's "Go to Runner Portal". */}
      {eventSlug ? (
        <Link href={`/vendor/${eventSlug}/dashboard`}
          className="inline-flex items-center px-8 py-3 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-all no-underline">
          Go to Vendor Portal
        </Link>
      ) : (
        // Unreachable in practice (submission requires a fair), but never route to
        // /vendor/null — a broken destination is worse than a boring one.
        <Link href="/"
          className="inline-flex items-center px-8 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 transition-all no-underline">
          Back to Home
        </Link>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VendorOnboarding() {
  const [step, setStep] = useState(1)
  const [data, setData] = useState<FormData>(INITIAL)
  const [docFiles, setDocFiles] = useState<DocFiles>(INITIAL_DOCS)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
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
      // Every required document must be chosen. Client-side only — the real
      // enforcement is the approve gate, which refuses a docs-incomplete vendor.
      case 3: return REQUIRED_VENDOR_DOCS.every(k => docFiles[k] !== null)
      case 4: return data.legalName.trim().length >= 3
      default: return true
    }
  })()

  const pickDoc  = useCallback((k: RequiredVendorDoc, f: File) => setDocFiles(d => ({ ...d, [k]: f })), [])
  const clearDoc = useCallback((k: RequiredVendorDoc) => setDocFiles(d => ({ ...d, [k]: null })), [])

  /**
   * Upload ONE document, with a bounded retry.
   *
   * The route takes one file per request (multipart `docType` + `file`), so three
   * documents are three POSTs. A transient failure mid-onboarding would otherwise leave
   * a permanent Vendor row that can never be approved, so each file gets three attempts
   * before the whole submit reports failure.
   */
  const uploadOne = async (
    vendorId: string,
    docType: RequiredVendorDoc,
    file: File,
    attempt = 1,
  ): Promise<void> => {
    const form = new FormData()
    form.append('docType', docType)
    form.append('file', file)
    try {
      const res = await fetch(`/api/vendors/${vendorId}/documents`, { method: 'POST', body: form })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error?.message ?? `Couldn’t upload your ${VENDOR_DOC_LABELS[docType]}`)
      }
    } catch (err) {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 400 * attempt))
        return uploadOne(vendorId, docType, file, attempt + 1)
      }
      throw err
    }
  }

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
      // `error` is the envelope OBJECT, so a bare `json?.error` produces
      // Error("[object Object]") — read `.error.message`.
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error?.message ?? 'Registration failed')

      // The created vendor's id — previously returned by the route and silently
      // discarded here. It is the only handle the document uploads have.
      const vendorId = json?.data?.id as string | undefined
      if (!vendorId) throw new Error('Registration failed')

      // Uploads happen HERE, after create and BEFORE the success screen. The owner
      // VendorMember is committed in the SAME transaction as the vendor row, so this
      // applicant already passes requireVendorMembershipById — no propagation wait.
      // (The route gates on membership EXISTENCE. If it is ever hardened to
      // requireVendorMayOperate, these uploads break: the applicant is PENDING on both
      // the booth and operator axes at this moment.)
      //
      // Advancing to the success screen is deferred until every upload resolves — that
      // screen carries a live "Go to Vendor Portal" link, and showing it mid-upload
      // invites the applicant to navigate away from files that have not been sent.
      setUploading(true)
      for (const key of REQUIRED_VENDOR_DOCS) {
        const file = docFiles[key]
        if (file) await uploadOne(vendorId, key, file)
      }

      toast.success('Application submitted!')
      setStep(5) // success step
    } catch (err: unknown) {
      console.error('[VendorOnboarding] submit failed', err)
      toast.error(err instanceof Error ? err.message : 'Couldn’t submit your application — please try again.')
    } finally {
      setIsSubmitting(false)
      setUploading(false)
    }
  }

  return (
    <div className="pt-20 min-h-screen pb-20 bg-bg-dark">
      <div className="max-w-[680px] mx-auto px-5 py-10">

        {step < 5 && (
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

        {step < 5 && <ProgressBar step={step} />}

        {/* Step content with key for animation re-trigger */}
        <div key={step} className="animate-fadeIn">
          {step === 1 && <Step1 data={data} update={update} fairs={fairs} eventSlug={eventSlug} setEventSlug={setEventSlug} />}
          {step === 2 && <Step2 data={data} update={update} />}
          {step === 3 && <DocUploadStep files={docFiles} onPick={pickDoc} onClear={clearDoc} uploading={uploading} />}
          {step === 4 && <Step6 data={data} update={update} />}
          {step === 5 && <Step8 data={data} eventSlug={eventSlug} />}
        </div>

        {/* Navigation */}
        {step < 5 && (
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

            {step < 4 ? (
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
