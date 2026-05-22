'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { OrganizerBreadcrumb } from '../../../_components/Breadcrumb'

interface FairSettings {
  id: string
  name: string
  primaryColor: string
  welcomeMessage: string | null
  orderAcceptanceWindowSec: number
  vendorOfflineHideSec: number
  maxVendorsPerOrder: number
  showVendorWaitTimes: boolean
  allowGuestBrowse: boolean
  isPaused: boolean
}

// ─── Field components ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#111111] border border-white/5 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-white/5">
        <p className="text-white font-semibold text-sm tracking-wide">{title}</p>
      </div>
      <div className="px-5 py-4 space-y-5">{children}</div>
    </div>
  )
}

function Toggle({
  label, desc, value, onChange,
}: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-white text-sm font-medium">{label}</p>
        <p className="text-white/40 text-xs font-inter mt-0.5">{desc}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`shrink-0 relative w-11 h-6 rounded-full transition-colors ${value ? 'bg-[#FF0077]' : 'bg-white/10'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  )
}

function NumberField({
  label, desc, value, unit, min, max, onChange,
}: { label: string; desc: string; value: number; unit: string; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-white text-sm font-medium">{label}</p>
        <p className="text-white/40 text-xs font-inter mt-0.5">{desc}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={e => onChange(Math.min(max, Math.max(min, Number(e.target.value))))}
          className="w-16 bg-white/[0.05] border border-white/10 rounded-lg px-2 py-1.5 text-white text-sm text-center outline-none focus:border-[#FF0077] font-inter"
        />
        <span className="text-white/30 text-xs font-inter whitespace-nowrap">{unit}</span>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FairSettingsPage() {
  const { fairSlug } = useParams<{ fairSlug: string }>()
  const [settings, setSettings] = useState<FairSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    fetch(`/api/organizer/fairs/${fairSlug}/settings`)
      .then(r => r.json())
      .then(json => { if (json.data) setSettings(json.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [fairSlug])

  const update = useCallback(<K extends keyof FairSettings>(key: K, value: FairSettings[K]) => {
    setSettings(prev => prev ? { ...prev, [key]: value } : prev)
    setDirty(true)
  }, [])

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch(`/api/organizer/fairs/${fairSlug}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryColor:             settings.primaryColor,
          welcomeMessage:           settings.welcomeMessage,
          orderAcceptanceWindowSec: settings.orderAcceptanceWindowSec,
          vendorOfflineHideSec:     settings.vendorOfflineHideSec,
          maxVendorsPerOrder:       settings.maxVendorsPerOrder,
          showVendorWaitTimes:      settings.showVendorWaitTimes,
          allowGuestBrowse:         settings.allowGuestBrowse,
          isPaused:                 settings.isPaused,
        }),
      })
      if (res.ok) {
        toast.success('Settings saved')
        setDirty(false)
      } else {
        toast.error('Failed to save — please try again')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 animate-pulse">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-40 bg-white/[0.03] rounded-xl" />
        ))}
      </div>
    )
  }

  if (!settings) {
    return <p className="text-white/40 font-inter text-sm">Fair not found.</p>
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <OrganizerBreadcrumb crumbs={[
        { label: 'My Fairs', href: '/organizer/fairs' },
        { label: settings.name, href: `/organizer/fairs/${fairSlug}` },
        { label: 'Settings' },
      ]} />
      <div>
        <h1 className="font-bebas text-3xl text-white tracking-wide">
          Fair <span className="text-[#FF0077]">Settings</span>
        </h1>
        <p className="text-white/40 text-sm font-inter mt-1">{settings.name}</p>
      </div>

      <Section title="Platform Status">
        <Toggle
          label="Platform Paused"
          desc="Block all new orders across this fair immediately"
          value={settings.isPaused}
          onChange={v => update('isPaused', v)}
        />
      </Section>

      <Section title="Operational Timing">
        <NumberField
          label="Vendor acceptance window"
          desc="Seconds a vendor has to accept before auto-cancel"
          value={settings.orderAcceptanceWindowSec}
          unit="sec"
          min={30}
          max={600}
          onChange={v => update('orderAcceptanceWindowSec', v)}
        />
        <NumberField
          label="Vendor offline hide delay"
          desc="Seconds before an offline vendor disappears from the menu"
          value={settings.vendorOfflineHideSec}
          unit="sec"
          min={0}
          max={1800}
          onChange={v => update('vendorOfflineHideSec', v)}
        />
        <NumberField
          label="Max vendors per order"
          desc="Cart cap — how many vendors a customer can combine"
          value={settings.maxVendorsPerOrder}
          unit="vendors"
          min={1}
          max={10}
          onChange={v => update('maxVendorsPerOrder', v)}
        />
      </Section>

      <Section title="Fair Branding">
        <div>
          <p className="text-white/40 text-xs uppercase tracking-wider mb-2 font-inter">Accent Color</p>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={settings.primaryColor}
              onChange={e => update('primaryColor', e.target.value)}
              className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent p-0"
            />
            <span className="text-white/60 text-sm font-mono">{settings.primaryColor}</span>
            <button
              type="button"
              onClick={() => update('primaryColor', '#FF0077')}
              className="text-white/30 text-xs hover:text-white/60 font-inter transition-colors"
            >
              Reset
            </button>
          </div>
          <p className="text-white/25 text-xs font-inter mt-1.5">Applied to buttons and highlights on the customer menu</p>
        </div>

        <div>
          <p className="text-white/40 text-xs uppercase tracking-wider mb-2 font-inter">Welcome Message</p>
          <input
            type="text"
            value={settings.welcomeMessage ?? ''}
            onChange={e => update('welcomeMessage', e.target.value || null)}
            placeholder="Welcome to Italian Fest 2026! Enjoy the food."
            maxLength={120}
            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-white/20 focus:border-[#FF0077] outline-none font-inter"
          />
          <p className="text-white/25 text-xs font-inter mt-1.5">Shown on the fair home page · max 120 characters</p>
        </div>
      </Section>

      <Section title="Customer Experience">
        <Toggle
          label="Show vendor wait times"
          desc="Display estimated prep time on menu items"
          value={settings.showVendorWaitTimes}
          onChange={v => update('showVendorWaitTimes', v)}
        />
        <Toggle
          label="Allow guest browsing"
          desc="Let customers browse the menu without logging in"
          value={settings.allowGuestBrowse}
          onChange={v => update('allowGuestBrowse', v)}
        />
      </Section>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !dirty}
        className="w-full py-3 bg-[#FF0077] hover:bg-[#e6006b] text-white font-bold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving…' : 'Save Settings'}
      </button>
    </div>
  )
}
