'use client'

import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/clerk-react'
import Link from 'next/link'
import {
  PencilIcon,
  CheckIcon,
  XMarkIcon,
  UserCircleIcon,
  EnvelopeIcon,
  PhoneIcon,
  MapPinIcon,
  BellIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import MarketplaceNavbar from '../../_components/MarketplaceNavbar'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileData {
  defaultDeliveryAddress: string | null
  notifOrderUpdates: boolean
  notifSmsAlerts: boolean
  notifPromotionalEmails: boolean
  notifNewVendors: boolean
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AccountSettingsPage() {
  const { user, isLoaded } = useUser()

  // Form state for editable profile fields
  const [form, setForm] = useState({ firstName: '', lastName: '', address: '' })
  const [saved, setSaved] = useState({ firstName: '', lastName: '', address: '' })
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Notification preference state
  const [prefs, setPrefs] = useState<ProfileData>({
    defaultDeliveryAddress: null,
    notifOrderUpdates: true,
    notifSmsAlerts: true,
    notifPromotionalEmails: false,
    notifNewVendors: false,
  })
  const [profileLoaded, setProfileLoaded] = useState(false)

  // ── Load Supabase profile ─────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/user/profile')
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          const d: ProfileData = json.data
          setPrefs(d)
          const addr = d.defaultDeliveryAddress ?? ''
          setForm(f => ({ ...f, address: addr }))
          setSaved(f => ({ ...f, address: addr }))
        }
      })
      .catch(() => {})
      .finally(() => setProfileLoaded(true))
  }, [])

  // ── Sync Clerk data into form once loaded ─────────────────────────────────

  useEffect(() => {
    if (!isLoaded || !user) return
    const firstName = user.firstName ?? ''
    const lastName  = user.lastName  ?? ''
    setForm(f => ({ ...f, firstName, lastName }))
    setSaved(f => ({ ...f, firstName, lastName }))
  }, [isLoaded, user])

  // ── Save profile ──────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    try {
      await Promise.all([
        // Update name in Clerk
        user.update({ firstName: form.firstName, lastName: form.lastName }),
        // Update address in Supabase
        fetch('/api/user/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultDeliveryAddress: form.address || null }),
        }).then(r => r.json()).then(j => {
          if (!j.success) throw new Error('Profile save failed')
        }),
      ])
      setSaved({ ...form })
      setPrefs(p => ({ ...p, defaultDeliveryAddress: form.address || null }))
      setIsEditing(false)
      toast.success('Profile updated')
    } catch {
      toast.error('Failed to save — please try again')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setForm({ ...saved })
    setIsEditing(false)
  }

  // ── Toggle notification preferences ──────────────────────────────────────

  const handleToggle = useCallback((key: keyof Omit<ProfileData, 'defaultDeliveryAddress'>) => {
    const next = !prefs[key]
    setPrefs(p => ({ ...p, [key]: next }))
    fetch('/api/user/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: next }),
    })
      .then(r => r.json())
      .then(j => { if (!j.success) throw new Error() })
      .catch(() => {
        // Revert on failure
        setPrefs(p => ({ ...p, [key]: !next }))
        toast.error('Could not save preference')
      })
  }, [prefs])

  // ── Derived display values ────────────────────────────────────────────────

  const email = user?.emailAddresses?.[0]?.emailAddress ?? ''
  const phone = user?.phoneNumbers?.[0]?.phoneNumber ?? ''
  const initials = (user?.firstName?.[0] ?? email?.[0] ?? 'U').toUpperCase()
  const displayName = user?.firstName
    ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
    : email || 'User'
  const isVerified = user?.emailAddresses?.[0]?.verification?.status === 'verified'
    || (user?.phoneNumbers?.length ?? 0) > 0

  const inputCls    = 'w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/50'
  const readonlyCls = 'flex items-center gap-2.5 px-4 py-3 bg-white/[0.03] border border-white/5 rounded-xl text-sm text-white'
  const labelCls    = 'block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5'

  const loading = !isLoaded || !profileLoaded

  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">
        <div className="max-w-[760px] mx-auto px-[6%] md:px-5 py-10">

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm mb-6">
            <Link href="/account" className="text-text-gray hover:text-white transition-colors">
              Account
            </Link>
            <span className="text-text-gray/40">›</span>
            <span className="text-white">Settings</span>
          </div>

          {/* Page Header */}
          <div className="mb-8">
            <h1 className="font-bebas text-[clamp(2rem,5vw,3rem)] tracking-wide mb-1">
              My <span className="text-neon-pink">Account</span>
            </h1>
            <p className="text-text-gray text-sm">Manage your profile and preferences</p>
          </div>

          {/* Profile Card */}
          <div className="bg-bg-card border border-white/10 rounded-2xl p-6 mb-5">

            {/* ── View mode header ── */}
            {!isEditing && (
              <div className="flex items-start gap-4 mb-6">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-neon-pink to-[#cc0060] flex items-center justify-center shadow-[0_8px_24px_rgba(255,0,119,0.35)] flex-shrink-0">
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <span className="text-white font-bold text-2xl">{initials}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-white font-bold text-lg leading-tight truncate">{displayName}</h2>
                  <p className="text-text-gray text-sm truncate mt-0.5">{email || phone}</p>
                  {isVerified && (
                    <span className="inline-flex items-center gap-1.5 mt-2 text-[0.6875rem] font-semibold text-neon-pink bg-neon-pink/10 border border-neon-pink/20 px-2.5 py-1 rounded-full">
                      <ShieldCheckIcon className="w-3.5 h-3.5" />
                      Verified Account
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setIsEditing(true)}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 hover:border-white/20 transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  <PencilIcon className="w-4 h-4" />
                  Edit
                </button>
              </div>
            )}

            {/* ── Edit mode header (mobile-first: avatar centred, no name text) ── */}
            {isEditing && (
              <div className="flex flex-col items-center mb-6">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-neon-pink to-[#cc0060] flex items-center justify-center shadow-[0_8px_24px_rgba(255,0,119,0.35)] mb-3">
                  <span className="text-white font-bold text-3xl">{initials}</span>
                </div>
                <p className="text-text-gray text-xs">Editing profile</p>
              </div>
            )}

            {/* ── Fields ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* First Name */}
              <div>
                <label className={labelCls}>First Name</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={(e) => setForm(f => ({ ...f, firstName: e.target.value }))}
                    className={inputCls}
                    placeholder="First name"
                  />
                ) : (
                  <div className={readonlyCls}>
                    <UserCircleIcon className="w-4 h-4 text-text-gray flex-shrink-0" />
                    {saved.firstName || <span className="text-text-gray/50">Not set</span>}
                  </div>
                )}
              </div>

              {/* Last Name */}
              <div>
                <label className={labelCls}>Last Name</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={(e) => setForm(f => ({ ...f, lastName: e.target.value }))}
                    className={inputCls}
                    placeholder="Last name"
                  />
                ) : (
                  <div className={readonlyCls}>
                    <UserCircleIcon className="w-4 h-4 text-text-gray flex-shrink-0" />
                    {saved.lastName || <span className="text-text-gray/50">Not set</span>}
                  </div>
                )}
              </div>

              {/* Email — read-only */}
              <div>
                <label className={labelCls}>Email</label>
                <div className={readonlyCls.replace('text-white', 'text-text-gray')}>
                  <EnvelopeIcon className="w-4 h-4 text-text-gray flex-shrink-0" />
                  {email || <span className="text-text-gray/50">Not set</span>}
                </div>
              </div>

              {/* Phone — read-only (primary Clerk identifier) */}
              <div>
                <label className={labelCls}>Phone</label>
                <div className={readonlyCls.replace('text-white', 'text-text-gray')}>
                  <PhoneIcon className="w-4 h-4 text-text-gray flex-shrink-0" />
                  {phone || <span className="text-text-gray/50">Not set</span>}
                </div>
              </div>

              {/* Default Delivery Address — full width */}
              <div className="sm:col-span-2">
                <label className={labelCls}>Default Delivery Address</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
                    className={inputCls}
                    placeholder="123 Fair St, Springfield, IL"
                  />
                ) : (
                  <div className={readonlyCls}>
                    <MapPinIcon className="w-4 h-4 text-text-gray flex-shrink-0" />
                    {saved.address || <span className="text-text-gray/50">Not set</span>}
                  </div>
                )}
              </div>
            </div>

            {/* ── Edit mode action buttons (below fields, full-width on mobile) ── */}
            {isEditing && (
              <div className="flex flex-col gap-3 mt-6">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center justify-center gap-2 w-full py-3 bg-neon-pink text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] transition-all duration-200 border-0 shadow-[0_4px_12px_rgba(255,0,119,0.3)] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                  <CheckIcon className="w-4 h-4" />
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="flex items-center justify-center gap-2 w-full py-3 border border-white/20 text-white/70 rounded-xl text-sm font-semibold hover:bg-white/5 hover:text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <XMarkIcon className="w-4 h-4" />
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Notification Preferences */}
          <div className="bg-bg-card border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2.5 mb-5">
              <BellIcon className="w-5 h-5 text-neon-pink" />
              <h3 className="font-bebas text-xl tracking-wide text-white">Notification Preferences</h3>
            </div>

            <div className="space-y-4">
              {([
                { key: 'notifOrderUpdates',      label: 'Order Updates',      desc: 'Delivery and status notifications' },
                { key: 'notifSmsAlerts',          label: 'SMS Alerts',         desc: 'Text messages for time-sensitive updates' },
                { key: 'notifPromotionalEmails',  label: 'Promotional Emails', desc: 'Deals, new vendors, and fair specials' },
                { key: 'notifNewVendors',         label: 'New Vendors',        desc: 'Alerts when new vendors join FairSynq' },
              ] as const).map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                  <div>
                    <div className="text-white font-semibold text-sm">{label}</div>
                    <div className="text-text-gray text-xs mt-0.5">{desc}</div>
                  </div>
                  <button
                    onClick={() => handleToggle(key)}
                    disabled={!profileLoaded}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 border-0 cursor-pointer flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                      prefs[key] ? 'bg-neon-pink' : 'bg-white/10'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform duration-200 shadow-md ${
                        prefs[key] ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
