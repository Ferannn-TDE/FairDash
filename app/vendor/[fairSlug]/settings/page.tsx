'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { useClerk } from '@clerk/clerk-react'
import {
  BuildingStorefrontIcon,
  BellIcon,
  ClockIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline'

// ─── Mock data ────────────────────────────────────────────────────────────────

const mockProfile = {
  name: 'Smoky Barrel BBQ',
  cuisineType: 'BBQ & Grilled',
  description: 'Slow-smoked meats and classic sides, bringing authentic BBQ to every fair.',
  boothNumber: 'B-14',
  stripeOnboarded: true,
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
type Day = typeof DAYS[number]

const defaultHours: Record<Day, { open: string; close: string; enabled: boolean }> = {
  Mon: { open: '10:00', close: '20:00', enabled: true  },
  Tue: { open: '10:00', close: '20:00', enabled: true  },
  Wed: { open: '10:00', close: '20:00', enabled: true  },
  Thu: { open: '10:00', close: '21:00', enabled: true  },
  Fri: { open: '10:00', close: '22:00', enabled: true  },
  Sat: { open: '09:00', close: '22:00', enabled: true  },
  Sun: { open: '10:00', close: '18:00', enabled: false },
}

const mockDocs = [
  { id: 'doc_food', label: 'Food Handler Permit', uploaded: true  },
  { id: 'doc_ins',  label: 'Liability Insurance',  uploaded: true  },
  { id: 'doc_biz',  label: 'Business License',     uploaded: false },
]

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
      {showConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowConfirm(false)} />
          <div className="relative w-full max-w-md bg-[#1A1A1A] border border-white/10 rounded-2xl p-6 shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
            <h3 className="font-bebas text-3xl tracking-wide text-white mb-2">Sign Out?</h3>
            <p className="text-text-gray text-sm mb-6 leading-relaxed">Are you sure you want to sign out? You'll need to sign in again to access your vendor dashboard.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => signOut({ redirectUrl: '/' })}
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold text-sm cursor-pointer border-0"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VendorSettingsPage() {
  const [form, setForm] = useState({
    name: mockProfile.name,
    cuisineType: mockProfile.cuisineType,
    description: mockProfile.description,
  })
  const [saving, setSaving] = useState(false)

  const [notifs, setNotifs] = useState({
    newOrder: true,
    orderReady: true,
    dailySummary: false,
    marketing: false,
  })

  const [hours, setHours] = useState(defaultHours)

  const [docs, setDocs] = useState(mockDocs)

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setTimeout(() => {
      setSaving(false)
      toast.success('Profile updated')
    }, 700)
  }

  function toggleNotif(key: keyof typeof notifs) {
    setNotifs(p => ({ ...p, [key]: !p[key] }))
  }

  function setHour(day: Day, field: 'open' | 'close' | 'enabled', value: string | boolean) {
    setHours(p => ({ ...p, [day]: { ...p[day], [field]: value } }))
  }

  function handleDocUpload(id: string) {
    setTimeout(() => {
      setDocs(prev => prev.map(d => d.id === id ? { ...d, uploaded: true } : d))
      toast.success('Document uploaded')
    }, 600)
    toast.loading('Uploading…', { duration: 600 })
  }

  return (
    <div className="p-5 md:p-4 max-w-[52rem] mx-auto">
      <h1 className="font-bebas text-2xl tracking-wide text-white leading-none mb-6">
        Vendor <span className="text-neon-pink">Settings</span>
      </h1>

      <div className="space-y-5">

        {/* Business Profile */}
        <SectionCard icon={BuildingStorefrontIcon} title="Business Profile">
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className={labelCls}>Business Name *</label>
              <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Cuisine Type *</label>
              <input required value={form.cuisineType} onChange={e => setForm(p => ({ ...p, cuisineType: e.target.value }))} placeholder="e.g., BBQ, Mexican, Desserts" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea rows={3} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Tell customers about your food…" className={`${inputCls} resize-none`} />
            </div>
            {mockProfile.boothNumber && (
              <div>
                <label className={labelCls}>Booth Number</label>
                <div className={`${inputCls} bg-white/[0.02] text-text-gray cursor-not-allowed`}>{mockProfile.boothNumber}</div>
                <p className="text-text-gray text-xs mt-1">Assigned by the event organizer.</p>
              </div>
            )}
            <div className="flex justify-end">
              <button type="submit" disabled={saving} className="px-5 py-2.5 bg-neon-pink text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors cursor-pointer disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </SectionCard>

        {/* Notifications */}
        <SectionCard icon={BellIcon} title="Notifications">
          <div className="space-y-4">
            {([
              { key: 'newOrder',      label: 'New order received',       sub: 'Alert when a customer places an order' },
              { key: 'orderReady',    label: 'Order status changes',      sub: 'Notify when runner picks up an order' },
              { key: 'dailySummary',  label: 'Daily summary email',       sub: 'End-of-day sales recap to your email' },
              { key: 'marketing',     label: 'FairSynq announcements',    sub: 'Platform updates and tips' },
            ] as { key: keyof typeof notifs; label: string; sub: string }[]).map(({ key, label, sub }) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-white text-sm font-medium">{label}</p>
                  <p className="text-text-gray text-xs mt-0.5">{sub}</p>
                </div>
                <button
                  onClick={() => toggleNotif(key)}
                  className={`relative w-10 h-5.5 rounded-full transition-colors duration-300 cursor-pointer border-0 shrink-0 ${notifs[key] ? 'bg-neon-pink' : 'bg-white/20'}`}
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
                  onClick={() => setHour(day, 'enabled', !hours[day].enabled)}
                  className={`relative w-9 h-[20px] rounded-full transition-colors duration-300 cursor-pointer border-0 shrink-0 ${hours[day].enabled ? 'bg-neon-pink' : 'bg-white/20'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-[16px] h-[16px] bg-white rounded-full shadow transition-transform duration-300 ${hours[day].enabled ? 'translate-x-[16px]' : 'translate-x-0'}`} />
                </button>
                <span className={`w-8 text-xs font-semibold shrink-0 ${hours[day].enabled ? 'text-white' : 'text-text-gray'}`}>{day}</span>
                {hours[day].enabled ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="time"
                      value={hours[day].open}
                      onChange={e => setHour(day, 'open', e.target.value)}
                      className="flex-1 bg-bg-dark border border-white/10 rounded-lg px-3 py-1.5 text-white text-xs outline-none focus:border-neon-pink transition-colors"
                    />
                    <span className="text-text-gray text-xs shrink-0">–</span>
                    <input
                      type="time"
                      value={hours[day].close}
                      onChange={e => setHour(day, 'close', e.target.value)}
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
                onClick={() => toast.success('Hours saved')}
                className="px-4 py-2 bg-white/5 border border-white/10 text-white rounded-xl text-xs font-semibold hover:bg-white/10 transition-colors cursor-pointer"
              >
                Save Hours
              </button>
            </div>
          </div>
        </SectionCard>

        {/* Documents */}
        <SectionCard icon={DocumentTextIcon} title="Documents">
          <div className="space-y-3">
            {docs.map(doc => (
              <div key={doc.id} className={`flex items-center justify-between gap-3 p-3.5 rounded-xl border ${doc.uploaded ? 'border-emerald-500/20 bg-emerald-500/[0.04]' : 'border-white/[0.06] bg-white/[0.02]'}`}>
                <div className="flex items-center gap-3">
                  <CheckCircleIcon className={`w-4 h-4 shrink-0 ${doc.uploaded ? 'text-emerald-400' : 'text-text-gray/30'}`} />
                  <div>
                    <p className="text-white text-sm font-medium">{doc.label}</p>
                    <p className={`text-xs mt-0.5 ${doc.uploaded ? 'text-emerald-400/70' : 'text-text-gray'}`}>
                      {doc.uploaded ? 'Uploaded' : 'Required — not yet uploaded'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => !doc.uploaded && handleDocUpload(doc.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    doc.uploaded
                      ? 'bg-white/5 border border-white/10 text-text-gray hover:bg-white/10'
                      : 'bg-neon-pink/10 border border-neon-pink/30 text-neon-pink hover:bg-neon-pink/20'
                  }`}
                >
                  {doc.uploaded ? 'Replace' : 'Upload'}
                </button>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Payments */}
        <SectionCard icon={BuildingStorefrontIcon} title="Payments">
          {mockProfile.stripeOnboarded ? (
            <div className="flex items-center gap-3 p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
              <CheckCircleIcon className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <p className="text-white font-semibold text-sm">Stripe account connected</p>
                <p className="text-text-gray text-xs">Payouts are configured and active.</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-white font-semibold text-sm mb-1">Connect your Stripe account</p>
                <p className="text-text-gray text-xs">Required to receive payouts from FairSynq.</p>
              </div>
              <button
                onClick={() => toast('Stripe Connect coming soon', { icon: '💳' })}
                className="px-4 py-2.5 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors cursor-pointer"
              >
                Connect Stripe
              </button>
            </div>
          )}
        </SectionCard>

        {/* Account */}
        <AccountSection />

        {/* Danger Zone */}
        <div className="bg-bg-card border border-red-500/20 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-red-500/10">
            <h2 className="font-bebas text-base tracking-wide text-red-400">Danger Zone</h2>
          </div>
          <div className="p-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-white font-semibold text-sm mb-0.5">Deactivate vendor profile</p>
              <p className="text-text-gray text-xs">You will be removed from all active fairs. This cannot be undone.</p>
            </div>
            <button
              onClick={() => toast.error('Please contact support to deactivate your account.')}
              className="px-4 py-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm font-semibold hover:bg-red-500/20 transition-colors cursor-pointer"
            >
              Deactivate
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
