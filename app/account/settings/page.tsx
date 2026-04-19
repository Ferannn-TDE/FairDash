'use client'

import { useState } from 'react'
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

export default function AccountSettingsPage() {
  const { user } = useUser()
  const [isEditing, setIsEditing] = useState(false)

  const [form, setForm] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    phone: '',
    address: '',
  })
  const [saved, setSaved] = useState({ ...form })

  const [prefs, setPrefs] = useState({
    orderUpdates: true,
    promoEmails: false,
    smsAlerts: true,
    newVendors: false,
  })

  const email = user?.emailAddresses?.[0]?.emailAddress ?? ''
  const initials = (user?.firstName?.[0] ?? email?.[0] ?? 'U').toUpperCase()
  const displayName = user?.firstName
    ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
    : 'User'

  const handleSave = () => {
    setSaved({ ...form })
    setIsEditing(false)
    toast.success('Profile updated successfully!')
  }

  const handleCancel = () => {
    setForm({ ...saved })
    setIsEditing(false)
  }

  const inputCls = 'w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/50'
  const readonlyCls = 'flex items-center gap-2.5 px-4 py-3 bg-white/[0.03] border border-white/5 rounded-xl text-sm text-white'
  const labelCls = 'block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5'

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
            {/* Avatar + Name row */}
            <div className="flex items-center gap-5 mb-6">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-neon-pink to-[#cc0060] flex items-center justify-center shadow-[0_8px_24px_rgba(255,0,119,0.35)] flex-shrink-0">
                <span className="text-white font-bold text-3xl">{initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-white font-bold text-xl truncate">{displayName}</h2>
                <p className="text-text-gray text-sm truncate">{email}</p>
                <span className="inline-flex items-center gap-1.5 mt-2 text-[0.6875rem] font-semibold text-neon-pink bg-neon-pink/10 border border-neon-pink/20 px-2.5 py-1 rounded-full">
                  <ShieldCheckIcon className="w-3.5 h-3.5" />
                  Verified Account
                </span>
              </div>
              {!isEditing ? (
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 hover:border-white/20 transition-all duration-200 cursor-pointer"
                >
                  <PencilIcon className="w-4 h-4" />
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    className="flex items-center gap-1.5 px-4 py-2 bg-neon-pink text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] transition-all duration-200 cursor-pointer border-0 shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
                  >
                    <CheckIcon className="w-4 h-4" />
                    Save
                  </button>
                  <button
                    onClick={handleCancel}
                    className="flex items-center gap-1.5 px-4 py-2 bg-white/5 border border-white/10 text-text-gray rounded-xl text-sm font-semibold hover:bg-white/10 hover:border-white/20 transition-all duration-200 cursor-pointer"
                  >
                    <XMarkIcon className="w-4 h-4" />
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* First Name */}
              <div>
                <label className={labelCls}>First Name</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
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
                    onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
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

              {/* Email — read-only (managed by Clerk) */}
              <div>
                <label className={labelCls}>Email</label>
                <div className={readonlyCls.replace('text-white', 'text-text-gray')}>
                  <EnvelopeIcon className="w-4 h-4 text-text-gray flex-shrink-0" />
                  {email || <span className="text-text-gray/50">Not set</span>}
                </div>
              </div>

              {/* Phone */}
              <div>
                <label className={labelCls}>Phone</label>
                {isEditing ? (
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className={inputCls}
                    placeholder="(555) 000-0000"
                  />
                ) : (
                  <div className={readonlyCls}>
                    <PhoneIcon className="w-4 h-4 text-text-gray flex-shrink-0" />
                    {saved.phone || <span className="text-text-gray/50">Not set</span>}
                  </div>
                )}
              </div>

              {/* Address — full width */}
              <div className="sm:col-span-2">
                <label className={labelCls}>Default Delivery Address</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
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
          </div>

          {/* Notification Preferences */}
          <div className="bg-bg-card border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2.5 mb-5">
              <BellIcon className="w-5 h-5 text-neon-pink" />
              <h3 className="font-bebas text-xl tracking-wide text-white">Notification Preferences</h3>
            </div>

            <div className="space-y-4">
              {[
                { key: 'orderUpdates', label: 'Order Updates',      desc: 'Delivery and status notifications' },
                { key: 'smsAlerts',    label: 'SMS Alerts',         desc: 'Text messages for time-sensitive updates' },
                { key: 'promoEmails',  label: 'Promotional Emails', desc: 'Deals, new vendors, and fair specials' },
                { key: 'newVendors',   label: 'New Vendors',        desc: 'Alerts when new vendors join FairSynq' },
              ].map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                  <div>
                    <div className="text-white font-semibold text-sm">{label}</div>
                    <div className="text-text-gray text-xs mt-0.5">{desc}</div>
                  </div>
                  <button
                    onClick={() => setPrefs((p) => ({ ...p, [key]: !p[key as keyof typeof p] }))}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 border-0 cursor-pointer flex-shrink-0 ${
                      prefs[key as keyof typeof prefs] ? 'bg-neon-pink' : 'bg-white/10'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform duration-200 shadow-md ${
                        prefs[key as keyof typeof prefs] ? 'translate-x-5' : 'translate-x-0'
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
