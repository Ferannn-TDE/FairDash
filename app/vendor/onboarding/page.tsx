'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Check, Upload, Plus, Trash2, CreditCard, GripVertical,
  FileText, AlertCircle, ChevronRight,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MenuItem {
  id: string
  name: string
  price: string
  prepTime: string
  description: string
}

interface MenuCategory {
  id: string
  name: string
  items: MenuItem[]
}

interface DocumentFile {
  name: string
  size: string
}

// ─── Shared input classes ──────────────────────────────────────────────────────

const INPUT = 'w-full h-11 px-4 bg-white/[0.03] border border-white/[0.08] text-white text-sm rounded-xl placeholder:text-gray-600 focus:border-[#FF0077]/40 focus:ring-1 focus:ring-[#FF0077]/20 transition-all duration-200 outline-none'
const LABEL = 'block text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1.5'

// ─── Step 1: Business Profile ──────────────────────────────────────────────────

const CUISINE_TYPES = ['BBQ', 'Mexican', 'Asian', 'Desserts', 'Drinks', 'American', 'Seafood', 'Other']

function StepBusinessProfile({
  data,
  onChange,
}: {
  data: Record<string, string>
  onChange: (key: string, val: string) => void
}) {
  return (
    <div>
      <h2 className="font-bebas text-2xl text-white tracking-wide mb-1">Business Profile</h2>
      <p className="text-sm text-gray-500 mb-6">Tell us about your food business.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={LABEL}>Business Name *</label>
          <input className={INPUT} placeholder="Smoky Joe's BBQ" value={data.businessName ?? ''} onChange={e => onChange('businessName', e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Contact Name *</label>
          <input className={INPUT} placeholder="Joe Martinez" value={data.contactName ?? ''} onChange={e => onChange('contactName', e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Email *</label>
          <input className={INPUT} type="email" placeholder="joe@smokyjoes.com" value={data.email ?? ''} onChange={e => onChange('email', e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Phone *</label>
          <input className={INPUT} type="tel" placeholder="+1 (312) 555-0100" value={data.phone ?? ''} onChange={e => onChange('phone', e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Cuisine Type *</label>
          <select
            className={`${INPUT} appearance-none cursor-pointer`}
            value={data.cuisineType ?? ''}
            onChange={e => onChange('cuisineType', e.target.value)}
          >
            <option value="" disabled>Select cuisine…</option>
            {CUISINE_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL}>Bio / Description <span className="text-gray-600 normal-case">(max 200 chars)</span></label>
          <textarea
            className={`${INPUT} h-24 pt-3 resize-none`}
            maxLength={200}
            placeholder="Slow-smoked meats and classic sides. A fair favorite since 1998."
            value={data.bio ?? ''}
            onChange={e => onChange('bio', e.target.value)}
          />
          <p className="text-right text-[10px] text-gray-600 mt-1">{(data.bio ?? '').length}/200</p>
        </div>
      </div>
    </div>
  )
}

// ─── Step 2: Documents ─────────────────────────────────────────────────────────

const DOCUMENTS = [
  { key: 'foodPermit',   label: "Food Handler's Permit",         required: true  },
  { key: 'bizLicense',   label: 'Business License',              required: true  },
  { key: 'insurance',    label: 'Proof of Insurance',            required: true  },
  { key: 'healthInspect', label: 'Health Dept. Inspection',      required: false },
]

function DocCard({
  label,
  required,
  file,
  onUpload,
  onReplace,
}: {
  label: string
  required: boolean
  file: DocumentFile | null
  onUpload: (f: DocumentFile) => void
  onReplace: () => void
}) {
  const handleClick = () => {
    // Mock upload — simulate picking a file
    onUpload({ name: `${label.toLowerCase().replace(/[^a-z]/g, '_')}.pdf`, size: `${(Math.random() * 4 + 0.5).toFixed(1)} MB` })
  }

  if (file) {
    return (
      <div className="border border-white/[0.08] rounded-xl p-4 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
            <Check className="w-4 h-4 text-green-400" />
          </div>
          <div>
            <p className="text-sm text-white">{file.name}</p>
            <p className="text-xs text-gray-500">{file.size}</p>
          </div>
        </div>
        <button onClick={onReplace} className="text-xs text-gray-500 hover:text-white transition-colors">
          Replace
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={handleClick}
      className="w-full border-2 border-dashed border-white/[0.08] rounded-xl p-6 text-center hover:border-[#FF0077]/20 transition-colors group"
    >
      <Upload className="w-7 h-7 text-gray-600 mx-auto mb-2 group-hover:text-[#FF0077]/60 transition-colors" />
      <p className="text-sm text-gray-400">
        {label} {required && <span className="text-[#FF0077]">*</span>}
      </p>
      <p className="text-xs text-gray-600 mt-1">PDF, JPG, or PNG · Max 10MB</p>
    </button>
  )
}

function StepDocuments({
  files,
  onFile,
}: {
  files: Record<string, DocumentFile | null>
  onFile: (key: string, f: DocumentFile | null) => void
}) {
  return (
    <div>
      <h2 className="font-bebas text-2xl text-white tracking-wide mb-1">Business Documents</h2>
      <p className="text-sm text-gray-500 mb-6">Upload your required permits and licenses. All documents are encrypted and stored securely.</p>

      <div className="space-y-3">
        {DOCUMENTS.map(({ key, label, required }) => (
          <DocCard
            key={key}
            label={label}
            required={required}
            file={files[key] ?? null}
            onUpload={f => onFile(key, f)}
            onReplace={() => onFile(key, null)}
          />
        ))}
      </div>

      <div className="mt-4 flex items-start gap-2 p-3 bg-blue-500/5 border border-blue-500/10 rounded-xl">
        <AlertCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-400">Documents will be reviewed by our team within 24 hours. You'll be notified by email once verified.</p>
      </div>
    </div>
  )
}

// ─── Step 3: Menu Setup ────────────────────────────────────────────────────────

let _itemCounter = 0
const newItem = (): MenuItem => ({
  id: `item_${++_itemCounter}`,
  name: '', price: '', prepTime: '', description: '',
})
const newCategory = (): MenuCategory => ({
  id: `cat_${Date.now()}`,
  name: 'New Category',
  items: [newItem()],
})

function StepMenuSetup({
  categories,
  setCategories,
}: {
  categories: MenuCategory[]
  setCategories: React.Dispatch<React.SetStateAction<MenuCategory[]>>
}) {
  const updateCat = (catId: string, name: string) =>
    setCategories(cs => cs.map(c => c.id === catId ? { ...c, name } : c))

  const removeCat = (catId: string) =>
    setCategories(cs => cs.filter(c => c.id !== catId))

  const addItem = (catId: string) =>
    setCategories(cs => cs.map(c => c.id === catId ? { ...c, items: [...c.items, newItem()] } : c))

  const removeItem = (catId: string, itemId: string) =>
    setCategories(cs => cs.map(c =>
      c.id === catId ? { ...c, items: c.items.filter(i => i.id !== itemId) } : c
    ))

  const updateItem = (catId: string, itemId: string, field: keyof MenuItem, value: string) =>
    setCategories(cs => cs.map(c =>
      c.id === catId
        ? { ...c, items: c.items.map(i => i.id === itemId ? { ...i, [field]: value } : i) }
        : c
    ))

  return (
    <div>
      <h2 className="font-bebas text-2xl text-white tracking-wide mb-1">Menu Setup</h2>
      <p className="text-sm text-gray-500 mb-6">
        Build your initial menu. <span className="text-[#FF0077]">Prep time is critical</span> — it determines customers' estimated wait window.
      </p>

      <div className="space-y-8">
        {categories.map(cat => (
          <div key={cat.id}>
            {/* Category header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <GripVertical className="w-4 h-4 text-gray-600 shrink-0" />
                <input
                  value={cat.name}
                  onChange={e => updateCat(cat.id, e.target.value)}
                  className="bg-transparent font-bebas text-sm text-white uppercase tracking-widest border-b border-transparent focus:border-[#FF0077]/40 outline-none px-1 py-0.5 min-w-0 flex-1"
                />
              </div>
              {categories.length > 1 && (
                <button onClick={() => removeCat(cat.id)} className="text-xs text-gray-600 hover:text-red-400 transition-colors ml-3">
                  Remove
                </button>
              )}
            </div>

            {/* Items */}
            <div className="space-y-2 pl-6">
              {cat.items.map(item => (
                <div key={item.id} className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-3 sm:p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 sm:gap-3">
                    <input
                      placeholder="Item name *"
                      value={item.name}
                      onChange={e => updateItem(cat.id, item.id, 'name', e.target.value)}
                      className="sm:col-span-2 h-9 px-3 bg-white/[0.03] border border-white/[0.06] text-sm text-white rounded-lg outline-none focus:border-[#FF0077]/40 transition-colors placeholder:text-gray-700"
                    />
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-sm">$</span>
                      <input
                        placeholder="0.00"
                        value={item.price}
                        type="number"
                        step="0.01"
                        min="0"
                        onChange={e => updateItem(cat.id, item.id, 'price', e.target.value)}
                        className="w-full h-9 pl-6 pr-3 bg-white/[0.03] border border-white/[0.06] text-sm text-white rounded-lg outline-none focus:border-[#FF0077]/40 transition-colors placeholder:text-gray-700"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        placeholder="15"
                        value={item.prepTime}
                        type="number"
                        min="1"
                        onChange={e => updateItem(cat.id, item.id, 'prepTime', e.target.value)}
                        className="flex-1 h-9 px-3 bg-white/[0.03] border border-white/[0.06] text-sm text-white rounded-lg outline-none focus:border-[#FF0077]/40 transition-colors placeholder:text-gray-700"
                      />
                      <span className="text-xs text-gray-600 shrink-0">min</span>
                      <button
                        onClick={() => removeItem(cat.id, item.id)}
                        className="text-gray-600 hover:text-red-400 transition-colors p-1 shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <input
                    placeholder="Description (optional)"
                    value={item.description}
                    onChange={e => updateItem(cat.id, item.id, 'description', e.target.value)}
                    className="mt-2 w-full h-9 px-3 bg-white/[0.03] border border-white/[0.06] text-sm text-white rounded-lg outline-none focus:border-[#FF0077]/40 transition-colors placeholder:text-gray-700"
                  />
                </div>
              ))}

              <button
                onClick={() => addItem(cat.id)}
                className="flex items-center gap-1.5 text-xs text-[#FF0077] hover:text-white transition-colors py-2 font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> Add Item
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={() => setCategories(cs => [...cs, newCategory()])}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-white transition-colors py-2 border-t border-white/[0.04] w-full pt-4"
        >
          <Plus className="w-4 h-4" /> Add Category
        </button>
      </div>
    </div>
  )
}

// ─── Step 4: Stripe Connect ────────────────────────────────────────────────────

function StepStripeConnect({
  connected,
  onConnect,
}: {
  connected: boolean
  onConnect: () => void
}) {
  return (
    <div className="text-center py-6">
      <div className="w-16 h-16 rounded-2xl bg-[#FF0077]/10 border border-[#FF0077]/20 flex items-center justify-center mx-auto mb-6">
        <CreditCard className="w-8 h-8 text-[#FF0077]" />
      </div>

      <h2 className="font-bebas text-2xl text-white tracking-wide">Connect Your Payments</h2>
      <p className="mt-3 text-sm text-gray-400 max-w-md mx-auto leading-relaxed">
        FairSynq uses Stripe to pay you automatically after every transaction.
        A <span className="text-white">10% platform fee</span> is deducted.
        Payouts hit your account in real time.
      </p>

      {!connected ? (
        <div>
          <button
            onClick={onConnect}
            className="mt-8 px-8 py-3.5 bg-[#FF0077] text-white text-sm font-semibold rounded-xl hover:bg-[#FF0077]/85 hover:shadow-[0_4px_20px_rgba(255,0,119,0.3)] active:scale-[0.97] transition-all duration-200"
          >
            Connect with Stripe →
          </button>
          <p className="mt-4 text-xs text-gray-600">You'll be redirected to Stripe to complete setup.</p>
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          <div className="inline-flex items-center gap-3 px-6 py-3 bg-green-500/10 border border-green-500/20 rounded-xl">
            <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
              <Check className="w-4 h-4 text-green-400" />
            </div>
            <div className="text-left">
              <p className="text-sm font-medium text-green-400">Stripe Connected</p>
              <p className="text-xs text-gray-500">vendor@example.com</p>
            </div>
          </div>
          <div>
            <button className="text-xs text-gray-500 hover:text-white transition-colors">
              Manage Stripe Account ↗
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 grid grid-cols-3 gap-4 max-w-sm mx-auto text-left">
        {[
          { label: 'Platform Fee', value: '10%' },
          { label: 'Payout Speed', value: 'Real-time' },
          { label: 'Currencies', value: 'USD' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-sm text-white font-semibold mt-0.5">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Step 5: Review & Submit ───────────────────────────────────────────────────

function ReviewRow({ label, value, onEdit, stepIdx }: {
  label: string; value: string; onEdit: (i: number) => void; stepIdx: number
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.04] last:border-0">
      <span className="text-xs text-gray-500 w-32 shrink-0">{label}</span>
      <span className="text-sm text-white flex-1 truncate">{value || <span className="text-gray-600 italic">Not set</span>}</span>
      <button onClick={() => onEdit(stepIdx)} className="text-xs text-[#FF0077] hover:text-white transition-colors ml-3 shrink-0">
        Edit
      </button>
    </div>
  )
}

function StepReview({
  profile,
  files,
  categories,
  stripeConnected,
  onEdit,
  onSubmit,
  submitted,
}: {
  profile: Record<string, string>
  files: Record<string, DocumentFile | null>
  categories: MenuCategory[]
  stripeConnected: boolean
  onEdit: (stepIdx: number) => void
  onSubmit: () => void
  submitted: boolean
}) {
  const totalItems = categories.reduce((s, c) => s + c.items.length, 0)
  const uploadedDocs = DOCUMENTS.filter(d => files[d.key]).length

  if (submitted) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto mb-6">
          <Check className="w-8 h-8 text-green-400" />
        </div>
        <h2 className="font-bebas text-2xl text-white tracking-wide mb-2">Application Submitted!</h2>
        <p className="text-gray-400 text-sm max-w-sm mx-auto leading-relaxed">
          We'll review your application and notify you within 48 hours. Check your email for updates.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          {[
            { label: 'Submitted', done: true },
            { label: 'Under Review', done: false, active: true },
            { label: 'Approved', done: false },
          ].map(({ label, done, active }, i) => (
            <div key={label} className="flex items-center">
              {i > 0 && <div className="w-8 h-px bg-white/10 mx-1" />}
              <div className="flex flex-col items-center gap-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs
                  ${done ? 'bg-green-500 text-white' : active ? 'border-2 border-[#FF0077] text-[#FF0077] bg-[#FF0077]/10' : 'border border-white/10 text-gray-600'}`}>
                  {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                <span className={`text-[10px] ${done || active ? 'text-white' : 'text-gray-600'}`}>{label}</span>
              </div>
            </div>
          ))}
        </div>
        <Link href="/vendor" className="mt-8 inline-flex items-center gap-1.5 text-sm text-[#FF0077] hover:text-white transition-colors">
          Go to Vendor Portal <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    )
  }

  return (
    <div>
      <h2 className="font-bebas text-2xl text-white tracking-wide mb-1">Review & Submit</h2>
      <p className="text-sm text-gray-500 mb-6">Double-check everything before submitting your application.</p>

      <div className="space-y-4">
        {/* Profile */}
        <section className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3 font-medium">Business Profile</p>
          <ReviewRow label="Business" value={profile.businessName ?? ''} onEdit={onEdit} stepIdx={0} />
          <ReviewRow label="Contact" value={profile.contactName ?? ''} onEdit={onEdit} stepIdx={0} />
          <ReviewRow label="Email" value={profile.email ?? ''} onEdit={onEdit} stepIdx={0} />
          <ReviewRow label="Cuisine" value={profile.cuisineType ?? ''} onEdit={onEdit} stepIdx={0} />
        </section>

        {/* Documents */}
        <section className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3 font-medium">Documents</p>
          {DOCUMENTS.map(({ key, label, required }) => (
            <div key={key} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
              <span className="text-xs text-gray-500">{label}{required && ' *'}</span>
              {files[key] ? (
                <span className="flex items-center gap-1 text-xs text-green-400">
                  <Check className="w-3 h-3" /> {files[key]!.name}
                </span>
              ) : (
                <span className="text-xs text-red-400/70 flex items-center gap-1">
                  {required ? '⚠ Required' : '— Optional'}
                  {required && (
                    <button onClick={() => onEdit(1)} className="text-[#FF0077] hover:text-white transition-colors ml-1">Upload</button>
                  )}
                </span>
              )}
            </div>
          ))}
        </section>

        {/* Menu */}
        <section className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3 font-medium">Menu</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-white">{categories.length} {categories.length === 1 ? 'category' : 'categories'} · {totalItems} {totalItems === 1 ? 'item' : 'items'}</span>
            <button onClick={() => onEdit(2)} className="text-xs text-[#FF0077] hover:text-white transition-colors">Edit</button>
          </div>
        </section>

        {/* Stripe */}
        <section className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Payments</p>
            <button onClick={() => onEdit(3)} className="text-xs text-[#FF0077] hover:text-white transition-colors">Edit</button>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <div className={`w-2 h-2 rounded-full ${stripeConnected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className={`text-sm ${stripeConnected ? 'text-green-400' : 'text-red-400'}`}>
              {stripeConnected ? 'Stripe Connected' : 'Not Connected — required before approval'}
            </span>
          </div>
        </section>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          onClick={onSubmit}
          className="px-8 py-3 bg-[#FF0077] text-white text-sm font-semibold rounded-xl hover:bg-[#FF0077]/85 hover:shadow-[0_4px_20px_rgba(255,0,119,0.3)] active:scale-[0.97] transition-all duration-200"
        >
          Submit Application
        </button>
      </div>
    </div>
  )
}

// ─── Step indicator ────────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Profile'   },
  { label: 'Documents' },
  { label: 'Menu'      },
  { label: 'Payments'  },
  { label: 'Review'    },
]

// ─── Main wizard ───────────────────────────────────────────────────────────────

export default function VendorOnboarding() {
  const [step, setStep] = useState(0)
  const [submitted, setSubmitted] = useState(false)

  // Shared state across steps
  const [profile, setProfile] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<Record<string, DocumentFile | null>>({})
  const [categories, setCategories] = useState<MenuCategory[]>([{
    id: 'cat_default',
    name: 'Mains',
    items: [newItem()],
  }])
  const [stripeConnected, setStripeConnected] = useState(false)

  const handleProfileChange = (key: string, val: string) =>
    setProfile(p => ({ ...p, [key]: val }))

  const handleFile = (key: string, f: DocumentFile | null) =>
    setFiles(prev => ({ ...prev, [key]: f }))

  return (
    <div className="min-h-screen bg-[#0a0a0a]">

      {/* Header */}
      <div className="border-b border-white/[0.04] px-5 sm:px-8 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/" className="group flex items-center">
            <span className="font-bebas text-lg text-white group-hover:text-[#FF0077] transition-colors leading-none">FAIR</span>
            <span className="font-bebas text-lg text-[#FF0077] group-hover:text-white transition-colors leading-none">SYNQ</span>
          </Link>
          <span className="text-xs text-gray-500 uppercase tracking-wider">Vendor Onboarding</span>
        </div>
      </div>

      {/* Step indicator */}
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6">
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => (
            <div key={s.label} className="flex items-center">
              {i > 0 && (
                <div className={`hidden sm:block h-px mx-2 transition-all duration-500 ${i <= step ? 'w-12 lg:w-16 bg-[#FF0077]' : 'w-12 lg:w-16 bg-white/[0.06]'}`} />
              )}
              <div className="flex flex-col items-center gap-1.5">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-medium border-2 transition-all duration-300
                  ${i < step  ? 'bg-[#FF0077] border-[#FF0077] text-white'
                  : i === step ? 'border-[#FF0077] text-[#FF0077] bg-[#FF0077]/10'
                  :              'border-white/[0.08] text-gray-600'}`}>
                  {i < step ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`text-[10px] uppercase tracking-wider hidden sm:block ${i === step ? 'text-white' : 'text-gray-600'}`}>
                  {s.label}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="max-w-3xl mx-auto px-5 sm:px-8 pb-8">
        <div className="bg-[#111111] rounded-2xl border border-white/[0.06] p-6 sm:p-8">
          {step === 0 && <StepBusinessProfile data={profile} onChange={handleProfileChange} />}
          {step === 1 && <StepDocuments files={files} onFile={handleFile} />}
          {step === 2 && <StepMenuSetup categories={categories} setCategories={setCategories} />}
          {step === 3 && <StepStripeConnect connected={stripeConnected} onConnect={() => setStripeConnected(true)} />}
          {step === 4 && (
            <StepReview
              profile={profile}
              files={files}
              categories={categories}
              stripeConnected={stripeConnected}
              onEdit={setStep}
              onSubmit={() => setSubmitted(true)}
              submitted={submitted}
            />
          )}
        </div>

        {/* Navigation */}
        {!submitted && (
          <div className="mt-5 flex items-center justify-between">
            <button
              onClick={() => setStep(s => Math.max(0, s - 1))}
              disabled={step === 0}
              className="px-4 py-2.5 text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ← Back
            </button>
            <div className="flex items-center gap-3">
              <Link
                href="/vendor"
                className="px-4 py-2.5 text-sm text-gray-500 border border-white/[0.08] rounded-xl hover:bg-white/[0.05] hover:text-white transition-all no-underline"
              >
                Save & Exit
              </Link>
              {step < STEPS.length - 1 ? (
                <button
                  onClick={() => setStep(s => s + 1)}
                  className="px-6 py-2.5 bg-[#FF0077] text-white text-sm font-semibold rounded-xl hover:bg-[#FF0077]/85 hover:shadow-[0_4px_20px_rgba(255,0,119,0.3)] active:scale-[0.97] transition-all duration-200"
                >
                  Continue →
                </button>
              ) : (
                <button
                  onClick={() => setSubmitted(true)}
                  className="px-6 py-2.5 bg-[#FF0077] text-white text-sm font-semibold rounded-xl hover:bg-[#FF0077]/85 hover:shadow-[0_4px_20px_rgba(255,0,119,0.3)] active:scale-[0.97] transition-all duration-200"
                >
                  Submit Application
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
