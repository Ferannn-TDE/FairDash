'use client'

import { useEffect, useState } from 'react'
import { useUser, useClerk } from '@clerk/clerk-react'
import { User, Phone, Mail, Car, Bell, Clock, LogOut, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import StripeConnectCard from '../../../_components/StripeConnectCard'
import ConfirmModal from '@/app/_components/ui/ConfirmModal'
import LicenseCard from './LicenseCard'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Settings {
  phone: string
  vehicleMake: string
  vehicleModel: string
  vehicleColor: string
  vehiclePlate: string
  notifyNewDelivery: boolean
  notifyOrderUpdates: boolean
  notifyEarnings: boolean
  availableDays: string[]
}

const EMPTY: Settings = {
  phone: '', vehicleMake: '', vehicleModel: '', vehicleColor: '', vehiclePlate: '',
  notifyNewDelivery: true, notifyOrderUpdates: true, notifyEarnings: false, availableDays: [],
}

// Map a Runner API row → the editable form shape (nulls → '').
function fromRunner(r: Record<string, unknown>): Settings {
  return {
    phone: (r.phone as string) ?? '',
    vehicleMake: (r.vehicleMake as string) ?? '',
    vehicleModel: (r.vehicleModel as string) ?? '',
    vehicleColor: (r.vehicleColor as string) ?? '',
    vehiclePlate: (r.vehiclePlate as string) ?? '',
    notifyNewDelivery: r.notifyNewDelivery !== false,
    notifyOrderUpdates: r.notifyOrderUpdates !== false,
    notifyEarnings: r.notifyEarnings === true,
    availableDays: Array.isArray(r.availableDays) ? (r.availableDays as string[]) : [],
  }
}

export default function RunnerSettingsPage() {
  const { user } = useUser()
  const { signOut } = useClerk()

  const [form, setForm] = useState<Settings>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [signOutOpen, setSignOutOpen] = useState(false)

  const fullName = user?.fullName ?? user?.firstName ?? ''
  const email = user?.primaryEmailAddress?.emailAddress ?? ''

  // Render from the authoritative source: hydrate the form from the runner's real
  // persisted settings before showing editable inputs (no empty-flash / fake defaults).
  useEffect(() => {
    fetch('/api/runners/me')
      .then(r => r.json())
      .then(j => { if (j.success && j.data.runner) setForm(fromRunner(j.data.runner)) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm(f => ({ ...f, [key]: value }))
  const toggleDay = (day: string) =>
    setForm(f => ({ ...f, availableDays: f.availableDays.includes(day) ? f.availableDays.filter(d => d !== day) : [...f.availableDays, day] }))

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/runners/me', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        setForm(fromRunner(json.data.runner)) // re-sync from what actually persisted
        toast.success('Settings saved')
      } else {
        toast.error(json.error?.message ?? 'Could not save settings')
      }
    } catch { toast.error('Network error — try again') } finally { setSaving(false) }
  }

  const inputCls = 'w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors disabled:opacity-50'

  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 sm:py-8 space-y-5">

      <h1 className="font-bebas text-[clamp(1.75rem,5vw,2.5rem)] tracking-wide text-white leading-tight">
        Runner <span className="text-neon-pink">Settings</span>
      </h1>

      {/* Profile — name/email are Clerk-owned (account-managed); phone persists here */}
      <div className="bg-bg-card border border-white/10 rounded-2xl p-5 space-y-4">
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold flex items-center gap-2">
          <User className="w-3.5 h-3.5" /> Profile
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold block mb-1.5">Full Name</label>
            <input value={fullName} readOnly placeholder="—"
              className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 text-text-gray text-sm outline-none cursor-not-allowed" />
          </div>
          <div>
            <label className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold block mb-1.5">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-gray" />
              <input value={email} readOnly placeholder="—"
                className="w-full bg-white/[0.03] border border-white/5 rounded-xl pl-9 pr-4 py-3 text-text-gray text-sm outline-none cursor-not-allowed" />
            </div>
          </div>
          <div>
            <label className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold block mb-1.5">Phone</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-gray" />
              <input value={form.phone} onChange={e => set('phone', e.target.value)} disabled={loading || saving}
                placeholder="Add a contact number" className={inputCls.replace('px-4', 'pl-9 pr-4')} />
            </div>
          </div>
          <p className="text-text-gray/70 text-xs">Name &amp; email are managed by your account.</p>
        </div>
      </div>

      {/* Vehicle info */}
      <div className="bg-bg-card border border-white/10 rounded-2xl p-5 space-y-4">
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold flex items-center gap-2">
          <Car className="w-3.5 h-3.5" /> Vehicle Info
        </p>
        <div className="grid grid-cols-2 gap-3">
          {([
            ['Make', 'vehicleMake'], ['Model', 'vehicleModel'], ['Color', 'vehicleColor'], ['Plate', 'vehiclePlate'],
          ] as const).map(([label, key]) => (
            <div key={key}>
              <label className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold block mb-1.5">{label}</label>
              <input value={form[key]} onChange={e => set(key, e.target.value)} disabled={loading || saving}
                placeholder="—"
                className="w-full bg-bg-dark border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-neon-pink transition-colors disabled:opacity-50" />
            </div>
          ))}
        </div>
      </div>

      {/* Driver's licence — sensitive PII; owns its own load/save cycle (multipart upload,
          private bucket, signed preview), so it is NOT part of the JSON `form` PATCH. */}
      <LicenseCard />

      {/* Notifications */}
      <div className="bg-bg-card border border-white/10 rounded-2xl p-5 space-y-4">
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold flex items-center gap-2">
          <Bell className="w-3.5 h-3.5" /> Notifications
        </p>
        <div className="space-y-3">
          {([
            ['notifyNewDelivery', 'New delivery requests', 'Alert when a delivery is assigned'],
            ['notifyOrderUpdates', 'Order updates', 'Status changes on your active delivery'],
            ['notifyEarnings', 'Earnings summary', 'Daily earnings recap'],
          ] as const).map(([key, label, sub]) => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-semibold">{label}</p>
                <p className="text-text-gray text-xs">{sub}</p>
              </div>
              <button type="button" role="switch" aria-checked={form[key]} disabled={loading || saving}
                onClick={() => set(key, !form[key])}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer border-0 shrink-0 disabled:opacity-50 ${form[key] ? 'bg-neon-pink' : 'bg-white/10'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form[key] ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Availability */}
      <div className="bg-bg-card border border-white/10 rounded-2xl p-5 space-y-4">
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold flex items-center gap-2">
          <Clock className="w-3.5 h-3.5" /> Availability
        </p>
        <p className="text-text-gray text-xs -mt-2">Select days you&apos;re available to run deliveries.</p>
        <div className="flex flex-wrap gap-2">
          {DAYS.map(day => {
            const on = form.availableDays.includes(day)
            return (
              <button key={day} type="button" onClick={() => toggleDay(day)} disabled={loading || saving}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer disabled:opacity-50 ${
                  on ? 'bg-neon-pink border-neon-pink text-white' : 'bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white'
                }`}>
                {day}
              </button>
            )
          })}
        </div>
      </div>

      {/* Payouts — real Stripe Connect */}
      <div className="bg-bg-card border border-white/10 rounded-2xl p-5 space-y-4">
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold flex items-center gap-2">
          <Wallet className="w-3.5 h-3.5" /> Payouts
        </p>
        <StripeConnectCard basePath="/api/runners/me/stripe"
          description="Connect a Stripe account to receive your delivery earnings from FairSynq." />
      </div>

      {/* Save */}
      <button onClick={save} disabled={loading || saving}
        className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all border-0 cursor-pointer bg-neon-pink text-white hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] disabled:opacity-50 disabled:cursor-not-allowed">
        {saving ? 'Saving…' : loading ? 'Loading…' : 'Save Changes'}
      </button>

      {/* Sign out — confirmation modal, matching the app's ConfirmModal pattern */}
      <button onClick={() => setSignOutOpen(true)}
        className="w-full py-3.5 bg-white/5 border border-white/10 text-red-400 rounded-xl font-semibold text-sm hover:bg-red-500/10 hover:border-red-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer">
        <LogOut className="w-4 h-4" />
        Sign Out
      </button>

      <ConfirmModal
        open={signOutOpen}
        title="Sign out?"
        message="You'll need to sign in again to access your runner portal."
        confirmLabel="Sign Out"
        cancelLabel="Cancel"
        onConfirm={() => signOut({ redirectUrl: '/' })}
        onCancel={() => setSignOutOpen(false)}
      />

    </div>
  )
}
