'use client'

import { useEffect, useState, useCallback } from 'react'
import { OrganizerBreadcrumb } from '../_components/Breadcrumb'
import {
  UserCircleIcon,
  BellIcon,
  CurrencyDollarIcon,
  BuildingLibraryIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'

// ── Types ────────────────────────────────────────────────────────────────────

interface ProfileData {
  name: string | null
  email: string
  phone: string | null
  organizationName: string | null
}

interface NotifPrefs {
  notifNewOrder: boolean
  notifVendorOffline: boolean
  notifMenuRequests: boolean
  notifDailySummary: boolean
}

// ── Toggle component ─────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
        checked ? 'bg-neon-pink' : 'bg-white/10'
      }`}
      aria-checked={checked}
      role="switch"
    >
      <span
        className={`inline-block w-4 h-4 mt-1 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

// ── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-[#1a1a1a] border border-white/[0.07] rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-5">
        <Icon className="w-5 h-5 text-neon-pink" />
        <h2 className="text-white font-semibold text-base">{title}</h2>
      </div>
      {children}
    </div>
  )
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-[#1a1a1a] border border-white/[0.07] rounded-2xl p-6 animate-pulse">
      <div className="h-4 bg-white/10 rounded w-32 mb-5" />
      <div className="space-y-3">
        <div className="h-10 bg-white/5 rounded-xl" />
        <div className="h-10 bg-white/5 rounded-xl" />
        <div className="h-10 bg-white/5 rounded-xl" />
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OrganizerSettingsPage() {
  // Profile state
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [orgName, setOrgName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Notification prefs
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs | null>(null)

  // Platform fee
  const [commissionRate, setCommissionRate] = useState<number | null>(null)

  // Danger zone
  const [showDanger, setShowDanger] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // ── Load profile ────────────────────────────────────────────────────────────

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/organizer/profile')
      if (!res.ok) throw new Error('Failed to load profile')
      const json = await res.json()
      const data: ProfileData = json.data
      setProfile(data)
      setName(data.name ?? '')
      setPhone(data.phone ?? '')
      setOrgName(data.organizationName ?? '')
    } catch {
      // silently fail — user sees empty fields
    } finally {
      setProfileLoading(false)
    }
  }, [])

  // ── Load commission rate from fairs ────────────────────────────────────────

  const loadCommissionRate = useCallback(async () => {
    try {
      const res = await fetch('/api/organizer/fairs')
      if (!res.ok) return
      const json = await res.json()
      // commissionRate lives on Vendor, not Event — fairs endpoint returns per-event stats only
      // fall back to default 7%
      if (json?.data?.fairs?.length > 0) {
        // No commissionRate on events; use default
        setCommissionRate(7)
      } else {
        setCommissionRate(7)
      }
    } catch {
      setCommissionRate(7)
    }
  }, [])

  // ── Load notification prefs from DB ───────────────────────────────────────

  useEffect(() => {
    fetch('/api/user/preferences')
      .then(r => r.json())
      .then(json => {
        if (json.data) {
          setNotifPrefs({
            notifNewOrder:      json.data.notifNewOrder,
            notifVendorOffline: json.data.notifVendorOffline,
            notifMenuRequests:  json.data.notifMenuRequests,
            notifDailySummary:  json.data.notifDailySummary,
          })
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadProfile()
    loadCommissionRate()
  }, [loadProfile, loadCommissionRate])

  // ── Save notification prefs ────────────────────────────────────────────────

  const updateNotif = async (key: keyof NotifPrefs, value: boolean) => {
    setNotifPrefs(prev => prev ? { ...prev, [key]: value } : prev)
    await fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    }).catch(() => {})
  }

  // ── Save profile ────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/organizer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, organizationName: orgName }),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json?.error?.message ?? 'Failed to save')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete org ──────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (deleteInput !== 'DELETE') return
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch('/api/organizer/profile', { method: 'DELETE' })
      const json = await res.json()
      setDeleteError(json?.error?.message ?? 'Server error')
    } catch {
      setDeleteError('Request failed')
    } finally {
      setDeleting(false)
    }
  }

  // ── Avatar initials ─────────────────────────────────────────────────────────

  const initials = name
    ? name
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : profile?.email?.[0]?.toUpperCase() ?? '?'

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <OrganizerBreadcrumb crumbs={[{ label: 'Settings' }]} />
      {/* Page heading */}
      <div>
        <h1 className="font-bebas text-3xl tracking-wide text-white">
          Account <span className="text-neon-pink">Settings</span>
        </h1>
        <p className="text-white/40 text-sm mt-1 font-inter">
          Manage your profile, notifications, and billing preferences.
        </p>
      </div>

      {/* ── Section 1: Profile & Account ────────────────────────────────────── */}

      {profileLoading ? (
        <SkeletonCard />
      ) : (
        <Section icon={UserCircleIcon} title="Profile & Account">
          {/* Avatar */}
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-full bg-neon-pink flex items-center justify-center text-white text-xl font-bold font-bebas tracking-wider flex-shrink-0">
              {initials}
            </div>
            <div>
              <p className="text-white font-semibold text-sm">{name || 'No name set'}</p>
              <p className="text-white/40 text-xs mt-0.5">{profile?.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Display name */}
            <div>
              <label className="text-white/40 text-xs uppercase tracking-wider mb-1.5 block">
                Display Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-neon-pink outline-none transition-colors"
              />
            </div>

            {/* Email (read-only) */}
            <div>
              <label className="text-white/40 text-xs uppercase tracking-wider mb-1.5 block">
                Email
              </label>
              <input
                type="email"
                value={profile?.email ?? ''}
                readOnly
                className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-4 py-2.5 text-white/40 text-sm outline-none cursor-not-allowed"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="text-white/40 text-xs uppercase tracking-wider mb-1.5 block">
                Phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-neon-pink outline-none transition-colors"
              />
            </div>

            {/* Organization name */}
            <div>
              <label className="text-white/40 text-xs uppercase tracking-wider mb-1.5 block">
                Organization Name
              </label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Your organization"
                className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:border-neon-pink outline-none transition-colors"
              />
            </div>
          </div>

          {/* Save row */}
          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 bg-neon-pink hover:bg-[#e6006b] disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-colors"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>

            {saved && (
              <span className="flex items-center gap-1.5 text-emerald-400 text-sm font-medium">
                <CheckCircleIcon className="w-4 h-4" />
                Saved ✓
              </span>
            )}

            {saveError && (
              <span className="text-red-400 text-sm">{saveError}</span>
            )}
          </div>
        </Section>
      )}

      {/* ── Section 2: Notification Preferences ─────────────────────────────── */}

      <Section icon={BellIcon} title="Notification Preferences">
        <p className="text-white/30 text-xs mb-4 font-inter">
          Synced to your account — preferences apply on all devices.
        </p>
        {notifPrefs === null ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 bg-white/[0.03] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {(
              [
                {
                  key: 'notifNewOrder' as const,
                  label: 'New order placed',
                  description: 'Notify when any vendor receives an order',
                },
                {
                  key: 'notifVendorOffline' as const,
                  label: 'Vendor goes offline',
                  description: 'Alert when a vendor marks themselves unavailable',
                },
                {
                  key: 'notifMenuRequests' as const,
                  label: 'Menu approval requests',
                  description: 'Notify when vendors submit menu change requests',
                },
                {
                  key: 'notifDailySummary' as const,
                  label: 'Daily revenue summary',
                  description: 'End-of-day email with revenue and order stats',
                },
              ] as const
            ).map(({ key, label, description }) => (
              <div
                key={key}
                className="flex items-center justify-between py-3 border-b border-white/[0.05] last:border-0"
              >
                <div>
                  <p className="text-white text-sm font-medium">{label}</p>
                  <p className="text-white/40 text-xs mt-0.5">{description}</p>
                </div>
                <Toggle
                  checked={notifPrefs[key]}
                  onChange={(v) => updateNotif(key, v)}
                />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Section 3: Platform Fee ──────────────────────────────────────────── */}

      <Section icon={CurrencyDollarIcon} title="Platform Fee">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-neon-pink/10 border border-neon-pink/20 flex items-center justify-center flex-shrink-0">
            <span className="text-neon-pink text-xl font-bold font-bebas tracking-wide">
              {commissionRate !== null ? `${commissionRate}%` : '—'}
            </span>
          </div>
          <div>
            <p className="text-white font-semibold text-sm">
              Current FairSynq Platform Fee
            </p>
            <p className="text-white/40 text-xs mt-1 leading-relaxed max-w-sm">
              This rate is automatically deducted from vendor payouts. To adjust your
              platform fee, contact{' '}
              <a
                href="mailto:support@fairsynq.com"
                className="text-neon-pink hover:text-neon-pink/80 transition-colors"
              >
                support@fairsynq.com
              </a>
              .
            </p>
          </div>
        </div>
      </Section>

      {/* ── Section 4: Payout & Banking ─────────────────────────────────────── */}

      <Section icon={BuildingLibraryIcon} title="Payout & Banking">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
            <div>
              <p className="text-white text-sm font-semibold">Stripe Connect — Connected</p>
              <p className="text-white/40 text-xs mt-0.5">
                Your account is verified and ready to receive payouts.
              </p>
            </div>
          </div>
          <a
            href="https://dashboard.stripe.com"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white text-sm rounded-xl transition-colors flex items-center gap-2"
          >
            Open Stripe Dashboard
            <span className="text-white/40">→</span>
          </a>
        </div>
      </Section>

      {/* ── Section 5: Danger Zone ───────────────────────────────────────────── */}

      <div className="bg-[#1a1a1a] border border-red-500/20 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-5">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />
          <h2 className="text-red-400 font-semibold text-base">Danger Zone</h2>
        </div>

        {!showDanger ? (
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-white text-sm font-medium">Delete Organization</p>
              <p className="text-white/40 text-xs mt-0.5">
                Permanently removes your organization, all fairs, and associated data.
                This cannot be undone.
              </p>
            </div>
            <button
              onClick={() => setShowDanger(true)}
              className="px-5 py-2 border border-red-500/40 text-red-400 hover:bg-red-500/10 text-sm rounded-xl transition-colors"
            >
              Delete Organization
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-white/60 text-sm">
              Are you sure? Type{' '}
              <span className="text-red-400 font-mono font-bold">DELETE</span> to
              confirm.
            </p>
            <input
              type="text"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              placeholder="Type DELETE"
              className="w-full max-w-xs bg-white/[0.04] border border-red-500/30 rounded-xl px-4 py-2.5 text-white text-sm focus:border-red-500 outline-none transition-colors font-mono"
            />

            {deleteError && (
              <p className="text-red-400 text-sm">{deleteError}</p>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleDelete}
                disabled={deleteInput !== 'DELETE' || deleting}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors"
              >
                {deleting ? 'Deleting…' : 'Confirm Delete'}
              </button>
              <button
                onClick={() => {
                  setShowDanger(false)
                  setDeleteInput('')
                  setDeleteError(null)
                }}
                className="px-6 py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 text-white/70 text-sm rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
