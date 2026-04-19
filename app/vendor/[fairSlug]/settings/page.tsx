'use client'

import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import {
  BuildingStorefrontIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'

interface VendorProfile {
  id: string
  name: string
  cuisineType: string
  description?: string
  boothNumber?: string
  logoUrl?: string
  stripeAccountId?: string
  stripeOnboarded?: boolean
}

export default function VendorSettingsPage() {
  const [vendor, setVendor] = useState<VendorProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    cuisineType: '',
    description: '',
  })

  useEffect(() => {
    fetch('/api/vendors/me')
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) { setLoading(false); return }
        const v = json.data.vendor as VendorProfile
        setVendor(v)
        setForm({ name: v.name, cuisineType: v.cuisineType, description: v.description ?? '' })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!vendor) return
    setSaving(true)
    try {
      const res = await fetch(`/api/vendors/${vendor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          cuisineType: form.cuisineType,
          description: form.description || null,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message || 'Update failed')
      setVendor((prev) => prev ? { ...prev, ...form } : prev)
      toast.success('Profile updated')
    } catch (err: any) {
      toast.error(err.message || 'Could not save changes')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40'
  const labelCls = 'block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5'

  if (loading) {
    return (
      <div className="p-6 max-w-[52rem] mx-auto animate-pulse">
        <div className="h-9 w-40 bg-white/10 rounded-lg mb-8" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i}>
              <div className="h-3 w-24 bg-white/5 rounded-full mb-2" />
              <div className="h-12 bg-bg-card border border-white/5 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!vendor) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <ExclamationTriangleIcon className="w-10 h-10 text-amber-400/60 mx-auto mb-3" />
          <p className="text-white font-semibold text-sm">No vendor found</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-4 sm:p-3 max-w-[52rem] mx-auto">
      <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight mb-8">
        Vendor <span className="text-neon-pink">Settings</span>
      </h1>

      <div className="space-y-6">
        {/* Business Profile */}
        <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 flex items-center gap-3">
            <BuildingStorefrontIcon className="w-5 h-5 text-neon-pink" />
            <h2 className="font-bebas text-lg tracking-wide text-white">Business Profile</h2>
          </div>

          <form onSubmit={handleSave} className="p-6 space-y-4">
            <div>
              <label className={labelCls}>Business Name *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Cuisine Type *</label>
              <input
                required
                value={form.cuisineType}
                onChange={(e) => setForm((p) => ({ ...p, cuisineType: e.target.value }))}
                placeholder="e.g., BBQ, Mexican, Desserts"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Tell customers about your food…"
                className={`${inputCls} resize-none`}
              />
            </div>

            {/* Read-only fields */}
            {vendor.boothNumber && (
              <div>
                <label className={labelCls}>Booth Number</label>
                <div className={`${inputCls} bg-white/[0.02] cursor-not-allowed text-text-gray`}>
                  {vendor.boothNumber}
                </div>
                <p className="text-text-gray text-xs mt-1">Assigned by the event organizer — contact them to change.</p>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 bg-neon-pink text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] transition-colors cursor-pointer border-0 shadow-[0_4px_12px_rgba(255,0,119,0.3)] disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>

        {/* Stripe Connect */}
        <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10">
            <h2 className="font-bebas text-lg tracking-wide text-white">Payments</h2>
          </div>
          <div className="p-6">
            {vendor.stripeOnboarded ? (
              <div className="flex items-center gap-3 p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                <CheckCircleIcon className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-white font-semibold text-sm">Stripe account connected</p>
                  <p className="text-text-gray text-xs">Your payouts are configured and active.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-white font-semibold text-sm mb-1">Connect your Stripe account</p>
                  <p className="text-text-gray text-xs">Required to receive payouts from FairSynq.</p>
                </div>
                <button
                  className="px-5 py-2.5 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors cursor-pointer"
                  onClick={() => toast('Stripe Connect onboarding coming soon', { icon: '💳' })}
                >
                  Connect Stripe
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Danger Zone */}
        <div className="bg-bg-card border border-red-500/20 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-red-500/10">
            <h2 className="font-bebas text-lg tracking-wide text-red-400">Danger Zone</h2>
          </div>
          <div className="p-6 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-white font-semibold text-sm mb-0.5">Deactivate vendor profile</p>
              <p className="text-text-gray text-xs">You will be removed from all active fairs. This cannot be undone.</p>
            </div>
            <button
              className="px-5 py-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm font-semibold hover:bg-red-500/20 transition-colors cursor-pointer"
              onClick={() => toast.error('Please contact support to deactivate your account.')}
            >
              Deactivate
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
