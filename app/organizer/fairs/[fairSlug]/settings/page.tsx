'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { OrganizerBreadcrumb } from '../../../_components/Breadcrumb'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FairSettings {
  id: string
  name: string
  status: 'UPCOMING' | 'ACTIVE' | 'INACTIVE'
  primaryColor: string
  welcomeMessage: string | null
  // Operational timing
  orderAcceptanceWindowSec: number
  vendorOfflineHideSec: number
  maxVendorsPerOrder: number
  // Platform
  isPaused: boolean
  // Owner-only
  isOwner: boolean
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, desc, children, danger }: {
  title: string; desc?: string; children: React.ReactNode; danger?: boolean
}) {
  return (
    <div className={`rounded-2xl overflow-hidden border ${danger ? 'border-red-500/20 bg-red-500/[0.02]' : 'border-white/[0.07] bg-[#111]'}`}>
      <div className={`px-5 py-4 border-b ${danger ? 'border-red-500/15' : 'border-white/[0.06]'}`}>
        <p className={`font-semibold text-sm ${danger ? 'text-red-400' : 'text-white'}`}>{title}</p>
        {desc && <p className="text-white/30 text-xs font-inter mt-0.5">{desc}</p>}
      </div>
      <div className="px-5 py-5 space-y-5">{children}</div>
    </div>
  )
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ label, desc, value, onChange, disabled }: {
  label: string; desc?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-white text-sm font-medium font-inter">{label}</p>
        {desc && <p className="text-white/35 text-xs font-inter mt-0.5">{desc}</p>}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`shrink-0 relative w-11 h-6 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${value ? 'bg-neon-pink' : 'bg-white/10'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  )
}

// ── Number field ──────────────────────────────────────────────────────────────

function NumberField({ label, desc, value, unit, min, max, onChange }: {
  label: string; desc?: string; value: number; unit: string; min: number; max: number; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-white text-sm font-medium font-inter">{label}</p>
        {desc && <p className="text-white/35 text-xs font-inter mt-0.5">{desc}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="number"
          min={min} max={max}
          value={value}
          onChange={e => onChange(Math.min(max, Math.max(min, Number(e.target.value))))}
          className="w-16 bg-white/[0.05] border border-white/10 rounded-lg px-2 py-1.5 text-white text-sm text-center outline-none focus:border-neon-pink font-inter"
        />
        <span className="text-white/30 text-xs font-inter whitespace-nowrap">{unit}</span>
      </div>
    </div>
  )
}

// ── Select field ──────────────────────────────────────────────────────────────

function SelectField({ label, desc, value, options, onChange }: {
  label: string; desc?: string; value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-white text-sm font-medium font-inter">{label}</p>
        {desc && <p className="text-white/35 text-xs font-inter mt-0.5">{desc}</p>}
      </div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-white/[0.05] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm outline-none focus:border-neon-pink font-inter cursor-pointer"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FairSettingsPage() {
  const { fairSlug } = useParams<{ fairSlug: string }>()

  const [settings, setSettings] = useState<FairSettings | null>(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [dirty, setDirty]       = useState(false)

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

  async function handleSave() {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch(`/api/organizer/fairs/${fairSlug}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryColor:             settings.primaryColor,
          welcomeMessage:           settings.welcomeMessage,
          status:                   settings.status,
          orderAcceptanceWindowSec: settings.orderAcceptanceWindowSec,
          vendorOfflineHideSec:     settings.vendorOfflineHideSec,
          maxVendorsPerOrder:       settings.maxVendorsPerOrder,
          isPaused:                 settings.isPaused,
        }),
      })
      const json = await res.json()
      if (json.success) {
        toast.success('Settings saved')
        setDirty(false)
      } else {
        toast.error(json.error?.message ?? 'Failed to save')
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
        {[...Array(4)].map((_, i) => <div key={i} className="h-44 bg-white/[0.03] rounded-2xl" />)}
      </div>
    )
  }

  if (!settings) {
    return <p className="text-white/30 font-inter text-sm">Fair not found.</p>
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <OrganizerBreadcrumb crumbs={[
        { label: 'My Fairs', href: '/organizer/fairs' },
        { label: settings.name, href: `/organizer/fairs/${fairSlug}` },
        { label: 'Settings' },
      ]} />

      <div>
        <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.25rem)] tracking-wide text-white leading-tight">
          Fair <span className="text-neon-pink">Settings</span>
        </h1>
        <p className="text-white/30 text-sm font-inter mt-0.5">{settings.name}</p>
      </div>

      {/* Fair Status */}
      <Section title="Fair Status" desc="Controls whether this fair accepts orders">
        <Toggle
          label="Platform Paused"
          desc="Block all new orders across this fair immediately — vendors still logged in won't see new orders"
          value={settings.isPaused}
          onChange={v => update('isPaused', v)}
        />
        <SelectField
          label="Fair Status"
          desc="UPCOMING = visible but not accepting orders · ACTIVE = fully live · INACTIVE = closed"
          value={settings.status}
          options={[
            { value: 'UPCOMING', label: 'Upcoming' },
            { value: 'ACTIVE',   label: 'Active' },
            { value: 'INACTIVE', label: 'Inactive' },
          ]}
          onChange={v => update('status', v as FairSettings['status'])}
        />
      </Section>

      {/* Fair Branding */}
      <Section title="Fair Branding">
        <div>
          <p className="text-white/35 text-xs uppercase tracking-wider mb-2 font-semibold font-inter">Accent Color</p>
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
              className="text-white/25 text-xs hover:text-white/50 font-inter transition-colors cursor-pointer"
            >
              Reset to default
            </button>
          </div>
          <p className="text-white/20 text-xs font-inter mt-1.5">Applied to buttons and highlights on the customer menu</p>
        </div>
        <div>
          <p className="text-white/35 text-xs uppercase tracking-wider mb-2 font-semibold font-inter">Welcome Message</p>
          <div className="relative">
            <input
              type="text"
              value={settings.welcomeMessage ?? ''}
              onChange={e => update('welcomeMessage', e.target.value || null)}
              placeholder="Welcome to Italian Fest 2026! Enjoy the food."
              maxLength={120}
              className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-white/15 focus:border-neon-pink outline-none font-inter pr-12"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 text-[0.65rem] font-inter tabular-nums">
              {(settings.welcomeMessage ?? '').length}/120
            </span>
          </div>
          <p className="text-white/20 text-xs font-inter mt-1.5">Shown on the fair home page · max 120 chars</p>
        </div>
      </Section>

      {/* Operational Timing */}
      <Section title="Operational Timing" desc="Controls how quickly vendors must respond to orders">
        <NumberField
          label="Vendor acceptance window"
          desc="Seconds vendor has to accept an order before auto-cancel"
          value={settings.orderAcceptanceWindowSec}
          unit="sec" min={30} max={600}
          onChange={v => update('orderAcceptanceWindowSec', v)}
        />
        <NumberField
          label="Vendor offline hide delay"
          desc="Seconds before an offline vendor is hidden from the customer menu"
          value={settings.vendorOfflineHideSec}
          unit="sec" min={60} max={1800}
          onChange={v => update('vendorOfflineHideSec', v)}
        />
        <NumberField
          label="Max vendors per cart"
          desc="How many different vendors a customer can combine in one order"
          value={settings.maxVendorsPerOrder}
          unit="vendors" min={1} max={10}
          onChange={v => update('maxVendorsPerOrder', v)}
        />
      </Section>

      {/* Save button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !dirty}
        className="w-full py-3 bg-neon-pink hover:bg-[#e6006b] text-white font-bold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-inter"
      >
        {saving ? 'Saving…' : dirty ? 'Save Settings' : 'No changes'}
      </button>

    </div>
  )
}
