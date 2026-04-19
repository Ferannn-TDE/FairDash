'use client'

import { useState } from 'react'
import { CheckCircleIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import { mockAdminEvents } from '@/lib/mock/admin'

const INPUT = 'w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-inter outline-none focus:border-[#FF0077] transition-colors placeholder:text-[#444]'

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-[0.6875rem] uppercase tracking-wide text-[#666] font-semibold mb-1.5 font-inter">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-[#555] font-inter">{hint}</p>}
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#111111] border border-white/5 rounded-xl p-5 sm:p-6">
      <h2 className="font-bebas text-xl text-white tracking-wide mb-5">{title}</h2>
      {children}
    </div>
  )
}

export default function AdminSettingsPage({ params }: { params: { eventSlug: string } }) {
  const event = mockAdminEvents.find(e => e.slug === params.eventSlug) ?? mockAdminEvents[0]
  const [name, setName] = useState(event.name)
  const [startDate, setStartDate] = useState(event.startDate)
  const [endDate, setEndDate] = useState(event.endDate)
  const [eventLat, setEventLat] = useState(String(event.eventLat ?? ''))
  const [eventLng, setEventLng] = useState(String(event.eventLng ?? ''))
  const [serviceChargeEnabled, setServiceChargeEnabled] = useState(false)
  const [serviceChargeAmount, setServiceChargeAmount] = useState('1.50')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [qrCopied, setQrCopied] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    // TODO: replace with real PATCH /api/admin/events/[id]
    await new Promise(r => setTimeout(r, 600))
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const copyQrUrl = () => {
    const url = `https://fairsynq.com/e/${event.slug}`
    navigator.clipboard.writeText(url).catch(() => {})
    setQrCopied(true)
    setTimeout(() => setQrCopied(false), 2000)
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">Event Settings</h1>
          <p className="text-sm text-[#666] font-inter mt-1">{event.slug}</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors
            ${saved
              ? 'bg-green-600/20 border border-green-600/30 text-green-400'
              : 'bg-[#FF0077] text-white hover:bg-[#e0006b]'
            }`}
        >
          {saved ? <><CheckCircleIcon className="w-4 h-4" /> Saved</> : saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      <div className="space-y-5">

        {/* Basic Info */}
        <SectionCard title="Event Details">
          <div className="space-y-4">
            <Field label="Event Name">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className={INPUT}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start Date">
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={INPUT} />
              </Field>
              <Field label="End Date">
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={INPUT} />
              </Field>
            </div>
          </div>
        </SectionCard>

        {/* Location */}
        <SectionCard title="Event Location">
          <div className="space-y-4">
            <p className="text-sm text-[#666] font-inter">
              Used for the customer-facing map pin and the Go Live checklist.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude">
                <input
                  type="number"
                  step="any"
                  value={eventLat}
                  onChange={e => setEventLat(e.target.value)}
                  placeholder="39.7817"
                  className={INPUT}
                />
              </Field>
              <Field label="Longitude">
                <input
                  type="number"
                  step="any"
                  value={eventLng}
                  onChange={e => setEventLng(e.target.value)}
                  placeholder="-89.6501"
                  className={INPUT}
                />
              </Field>
            </div>
          </div>
        </SectionCard>

        {/* Service Charge */}
        <SectionCard title="Service Charge">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white font-inter">Enable per-order service charge</p>
                <p className="text-xs text-[#666] font-inter mt-0.5">Applied to every order. Goes 100% to your payout.</p>
              </div>
              <button
                type="button"
                onClick={() => setServiceChargeEnabled(e => !e)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                  ${serviceChargeEnabled ? 'bg-[#FF0077]' : 'bg-white/10'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
                  ${serviceChargeEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            {serviceChargeEnabled && (
              <Field label="Charge Amount ($)" hint="Flat dollar amount applied to each order subtotal">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="10"
                  value={serviceChargeAmount}
                  onChange={e => setServiceChargeAmount(e.target.value)}
                  placeholder="1.50"
                  className={`${INPUT} max-w-xs`}
                />
              </Field>
            )}
          </div>
        </SectionCard>

        {/* QR Code */}
        <SectionCard title="QR Code & Sharing">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-white font-inter mb-1">Customer ordering URL</p>
              <p className="text-xs text-[#666] font-inter font-mono">fairsynq.com/e/{event.slug}</p>
            </div>
            <button
              onClick={copyQrUrl}
              className="flex items-center gap-2 px-4 py-2.5 bg-white/5 border border-white/10 text-white text-sm font-semibold rounded-xl hover:bg-white/10 transition-colors shrink-0"
            >
              {qrCopied ? <><CheckCircleIcon className="w-4 h-4 text-green-400" /> Copied!</> : <><ClipboardDocumentIcon className="w-4 h-4" /> Copy URL</>}
            </button>
          </div>
        </SectionCard>

      </div>
    </div>
  )
}
