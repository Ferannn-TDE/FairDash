'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeftIcon } from '@heroicons/react/24/outline'

const STEPS = ['Basic Info', 'Dates & Location', 'Branding', 'Settings', 'Review']

interface FairDraft {
  name: string; slug: string; description: string
  startDate: string; endDate: string
  address: string; city: string; state: string; zip: string
  openTime: string; closeTime: string; timezone: string
  accentColor: string
  platformFee: number; maxVendors: number
  deliveryEnabled: boolean; pickupEnabled: boolean
  admissionFree: boolean
}

const INITIAL: FairDraft = {
  name: '', slug: '', description: '',
  startDate: '', endDate: '',
  address: '', city: '', state: '', zip: '',
  openTime: '10:00', closeTime: '22:00', timezone: 'America/Chicago',
  accentColor: '#FF0077',
  platformFee: 10, maxVendors: 50,
  deliveryEnabled: false, pickupEnabled: true,
  admissionFree: true,
}

function FormInput({ label, name, value, onChange, type = 'text', placeholder = '', required = false }: {
  label: string; name: string; value: string | number; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  type?: string; placeholder?: string; required?: boolean
}) {
  return (
    <div className="mb-5">
      <label className="block text-xs font-inter text-[#888] uppercase tracking-wider mb-1.5">
        {label} {required && <span className="text-[#FF0077]">*</span>}
      </label>
      <input
        type={type} name={name} value={value} onChange={onChange} placeholder={placeholder}
        className="w-full px-4 py-2.5 bg-[#0a0a0a] border border-white/10 rounded-lg
                   text-sm font-inter text-white placeholder:text-[#444]
                   focus:border-[#FF0077]/50 focus:ring-1 focus:ring-[#FF0077]/20 focus:outline-none transition-colors"
      />
    </div>
  )
}

function FormTextarea({ label, name, value, onChange, placeholder = '' }: {
  label: string; name: string; value: string; onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void; placeholder?: string
}) {
  return (
    <div className="mb-5">
      <label className="block text-xs font-inter text-[#888] uppercase tracking-wider mb-1.5">{label}</label>
      <textarea
        name={name} value={value} onChange={onChange} placeholder={placeholder} rows={3}
        className="w-full px-4 py-2.5 bg-[#0a0a0a] border border-white/10 rounded-lg
                   text-sm font-inter text-white placeholder:text-[#444] resize-none
                   focus:border-[#FF0077]/50 focus:ring-1 focus:ring-[#FF0077]/20 focus:outline-none transition-colors"
      />
    </div>
  )
}

function Step1({ data, onChange }: { data: FairDraft; onChange: (d: FairDraft) => void }) {
  const set = (k: keyof FairDraft, v: string) => {
    const next: FairDraft = { ...data, [k]: v }
    if (k === 'name') next.slug = v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-2026'
    onChange(next)
  }
  return (
    <div>
      <FormInput label="Fair Name" name="name" value={data.name} onChange={e => set('name', e.target.value)} required placeholder="e.g. Springfield State Fair" />
      <FormInput label="URL Slug" name="slug" value={data.slug} onChange={e => set('slug', e.target.value)} required placeholder="springfield-state-fair-2026" />
      <FormTextarea label="Description" name="description" value={data.description} onChange={e => onChange({ ...data, description: e.target.value })} placeholder="Describe your fair..." />
    </div>
  )
}

function Step2({ data, onChange }: { data: FairDraft; onChange: (d: FairDraft) => void }) {
  const set = (k: keyof FairDraft, v: string) => onChange({ ...data, [k]: v })
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormInput label="Start Date" name="startDate" value={data.startDate} onChange={e => set('startDate', e.target.value)} type="date" required />
        <FormInput label="End Date" name="endDate" value={data.endDate} onChange={e => set('endDate', e.target.value)} type="date" required />
      </div>
      <FormInput label="Address" name="address" value={data.address} onChange={e => set('address', e.target.value)} placeholder="123 Main St" required />
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2"><FormInput label="City" name="city" value={data.city} onChange={e => set('city', e.target.value)} placeholder="Springfield" required /></div>
        <FormInput label="State" name="state" value={data.state} onChange={e => set('state', e.target.value)} placeholder="IL" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormInput label="Open Time" name="openTime" value={data.openTime} onChange={e => set('openTime', e.target.value)} type="time" />
        <FormInput label="Close Time" name="closeTime" value={data.closeTime} onChange={e => set('closeTime', e.target.value)} type="time" />
      </div>
    </div>
  )
}

function Step3({ data, onChange }: { data: FairDraft; onChange: (d: FairDraft) => void }) {
  return (
    <div>
      <div className="mb-5">
        <label className="block text-xs font-inter text-[#888] uppercase tracking-wider mb-1.5">Accent Color</label>
        <div className="flex items-center gap-3">
          <input type="color" value={data.accentColor} onChange={e => onChange({ ...data, accentColor: e.target.value })}
            className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border border-white/10" />
          <span className="text-sm font-inter text-white">{data.accentColor}</span>
          <div className="w-8 h-8 rounded-lg" style={{ background: data.accentColor }} />
        </div>
      </div>
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
        <p className="text-xs text-[#666] font-inter mb-2">Preview — Fair card accent</p>
        <div className="h-16 rounded-xl flex items-end p-3"
          style={{ background: `linear-gradient(135deg, ${data.accentColor}, ${data.accentColor}99)` }}>
          <span className="text-white font-bebas text-lg">{data.name || 'Your Fair Name'}</span>
        </div>
      </div>
    </div>
  )
}

function Step4({ data, onChange }: { data: FairDraft; onChange: (d: FairDraft) => void }) {
  const toggle = (k: keyof FairDraft) => onChange({ ...data, [k]: !data[k as keyof FairDraft] })
  return (
    <div>
      <FormInput label="Platform Fee %" name="platformFee" value={data.platformFee} type="number"
        onChange={e => onChange({ ...data, platformFee: Number(e.target.value) })} />
      <FormInput label="Max Vendors" name="maxVendors" value={data.maxVendors} type="number"
        onChange={e => onChange({ ...data, maxVendors: Number(e.target.value) })} />
      <div className="space-y-3">
        {[
          { key: 'admissionFree' as const, label: 'Free Admission' },
          { key: 'pickupEnabled' as const, label: 'Booth Pickup' },
          { key: 'deliveryEnabled' as const, label: 'In-fair Delivery' },
        ].map(({ key, label }) => (
          <label key={key} className="flex items-center gap-3 cursor-pointer">
            <div onClick={() => toggle(key)}
              className={`w-10 h-6 rounded-full transition-colors ${data[key] ? 'bg-[#FF0077]' : 'bg-white/10'} relative`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${data[key] ? 'translate-x-5' : 'translate-x-1'}`} />
            </div>
            <span className="text-sm font-inter text-white">{label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function Step5({ data }: { data: FairDraft }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[#888] font-inter">Review your fair details before publishing.</p>
      {[
        { label: 'Name', value: data.name || '—' },
        { label: 'Slug', value: data.slug || '—' },
        { label: 'Dates', value: data.startDate && data.endDate ? `${data.startDate} – ${data.endDate}` : '—' },
        { label: 'Location', value: data.city ? `${data.city}, ${data.state}` : '—' },
        { label: 'Hours', value: `${data.openTime} – ${data.closeTime}` },
        { label: 'Platform Fee', value: `${data.platformFee}%` },
        { label: 'Max Vendors', value: String(data.maxVendors) },
      ].map(({ label, value }) => (
        <div key={label} className="flex items-center justify-between border-b border-white/5 pb-3">
          <span className="text-xs text-[#666] font-inter uppercase tracking-wider">{label}</span>
          <span className="text-sm text-white font-inter">{value}</span>
        </div>
      ))}
    </div>
  )
}

export default function CreateFairPage() {
  const [step, setStep] = useState(0)
  const [data, setData] = useState<FairDraft>(INITIAL)

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <Link href="/organizer/fairs" className="text-[#888] hover:text-white transition-colors">
          <ChevronLeftIcon className="w-5 h-5" />
        </Link>
        <h1 className="font-bebas text-3xl text-white tracking-wide">Create New Fair</h1>
      </div>

      <div className="max-w-2xl mx-auto">
        {/* Step indicator */}
        <div className="flex items-center mb-8 overflow-x-auto pb-1">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center shrink-0">
              <button
                onClick={() => i <= step && setStep(i)}
                className={`flex items-center gap-2 ${i <= step ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors
                  ${i < step ? 'bg-[#FF0077] text-white' : i === step ? 'bg-[#FF0077] text-white ring-2 ring-[#FF0077]/30' : 'bg-white/5 text-[#666]'}`}>
                  {i < step ? '✓' : i + 1}
                </div>
                <span className={`text-xs font-inter hidden sm:inline ${i <= step ? 'text-white' : 'text-[#666]'}`}>{s}</span>
              </button>
              {i < STEPS.length - 1 && <div className={`mx-2 sm:mx-3 w-6 sm:w-10 h-px ${i < step ? 'bg-[#FF0077]' : 'bg-white/10'}`} />}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="bg-[#111111] rounded-xl border border-white/5 p-6 sm:p-8">
          <h2 className="font-bebas text-xl text-white tracking-wide mb-6">{STEPS[step]}</h2>
          {step === 0 && <Step1 data={data} onChange={setData} />}
          {step === 1 && <Step2 data={data} onChange={setData} />}
          {step === 2 && <Step3 data={data} onChange={setData} />}
          {step === 3 && <Step4 data={data} onChange={setData} />}
          {step === 4 && <Step5 data={data} />}
        </div>

        {/* Navigation */}
        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={step === 0}
            className="px-4 py-2 text-sm font-inter text-[#888] hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Back
          </button>
          <div className="flex items-center gap-3">
            <button className="px-4 py-2 text-sm font-inter text-[#888] border border-white/10 rounded-lg hover:text-white hover:border-white/20 transition-colors">
              Save Draft
            </button>
            {step < STEPS.length - 1 ? (
              <button onClick={() => setStep(s => s + 1)}
                className="px-6 py-2 bg-[#FF0077] text-white text-sm font-semibold rounded-lg hover:bg-[#e0006b] transition-colors">
                Next →
              </button>
            ) : (
              <button className="px-6 py-2 bg-[#FF0077] text-white text-sm font-semibold rounded-lg hover:bg-[#e0006b] transition-colors">
                Publish Fair
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
