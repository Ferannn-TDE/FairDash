'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import toast from 'react-hot-toast'
import { useClerk } from '@clerk/clerk-react'
import {
  BuildingStorefrontIcon,
  BellIcon,
  ClockIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline'
import { useVendorMeta } from '@/lib/contexts/VendorContext'
import ConfirmModal from '@/app/_components/ui/ConfirmModal'

// ─── Types ────────────────────────────────────────────────────────────────────

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
type Day = typeof DAYS[number]
type DayHours = { open: string; close: string; enabled: boolean }

const DEFAULT_HOURS: Record<Day, DayHours> = {
  Mon: { open: '10:00', close: '20:00', enabled: true  },
  Tue: { open: '10:00', close: '20:00', enabled: true  },
  Wed: { open: '10:00', close: '20:00', enabled: true  },
  Thu: { open: '10:00', close: '21:00', enabled: true  },
  Fri: { open: '10:00', close: '22:00', enabled: true  },
  Sat: { open: '09:00', close: '22:00', enabled: true  },
  Sun: { open: '10:00', close: '18:00', enabled: false },
}

const DOC_DEFS = [
  { key: 'foodHandler',     label: 'Food Handler Permit'  },
  { key: 'insurance',       label: 'Liability Insurance'  },
  { key: 'businessLicense', label: 'Business License'     },
] as const
type DocKey = typeof DOC_DEFS[number]['key']

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputCls = 'w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40'
const labelCls = 'block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5'

function SectionCard({ icon: Icon, title, children }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-bg-card border border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2.5">
        <Icon className="w-4 h-4 text-neon-pink" />
        <h2 className="font-bebas text-base tracking-wide text-white">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ─── Account section ─────────────────────────────────────────────────────────

function AccountSection() {
  const { signOut } = useClerk()
  const [showConfirm, setShowConfirm] = useState(false)

  return (
    <div className="bg-bg-card border border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2.5">
        <ArrowRightOnRectangleIcon className="w-4 h-4 text-neon-pink" />
        <h2 className="font-bebas text-base tracking-wide text-white">Account</h2>
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-white font-semibold text-sm mb-0.5">Sign out</p>
            <p className="text-text-gray text-xs">You'll need to sign in again to access your vendor dashboard.</p>
          </div>
          <button
            onClick={() => setShowConfirm(true)}
            className="px-4 py-2.5 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 hover:text-red-400 hover:border-red-500/20 transition-all cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </div>
      <ConfirmModal
        open={showConfirm}
        title="Sign Out?"
        message="Are you sure you want to sign out? You'll need to sign in again to access your vendor dashboard."
        confirmLabel="Sign Out"
        onConfirm={() => signOut({ redirectUrl: '/' })}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VendorSettingsPage() {
  const { vendorId } = useVendorMeta()

  // ── Business profile ──────────────────────────────────────────────────────
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [form, setForm] = useState({ name: '', cuisineType: '', description: '' })
  const [boothNumber, setBoothNumber]       = useState<string | null>(null)
  const [saving, setSaving]                 = useState(false)

  // ── Hours ────────────────────────────────────────────────────────────────
  const [hours, setHours]       = useState<Record<Day, DayHours>>(DEFAULT_HOURS)
  const [savingHours, setSavingHours] = useState(false)

  // ── Documents ────────────────────────────────────────────────────────────
  const [docs, setDocs] = useState<Record<DocKey, { uploaded: boolean; url: string | null }>>({
    foodHandler:     { uploaded: false, url: null },
    insurance:       { uploaded: false, url: null },
    businessLicense: { uploaded: false, url: null },
  })
  const [uploadingDoc, setUploadingDoc] = useState<DocKey | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingDocKey = useRef<DocKey | null>(null)

  // ── Stripe ───────────────────────────────────────────────────────────────
  const [stripeState,  setStripeState]  = useState<'loading' | 'active' | 'incomplete' | 'not_connected'>('loading')
  const [stripeBusy,   setStripeBusy]   = useState(false)

  // Maps the live V2 status response to our UI state machine.
  const applyStripeStatus = (data: { connected: boolean; readyToReceivePayments: boolean }) => {
    if (!data.connected) setStripeState('not_connected')
    else if (data.readyToReceivePayments) setStripeState('active')
    else setStripeState('incomplete')
  }

  const loadStripeStatus = useCallback(async () => {
    if (!vendorId) return
    try {
      const json = await fetch(`/api/vendors/${vendorId}/stripe/status`).then(r => r.json())
      if (json.success) applyStripeStatus(json.data)
    } catch { /* leave prior state */ }
  }, [vendorId])

  // Starts (or resumes) onboarding: ensure an account exists, then redirect to
  // the hosted Stripe onboarding link.
  const startOnboarding = useCallback(async () => {
    if (!vendorId || stripeBusy) return
    setStripeBusy(true)
    try {
      const connect = await fetch(`/api/vendors/${vendorId}/stripe/connect`, { method: 'POST' })
        .then(r => r.json())
      if (!connect.success) { toast.error('Could not start payout setup'); return }

      const link = await fetch(`/api/vendors/${vendorId}/stripe/onboarding-link`, { method: 'POST' })
        .then(r => r.json())
      if (!link.success || !link.data?.url) { toast.error('Could not create onboarding link'); return }

      window.location.href = link.data.url
    } catch {
      toast.error('Network error — please try again')
    } finally {
      setStripeBusy(false)
    }
  }, [vendorId, stripeBusy])

  // On return from the hosted flow (?stripe=return|refresh), re-read live status.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('stripe')
    if (param === 'return' || param === 'refresh') {
      loadStripeStatus()
      if (param === 'return') toast.success('Returned from Stripe — checking status…')
    }
  }, [loadStripeStatus])

  // ── Notifications (local only until notification prefs API is added) ──────
  const [notifs, setNotifs] = useState({
    newOrder: true, orderReady: true, dailySummary: false, marketing: false,
  })

  // ── Initial fetch ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!vendorId) return

    // Load vendor profile + documents + Stripe status in parallel
    Promise.all([
      fetch(`/api/vendors/${vendorId}`).then(r => r.json()),
      fetch(`/api/vendors/${vendorId}/documents`).then(r => r.json()),
      fetch(`/api/vendors/${vendorId}/stripe/status`).then(r => r.json()),
    ])
      .then(([vendorJson, docsJson, stripeJson]) => {
        if (vendorJson.success) {
          const v = vendorJson.data
          setForm({ name: v.name ?? '', cuisineType: v.cuisineType ?? '', description: v.description ?? '' })
          setBoothNumber(v.boothNumber ?? null)
          if (v.operatingHours) {
            setHours(v.operatingHours as Record<Day, DayHours>)
          }
        }
        if (docsJson.success) {
          setDocs(docsJson.data)
        }
        if (stripeJson.success) {
          applyStripeStatus(stripeJson.data)
        }
      })
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoadingProfile(false))
  }, [vendorId])

  // ── Profile save ──────────────────────────────────────────────────────────
  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!vendorId) return
    setSaving(true)
    try {
      const res  = await fetch(`/api/vendors/${vendorId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: form.name, cuisineType: form.cuisineType, description: form.description }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message ?? 'Failed to save')
      toast.success('Profile updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  // ── Hours save ────────────────────────────────────────────────────────────
  async function handleSaveHours() {
    if (!vendorId) return
    setSavingHours(true)
    try {
      const res  = await fetch(`/api/vendors/${vendorId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ operatingHours: hours }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message ?? 'Failed to save')
      toast.success('Hours saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save hours')
    } finally {
      setSavingHours(false)
    }
  }

  // ── Document upload ───────────────────────────────────────────────────────
  function triggerDocUpload(key: DocKey) {
    pendingDocKey.current = key
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file   = e.target.files?.[0]
    const docKey = pendingDocKey.current
    if (!file || !docKey || !vendorId) return
    e.target.value = '' // reset so same file can be re-selected

    const ALLOWED = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!ALLOWED.includes(file.type)) {
      toast.error('File must be a PDF or image (JPEG, PNG, WebP)')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File must be 10 MB or smaller')
      return
    }

    setUploadingDoc(docKey)
    const toastId = toast.loading('Uploading…')
    try {
      const form = new FormData()
      form.append('docType', docKey)
      form.append('file', file)
      const res  = await fetch(`/api/vendors/${vendorId}/documents`, { method: 'POST', body: form })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message ?? 'Upload failed')
      setDocs(json.data.documents)
      toast.success('Document uploaded', { id: toastId })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed', { id: toastId })
    } finally {
      setUploadingDoc(null)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loadingProfile) {
    return (
      <div className="p-5 max-w-[52rem] mx-auto space-y-5">
        {[...Array(4)].map((_, i) => <div key={i} className="h-48 bg-white/5 rounded-2xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="p-5 md:p-4 max-w-[52rem] mx-auto">
      <h1 className="font-bebas text-2xl tracking-wide text-white leading-none mb-6">
        Vendor <span className="text-neon-pink">Settings</span>
      </h1>

      {/* Hidden file input for doc uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,image/jpeg,image/jpg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="space-y-5">

        {/* Business Profile */}
        <SectionCard icon={BuildingStorefrontIcon} title="Business Profile">
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className={labelCls}>Business Name *</label>
              <input
                required
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Cuisine Type *</label>
              <input
                required
                value={form.cuisineType}
                onChange={e => setForm(p => ({ ...p, cuisineType: e.target.value }))}
                placeholder="e.g., BBQ, Mexican, Desserts"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea
                rows={3}
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Tell customers about your food…"
                className={`${inputCls} resize-none`}
              />
            </div>
            {boothNumber && (
              <div>
                <label className={labelCls}>Booth Number</label>
                <div className={`${inputCls} bg-white/[0.02] text-text-gray cursor-not-allowed`}>{boothNumber}</div>
                <p className="text-text-gray text-xs mt-1">Assigned by the event organizer.</p>
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 bg-neon-pink text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </SectionCard>

        {/* Notifications */}
        <SectionCard icon={BellIcon} title="Notifications">
          <div className="space-y-4">
            {([
              { key: 'newOrder',     label: 'New order received',    sub: 'Alert when a customer places an order'    },
              { key: 'orderReady',   label: 'Order status changes',  sub: 'Notify when runner picks up an order'     },
              { key: 'dailySummary', label: 'Daily summary email',   sub: 'End-of-day sales recap to your email'     },
              { key: 'marketing',    label: 'FairSynq announcements', sub: 'Platform updates and tips'              },
            ] as { key: keyof typeof notifs; label: string; sub: string }[]).map(({ key, label, sub }) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-white text-sm font-medium">{label}</p>
                  <p className="text-text-gray text-xs mt-0.5">{sub}</p>
                </div>
                <button
                  onClick={() => setNotifs(p => ({ ...p, [key]: !p[key] }))}
                  className={`relative rounded-full transition-colors duration-300 cursor-pointer border-0 shrink-0 ${notifs[key] ? 'bg-neon-pink' : 'bg-white/20'}`}
                  style={{ height: '22px', width: '40px' }}
                >
                  <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] bg-white rounded-full shadow transition-transform duration-300 ${notifs[key] ? 'translate-x-[18px]' : 'translate-x-0'}`} />
                </button>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Operating Hours */}
        <SectionCard icon={ClockIcon} title="Operating Hours">
          <div className="space-y-3">
            {DAYS.map(day => (
              <div key={day} className="flex items-center gap-3">
                <button
                  onClick={() => setHours(p => ({ ...p, [day]: { ...p[day], enabled: !p[day].enabled } }))}
                  className={`relative rounded-full transition-colors duration-300 cursor-pointer border-0 shrink-0 ${hours[day].enabled ? 'bg-neon-pink' : 'bg-white/20'}`}
                  style={{ height: '20px', width: '36px' }}
                >
                  <span className={`absolute top-0.5 left-0.5 w-[16px] h-[16px] bg-white rounded-full shadow transition-transform duration-300 ${hours[day].enabled ? 'translate-x-[16px]' : 'translate-x-0'}`} />
                </button>
                <span className={`w-8 text-xs font-semibold shrink-0 ${hours[day].enabled ? 'text-white' : 'text-text-gray'}`}>{day}</span>
                {hours[day].enabled ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="time"
                      value={hours[day].open}
                      onChange={e => setHours(p => ({ ...p, [day]: { ...p[day], open: e.target.value } }))}
                      className="flex-1 bg-bg-dark border border-white/10 rounded-lg px-3 py-1.5 text-white text-xs outline-none focus:border-neon-pink transition-colors"
                    />
                    <span className="text-text-gray text-xs shrink-0">–</span>
                    <input
                      type="time"
                      value={hours[day].close}
                      onChange={e => setHours(p => ({ ...p, [day]: { ...p[day], close: e.target.value } }))}
                      className="flex-1 bg-bg-dark border border-white/10 rounded-lg px-3 py-1.5 text-white text-xs outline-none focus:border-neon-pink transition-colors"
                    />
                  </div>
                ) : (
                  <span className="text-text-gray text-xs flex-1">Closed</span>
                )}
              </div>
            ))}
            <div className="flex justify-end mt-2">
              <button
                onClick={handleSaveHours}
                disabled={savingHours}
                className="px-4 py-2 bg-white/5 border border-white/10 text-white rounded-xl text-xs font-semibold hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50"
              >
                {savingHours ? 'Saving…' : 'Save Hours'}
              </button>
            </div>
          </div>
        </SectionCard>

        {/* Documents */}
        <SectionCard icon={DocumentTextIcon} title="Documents">
          <div className="space-y-3">
            {DOC_DEFS.map(({ key, label }) => {
              const doc       = docs[key]
              const uploading = uploadingDoc === key
              return (
                <div
                  key={key}
                  className={`flex items-center justify-between gap-3 p-3.5 rounded-xl border ${doc.uploaded ? 'border-emerald-500/20 bg-emerald-500/[0.04]' : 'border-white/[0.06] bg-white/[0.02]'}`}
                >
                  <div className="flex items-center gap-3">
                    <CheckCircleIcon className={`w-4 h-4 shrink-0 ${doc.uploaded ? 'text-emerald-400' : 'text-text-gray/30'}`} />
                    <div>
                      <p className="text-white text-sm font-medium">{label}</p>
                      <p className={`text-xs mt-0.5 ${doc.uploaded ? 'text-emerald-400/70' : 'text-text-gray'}`}>
                        {doc.uploaded ? 'Uploaded' : 'Required — not yet uploaded'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => !uploading && triggerDocUpload(key)}
                    disabled={uploading}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      doc.uploaded
                        ? 'bg-white/5 border border-white/10 text-text-gray hover:bg-white/10'
                        : 'bg-neon-pink/10 border border-neon-pink/30 text-neon-pink hover:bg-neon-pink/20'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {uploading ? 'Uploading…' : doc.uploaded ? 'Replace' : 'Upload'}
                  </button>
                </div>
              )
            })}
          </div>
        </SectionCard>

        {/* Payments */}
        <SectionCard icon={BuildingStorefrontIcon} title="Payments">
          {stripeState === 'loading' ? (
            <div className="h-14 bg-white/5 rounded-xl animate-pulse" />
          ) : stripeState === 'active' ? (
            <div className="flex items-center gap-3 p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
              <CheckCircleIcon className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <p className="text-white font-semibold text-sm">Payouts active — verified</p>
                <p className="text-text-gray text-xs">Your Stripe account is ready to receive payouts.</p>
              </div>
            </div>
          ) : stripeState === 'incomplete' ? (
            <div className="flex items-center justify-between gap-4 flex-wrap p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
              <div className="flex items-start gap-3">
                <ExclamationCircleIcon className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-white font-semibold text-sm">Payout setup unfinished</p>
                  <p className="text-text-gray text-xs">Your account exists but onboarding isn't complete. Payouts are blocked until you finish.</p>
                </div>
              </div>
              <button
                onClick={startOnboarding}
                disabled={stripeBusy}
                className="px-4 py-2.5 bg-[#FF0077] text-white rounded-xl text-sm font-semibold hover:bg-[#FF0077]/85 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {stripeBusy ? 'Opening…' : 'Finish payout setup'}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-white font-semibold text-sm mb-1">Set up payouts</p>
                <p className="text-text-gray text-xs">Connect a Stripe account to receive payouts from FairSynq.</p>
              </div>
              <button
                onClick={startOnboarding}
                disabled={stripeBusy}
                className="px-4 py-2.5 bg-[#FF0077] text-white rounded-xl text-sm font-semibold hover:bg-[#FF0077]/85 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {stripeBusy ? 'Opening…' : 'Set up payouts'}
              </button>
            </div>
          )}
        </SectionCard>

        {/* Account */}
        <AccountSection />

      </div>
    </div>
  )
}
