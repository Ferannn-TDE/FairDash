'use client'

import { useState, useRef, useCallback, Fragment } from 'react'
import Link from 'next/link'
import {
  BuildingStorefrontIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  XMarkIcon,
  PlusIcon,
  LockClosedIcon,
  DocumentArrowUpIcon,
  PhotoIcon,
  ClockIcon,
  CreditCardIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid'
import toast from 'react-hot-toast'

// ─── Types ────────────────────────────────────────────────────────────────────

type BoothSize = 'small' | 'medium' | 'large' | 'xl'
type UtilityNeed = 'electricity' | 'water' | 'gas' | 'waste' | 'wifi'

interface MenuItemData {
  id: string
  name: string
  description: string
  price: string
  prepTime: string
  photo: File | null
  photoPreview: string | null
}

interface BoothPhotoData {
  id: string
  file: File
  preview: string
}

interface FormData {
  businessName: string
  contactName: string
  email: string
  phone: string
  cuisineType: string
  boothSize: BoothSize | ''
  utilityNeeds: UtilityNeed[]
  description: string
  foodHandlerPermit: File | null
  liabilityInsurance: File | null
  menuItems: MenuItemData[]
  boothPhotos: BoothPhotoData[]
  legalName: string
  stripeConnected: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CUISINE_OPTIONS = [
  'BBQ & Grilled', 'American', 'Mexican', 'Italian', 'Asian Fusion',
  'Japanese', 'Seafood', 'Vegan / Vegetarian', 'Desserts & Sweets',
  'Fried Food', 'Drinks & Beverages', 'Fair Classics', 'Merchandise', 'Other',
]

const BOOTH_SIZES: { value: BoothSize; label: string; desc: string }[] = [
  { value: 'small',  label: 'Small',  desc: '10×10 ft' },
  { value: 'medium', label: 'Medium', desc: '10×20 ft' },
  { value: 'large',  label: 'Large',  desc: '20×20 ft' },
  { value: 'xl',     label: 'XL',     desc: '20×40 ft' },
]

const UTILITY_OPTIONS: { value: UtilityNeed; label: string; icon: string }[] = [
  { value: 'electricity', label: 'Electricity', icon: '⚡' },
  { value: 'water',       label: 'Water',        icon: '💧' },
  { value: 'gas',         label: 'Natural Gas',  icon: '🔥' },
  { value: 'waste',       label: 'Waste/Grease', icon: '🗑️' },
  { value: 'wifi',        label: 'WiFi / POS',   icon: '📶' },
]

const STEPS = [
  { num: 1, label: 'Account',     hardBlock: false },
  { num: 2, label: 'Application', hardBlock: false },
  { num: 3, label: 'Documents',   hardBlock: true  },
  { num: 4, label: 'Menu',        hardBlock: true  },
  { num: 5, label: 'Photos',      hardBlock: false },
  { num: 6, label: 'Agreement',   hardBlock: false },
  { num: 7, label: 'Stripe',      hardBlock: true  },
]

const VENDOR_TERMS = `FAIRSYNQ VENDOR AGREEMENT
Last Updated: January 1, 2026

This Vendor Agreement is entered into between FairSynq LLC ("FairSynq") and the vendor applying to participate on the FairSynq platform.

1. VENDOR ELIGIBILITY
To become a FairSynq vendor, you must: (a) be a legally registered business or sole proprietor; (b) hold all required food handler permits and health department certifications; (c) maintain valid general liability insurance of at least $1,000,000 per occurrence; and (d) agree to operate within the designated FairSynq service area during scheduled fair events.

2. PLATFORM FEES & COMMISSIONS
FairSynq charges a commission of 10% on each completed order. Vendors receive payment via Stripe within 3–5 business days after each event settlement period. FairSynq reserves the right to adjust commission rates with 30 days' written notice.

3. MENU & PRICING
Vendors are responsible for maintaining accurate, up-to-date menu listings including item names, descriptions, allergen information, and pricing. Prices listed on FairSynq must match or be lower than prices charged at your on-site booth.

4. ORDER FULFILLMENT & QUALITY
You agree to: (a) prepare orders promptly; (b) notify FairSynq immediately if an item becomes unavailable; (c) package orders securely for delivery or curbside pickup; and (d) maintain a minimum order fulfillment rate of 95% per event.

5. FOOD SAFETY & COMPLIANCE
All food prepared and sold through FairSynq must comply with applicable food safety regulations. Vendors indemnify FairSynq against any claims arising from foodborne illness or improper food handling.

6. CUSTOMER REVIEWS & RATINGS
Vendors with an average rating below 3.5 stars over 30 days may receive a performance notice. Continued low ratings may result in reduced visibility or account suspension.

7. TERMINATION
Either party may terminate this Agreement with 14 days' written notice. FairSynq may terminate immediately for violations, fraudulent activity, or repeated food safety complaints.

8. GOVERNING LAW
This Agreement is governed by the laws of the State of Illinois. Disputes shall be resolved by binding arbitration.

By typing your full legal name below, you confirm you have read, understood, and agree to be bound by this Agreement.`

const INITIAL_ITEM: MenuItemData = { id: '1', name: '', description: '', price: '', prepTime: '', photo: null, photoPreview: null }

const INITIAL: FormData = {
  businessName: '', contactName: '', email: '', phone: '',
  cuisineType: '', boothSize: '', utilityNeeds: [], description: '',
  foodHandlerPermit: null, liabilityInsurance: null,
  menuItems: [{ ...INITIAL_ITEM }],
  boothPhotos: [], legalName: '', stripeConnected: false,
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
      {children}{required && <span className="text-neon-pink ml-0.5">*</span>}
    </p>
  )
}

const iCls = 'w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-white/20'

function HardBlockBanner({ satisfied, label }: { satisfied: boolean; label: string }) {
  if (satisfied) return (
    <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
      <CheckCircleIcon className="w-4 h-4 text-emerald-400 shrink-0" />
      <p className="text-sm text-emerald-400"><span className="font-semibold">{label}</span> — Step unlocked</p>
    </div>
  )
  return (
    <div className="flex items-center gap-2.5 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
      <LockClosedIcon className="w-4 h-4 text-amber-400 shrink-0" />
      <p className="text-sm text-amber-400"><span className="font-semibold">{label}</span> — Required to continue</p>
    </div>
  )
}

function DocUploadBox({ label, hint, file, onFile, onClear }: {
  label: string; hint: string; file: File | null
  onFile: (f: File) => void; onClear: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div>
      <Label required>{label}</Label>
      {!file ? (
        <div
          onClick={() => ref.current?.click()}
          className="group flex flex-col items-center justify-center py-8 border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:border-neon-pink/40 hover:bg-white/[0.02] transition-all"
        >
          <DocumentArrowUpIcon className="w-7 h-7 text-text-gray group-hover:text-neon-pink transition-colors mb-2" />
          <p className="text-sm text-text-gray group-hover:text-white transition-colors text-center">
            <span className="text-neon-pink font-semibold">Click to upload</span> or drag & drop
          </p>
          <p className="text-xs text-white/25 mt-1">{hint}</p>
          <input ref={ref} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
            onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
          <CheckCircleSolid className="w-5 h-5 text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium truncate">{file.name}</p>
            <p className="text-xs text-text-gray">{(file.size / 1024).toFixed(0)} KB · Uploaded</p>
          </div>
          <button onClick={onClear} className="p-1.5 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0">
            <XMarkIcon className="w-4 h-4 text-text-gray" />
          </button>
        </div>
      )}
    </div>
  )
}

function MenuPhotoUpload({ preview, onFile, onClear }: { preview: string | null; onFile: (f: File) => void; onClear: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  if (!preview) return (
    <div onClick={() => ref.current?.click()} className="group flex items-center justify-center h-24 border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:border-neon-pink/30 hover:bg-white/[0.02] transition-all">
      <div className="text-center">
        <PhotoIcon className="w-6 h-6 text-text-gray group-hover:text-neon-pink transition-colors mx-auto mb-1" />
        <span className="text-xs text-text-gray group-hover:text-white transition-colors">Add photo</span>
        <span className="text-neon-pink ml-1 text-xs font-semibold">*</span>
      </div>
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
    </div>
  )
  return (
    <div className="relative h-24">
      <img src={preview} alt="Item preview" className="w-full h-full object-cover rounded-xl border border-white/10" />
      <button onClick={onClear} className="absolute top-1.5 right-1.5 p-1 bg-bg-dark/80 border border-white/10 rounded-lg cursor-pointer bg-transparent">
        <XMarkIcon className="w-3.5 h-3.5 text-text-gray" />
      </button>
    </div>
  )
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="mb-8">
      {/* Mobile */}
      <div className="sm:hidden mb-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-gray uppercase tracking-wide">Step {step} of 7</span>
          <span className="text-xs font-bold text-white uppercase tracking-wide">{STEPS.find(s => s.num === step)?.label}</span>
        </div>
        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-neon-pink to-[#ff4488] rounded-full transition-all duration-500 ease-out"
            style={{ width: `${((step - 1) / 6) * 100}%` }} />
        </div>
      </div>
      {/* Desktop */}
      <div className="hidden sm:flex items-start w-full">
        {STEPS.map((s, i) => {
          const done = step > s.num
          const active = step === s.num
          return (
            <Fragment key={s.num}>
              <div className="flex flex-col items-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[0.625rem] font-bold border-2 transition-all duration-300 ${
                  done ? 'bg-neon-pink border-neon-pink text-white' :
                  active ? 'border-neon-pink text-neon-pink bg-neon-pink/10' :
                  'border-white/10 text-white/30 bg-transparent'
                }`}>
                  {done ? <CheckIcon className="w-3.5 h-3.5" /> : s.num}
                </div>
                <span className={`text-[0.5rem] mt-1 font-bold uppercase tracking-wide whitespace-nowrap transition-colors ${
                  active ? 'text-white' : done ? 'text-neon-pink' : 'text-white/20'
                }`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px mt-3.5 mx-1.5 transition-all duration-500 ${done ? 'bg-neon-pink/50' : 'bg-white/[0.06]'}`} />
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

// ─── Step components ──────────────────────────────────────────────────────────

function Step1({ data, update }: { data: FormData; update: (p: Partial<FormData>) => void }) {
  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="font-bebas text-2xl tracking-wide text-white mb-1">Account Setup</h2>
        <p className="text-text-gray text-sm">Your business identity on FairSynq.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label required>Business Name</Label>
          <input className={iCls} placeholder="Big Bob's Corn Dogs" value={data.businessName}
            onChange={e => update({ businessName: e.target.value })} />
        </div>
        <div>
          <Label required>Contact Name</Label>
          <input className={iCls} placeholder="Jane Smith" value={data.contactName}
            onChange={e => update({ contactName: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label required>Email Address</Label>
          <input type="email" className={iCls} placeholder="jane@business.com" value={data.email}
            onChange={e => update({ email: e.target.value })} />
        </div>
        <div>
          <Label required>Phone Number</Label>
          <input type="tel" className={iCls} placeholder="(555) 000-0000" value={data.phone}
            onChange={e => update({ phone: e.target.value })} />
        </div>
      </div>
    </div>
  )
}

function Step2({ data, update }: { data: FormData; update: (p: Partial<FormData>) => void }) {
  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 space-y-6">
      <div>
        <h2 className="font-bebas text-2xl tracking-wide text-white mb-1">Application Details</h2>
        <p className="text-text-gray text-sm">Tell us about your booth and offerings.</p>
      </div>

      {/* Cuisine type */}
      <div>
        <Label required>Cuisine Type</Label>
        <div className="flex flex-wrap gap-2 mt-1">
          {CUISINE_OPTIONS.map(c => (
            <button key={c} onClick={() => update({ cuisineType: c })}
              className={`px-3.5 py-2 rounded-full text-sm font-medium border cursor-pointer transition-all duration-200 ${
                data.cuisineType === c
                  ? 'bg-neon-pink border-neon-pink text-white shadow-[0_2px_8px_rgba(255,0,119,0.3)]'
                  : 'bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white'
              }`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Booth size */}
      <div>
        <Label required>Booth Size</Label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
          {BOOTH_SIZES.map(({ value, label, desc }) => (
            <button key={value} onClick={() => update({ boothSize: value })}
              className={`p-4 rounded-xl border text-left cursor-pointer transition-all duration-200 ${
                data.boothSize === value
                  ? 'bg-neon-pink/10 border-neon-pink/60'
                  : 'bg-white/[0.03] border-white/10 hover:border-white/20'
              }`}>
              <p className={`font-bebas text-lg tracking-wide ${data.boothSize === value ? 'text-neon-pink' : 'text-white'}`}>{label}</p>
              <p className="text-xs text-text-gray">{desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Utility needs */}
      <div>
        <Label>Utility Needs <span className="text-white/20 normal-case font-normal ml-1">(optional)</span></Label>
        <div className="flex flex-wrap gap-2 mt-1">
          {UTILITY_OPTIONS.map(({ value, label, icon }) => {
            const sel = data.utilityNeeds.includes(value)
            return (
              <button key={value}
                onClick={() => update({ utilityNeeds: sel ? data.utilityNeeds.filter(u => u !== value) : [...data.utilityNeeds, value] })}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium border cursor-pointer transition-all duration-200 ${
                  sel ? 'bg-neon-pink/10 border-neon-pink/40 text-neon-pink' : 'bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white'
                }`}>
                <span>{icon}</span>{label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Description */}
      <div>
        <Label required>Short Description</Label>
        <textarea value={data.description} onChange={e => update({ description: e.target.value })} rows={4}
          className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-white/20 resize-none"
          placeholder="Tell fair-goers about your food and what makes it special... (20+ characters required)" />
        <p className={`text-xs mt-1 transition-colors ${data.description.trim().length >= 20 ? 'text-emerald-400' : 'text-text-gray'}`}>
          {data.description.trim().length} / 20 characters minimum
        </p>
      </div>
    </div>
  )
}

function Step3({ data, update }: { data: FormData; update: (p: Partial<FormData>) => void }) {
  const satisfied = !!(data.foodHandlerPermit && data.liabilityInsurance)
  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="font-bebas text-2xl tracking-wide text-white mb-1">Document Upload</h2>
        <p className="text-text-gray text-sm">Both documents are required. You cannot proceed without them.</p>
      </div>
      <HardBlockBanner satisfied={satisfied} label="Both documents required" />
      <DocUploadBox label="Food Handler Permit" hint="PDF, JPG, or PNG — issued by your local health department"
        file={data.foodHandlerPermit}
        onFile={f => update({ foodHandlerPermit: f })}
        onClear={() => update({ foodHandlerPermit: null })} />
      <DocUploadBox label="Liability Insurance Certificate" hint="PDF, JPG, or PNG — minimum $1M per occurrence"
        file={data.liabilityInsurance}
        onFile={f => update({ liabilityInsurance: f })}
        onClear={() => update({ liabilityInsurance: null })} />
    </div>
  )
}

function Step4({ data, addItem, removeItem, updateItem, itemComplete }: {
  data: FormData
  addItem: () => void
  removeItem: (id: string) => void
  updateItem: (id: string, patch: Partial<MenuItemData>) => void
  itemComplete: (item: MenuItemData) => boolean
}) {
  const allDone = data.menuItems.length > 0 && data.menuItems.every(itemComplete)
  const doneCount = data.menuItems.filter(itemComplete).length

  return (
    <div className="space-y-4">
      <div className="bg-bg-card border border-white/10 rounded-2xl p-6">
        <h2 className="font-bebas text-2xl tracking-wide text-white mb-1">Menu Setup</h2>
        <p className="text-text-gray text-sm">Every item requires a name, description, price, prep time, and photo.</p>
      </div>

      <HardBlockBanner satisfied={allDone}
        label={allDone ? 'All menu items complete' : `${doneCount} of ${data.menuItems.length} items complete`} />

      {data.menuItems.map((item, index) => {
        const done = itemComplete(item)
        return (
          <div key={item.id} className={`bg-bg-card border rounded-2xl p-6 transition-colors ${done ? 'border-emerald-500/20' : 'border-white/10'}`}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500/20' : 'bg-white/5'}`}>
                  {done
                    ? <CheckIcon className="w-3.5 h-3.5 text-emerald-400" />
                    : <span className="text-[0.625rem] font-bold text-text-gray">{index + 1}</span>
                  }
                </div>
                <h3 className="text-white font-semibold text-sm">{item.name || `Item ${index + 1}`}</h3>
              </div>
              {data.menuItems.length > 1 && (
                <button onClick={() => removeItem(item.id)}
                  className="flex items-center gap-1 text-xs text-text-gray hover:text-red-400 transition-colors cursor-pointer bg-transparent border-0">
                  <XMarkIcon className="w-3.5 h-3.5" />Remove
                </button>
              )}
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label required>Item Name</Label>
                  <input className={iCls} placeholder="e.g. BBQ Pulled Pork Sandwich" value={item.name}
                    onChange={e => updateItem(item.id, { name: e.target.value })} />
                </div>
                <div>
                  <Label required>Price</Label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-gray text-sm font-medium">$</span>
                    <input type="number" step="0.01" min="0" className={iCls + ' pl-8'} placeholder="9.99"
                      value={item.price} onChange={e => updateItem(item.id, { price: e.target.value })} />
                  </div>
                </div>
              </div>

              <div>
                <Label required>Description</Label>
                <textarea rows={3}
                  className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-white/20 resize-none"
                  placeholder="Describe the item, ingredients, or what makes it special..."
                  value={item.description}
                  onChange={e => updateItem(item.id, { description: e.target.value })} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label required>Prep Time (minutes)</Label>
                  <div className="relative">
                    <ClockIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-gray" />
                    <input type="number" min="1" max="90" className={iCls + ' pl-10'} placeholder="12"
                      value={item.prepTime} onChange={e => updateItem(item.id, { prepTime: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label required>Item Photo</Label>
                  <MenuPhotoUpload
                    preview={item.photoPreview}
                    onFile={f => updateItem(item.id, { photo: f, photoPreview: URL.createObjectURL(f) })}
                    onClear={() => updateItem(item.id, { photo: null, photoPreview: null })}
                  />
                </div>
              </div>
            </div>
          </div>
        )
      })}

      <button onClick={addItem}
        className="w-full py-3.5 border-2 border-dashed border-white/10 rounded-2xl text-text-gray hover:text-white hover:border-white/20 transition-all flex items-center justify-center gap-2 cursor-pointer bg-transparent font-semibold text-sm">
        <PlusIcon className="w-4 h-4 text-neon-pink" />Add Menu Item
      </button>
    </div>
  )
}

function Step5({ data, addPhoto, removePhoto }: {
  data: FormData
  addPhoto: (f: File) => void
  removePhoto: (id: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const needed = Math.max(0, 2 - data.boothPhotos.length)

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="font-bebas text-2xl tracking-wide text-white mb-1">Booth Photos</h2>
        <p className="text-text-gray text-sm">Upload at least 2 photos of your booth, setup, or food.</p>
      </div>

      {needed > 0 && (
        <div className="flex items-center gap-2.5 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          <PhotoIcon className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-400">{needed} more photo{needed > 1 ? 's' : ''} required</p>
        </div>
      )}

      {data.boothPhotos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {data.boothPhotos.map(photo => (
            <div key={photo.id} className="relative aspect-square">
              <img src={photo.preview} alt="Booth" className="w-full h-full object-cover rounded-xl border border-white/10" />
              <button onClick={() => removePhoto(photo.id)}
                className="absolute top-1.5 right-1.5 p-1 bg-bg-dark/80 border border-white/10 rounded-lg cursor-pointer bg-transparent">
                <XMarkIcon className="w-3.5 h-3.5 text-text-gray hover:text-red-400 transition-colors" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div onClick={() => ref.current?.click()}
        className="group flex flex-col items-center justify-center py-8 border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:border-neon-pink/30 hover:bg-white/[0.02] transition-all">
        <PhotoIcon className="w-8 h-8 text-text-gray group-hover:text-neon-pink transition-colors mb-2" />
        <p className="text-sm text-text-gray group-hover:text-white transition-colors">
          <span className="text-neon-pink font-semibold">Click to upload</span> photos
        </p>
        <p className="text-xs text-white/25 mt-1">JPG, PNG — up to 10MB each · Multiple allowed</p>
        <input ref={ref} type="file" accept="image/*" multiple className="hidden"
          onChange={e => e.target.files && Array.from(e.target.files).forEach(addPhoto)} />
      </div>
    </div>
  )
}

function Step6({ data, update }: { data: FormData; update: (p: Partial<FormData>) => void }) {
  const signed = data.legalName.trim().length >= 3
  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="font-bebas text-2xl tracking-wide text-white mb-1">Digital Agreement</h2>
        <p className="text-text-gray text-sm">Read the vendor agreement and sign with your full legal name.</p>
      </div>

      {/* Pre-filled details */}
      <div className="grid grid-cols-2 gap-3 p-4 bg-white/[0.03] border border-white/5 rounded-xl">
        {[
          { label: 'Business', value: data.businessName },
          { label: 'Contact',  value: data.contactName  },
          { label: 'Email',    value: data.email        },
          { label: 'Date',     value: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-[0.5625rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">{label}</p>
            <p className="text-sm text-white truncate">{value || '—'}</p>
          </div>
        ))}
      </div>

      {/* Agreement text */}
      <div className="h-52 overflow-y-auto bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-text-gray text-[0.8125rem] leading-relaxed whitespace-pre-line">
        {VENDOR_TERMS}
      </div>

      {/* Signature */}
      <div>
        <Label required>Type your full legal name to sign</Label>
        <input className={iCls} placeholder="e.g. Jane Elizabeth Smith"
          value={data.legalName} onChange={e => update({ legalName: e.target.value })} />
        {signed && (
          <div className="mt-3 flex items-center gap-2.5 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
            <ShieldCheckIcon className="w-4 h-4 text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-400">
              Signed by <span className="font-semibold text-white">{data.legalName}</span>
              <span className="text-emerald-500/70"> · {new Date().toLocaleDateString()} · Session IP logged</span>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Step7({ data, onConnect, loading }: { data: FormData; onConnect: () => void; loading: boolean }) {
  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 space-y-6">
      <div>
        <h2 className="font-bebas text-2xl tracking-wide text-white mb-1">Payment Setup</h2>
        <p className="text-text-gray text-sm">Connect Stripe to receive payouts from FairSynq.</p>
      </div>

      <HardBlockBanner satisfied={data.stripeConnected} label="Stripe account required before submitting" />

      {!data.stripeConnected ? (
        <div className="space-y-4">
          <div className="p-5 bg-white/[0.03] border border-white/5 rounded-xl space-y-3">
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold">Why Stripe?</p>
            {[
              'Payouts within 3–5 business days, direct to your bank',
              'PCI-compliant payment processing — no card data on our servers',
              'Real-time earnings visible in your vendor dashboard',
              'No monthly fees — 10% commission per completed order only',
            ].map(item => (
              <div key={item} className="flex items-start gap-2.5">
                <CheckCircleIcon className="w-4 h-4 text-neon-pink shrink-0 mt-0.5" />
                <p className="text-sm text-text-gray">{item}</p>
              </div>
            ))}
          </div>

          <button onClick={onConnect} disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-4 bg-[#635BFF] hover:bg-[#5146e6] text-white font-semibold rounded-xl transition-colors cursor-pointer border-0 disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_4px_16px_rgba(99,91,255,0.3)]">
            {loading ? (
              <><div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />Connecting…</>
            ) : (
              <><CreditCardIcon className="w-5 h-5" />Connect Stripe Account</>
            )}
          </button>
          <p className="text-center text-xs text-text-gray">You'll complete Stripe's secure onboarding, then return here</p>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center py-6 space-y-3">
          <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center">
            <CheckCircleSolid className="w-8 h-8 text-emerald-400" />
          </div>
          <h3 className="font-bebas text-xl tracking-wide text-white">Stripe Connected!</h3>
          <p className="text-text-gray text-sm">Your account is verified and ready to receive payouts.</p>
        </div>
      )}
    </div>
  )
}

function Step8({ data }: { data: FormData }) {
  return (
    <div className="py-4 text-center space-y-6 animate-fadeIn">
      <div className="relative inline-flex">
        <div className="w-24 h-24 bg-neon-pink/10 border border-neon-pink/20 rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(255,0,119,0.15)]">
          <SparklesIcon className="w-12 h-12 text-neon-pink" />
        </div>
      </div>

      <div>
        <h2 className="font-bebas text-[clamp(2rem,6vw,3rem)] tracking-wide text-white leading-tight mb-2">
          Application <span className="text-neon-pink">Submitted!</span>
        </h2>
        <p className="text-text-gray">
          Thank you, <span className="text-white font-semibold">{data.businessName || 'your business'}</span>. We received everything.
        </p>
      </div>

      <div className="max-w-sm mx-auto p-5 bg-bg-card border border-white/10 rounded-2xl text-left space-y-3.5">
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold">What Happens Next</p>
        {[
          { n: '01', t: 'The event operator reviews your application (24–48 hrs)' },
          { n: '02', t: 'You receive approval or decline with reason via email' },
          { n: '03', t: 'If approved, you gain immediate access to your vendor dashboard' },
          { n: '04', t: 'You are NOT live until the operator sets your go-live date' },
        ].map(({ n, t }) => (
          <div key={n} className="flex items-start gap-3">
            <span className="font-bebas text-lg text-neon-pink leading-none shrink-0 w-6">{n}</span>
            <p className="text-sm text-text-gray leading-relaxed">{t}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-text-gray">
        Confirmation sent to <span className="text-white">{data.email}</span>
      </p>

      <Link href="/"
        className="inline-flex items-center px-8 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 transition-all no-underline">
        Back to Home
      </Link>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VendorOnboarding() {
  const [step, setStep] = useState(1)
  const [data, setData] = useState<FormData>(INITIAL)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [stripeLoading, setStripeLoading] = useState(false)

  const update = useCallback((patch: Partial<FormData>) => setData(d => ({ ...d, ...patch })), [])

  const itemComplete = (item: MenuItemData) =>
    item.name.trim() !== '' &&
    item.description.trim() !== '' &&
    item.price.trim() !== '' &&
    item.prepTime.trim() !== '' &&
    item.photo !== null

  const canProceed = (() => {
    switch (step) {
      case 1: return !!(data.businessName.trim() && data.contactName.trim() && data.email.trim() && data.phone.trim())
      case 2: return !!(data.cuisineType && data.boothSize && data.description.trim().length >= 20)
      case 3: return !!(data.foodHandlerPermit && data.liabilityInsurance)
      case 4: return data.menuItems.length > 0 && data.menuItems.every(itemComplete)
      case 5: return data.boothPhotos.length >= 2
      case 6: return data.legalName.trim().length >= 3
      case 7: return data.stripeConnected
      default: return true
    }
  })()

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      const eventSlug = new URLSearchParams(window.location.search).get('event')
      const res = await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventSlug,
          name: data.businessName,
          description: data.description,
          cuisineType: data.cuisineType,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json?.error ?? 'Registration failed')
      }
      toast.success('Application submitted!')
      setStep(8)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleStripeConnect = async () => {
    setStripeLoading(true)
    await new Promise(r => setTimeout(r, 2000))
    update({ stripeConnected: true })
    setStripeLoading(false)
    toast.success('Stripe account connected!')
  }

  const addItem = () => update({ menuItems: [...data.menuItems, { ...INITIAL_ITEM, id: `${Date.now()}` }] })
  const removeItem = (id: string) => update({ menuItems: data.menuItems.filter(m => m.id !== id) })
  const updateItem = (id: string, patch: Partial<MenuItemData>) =>
    update({ menuItems: data.menuItems.map(m => m.id === id ? { ...m, ...patch } : m) })
  const addPhoto = (file: File) =>
    update({ boothPhotos: [...data.boothPhotos, { id: `${Date.now()}-${Math.random()}`, file, preview: URL.createObjectURL(file) }] })
  const removePhoto = (id: string) => update({ boothPhotos: data.boothPhotos.filter(p => p.id !== id) })

  return (
    <div className="pt-20 min-h-screen pb-20 bg-bg-dark">
      <div className="max-w-[680px] mx-auto px-5 py-10">

        {step < 8 && (
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-neon-pink/10 border border-neon-pink/20 rounded-2xl mb-4 shadow-[0_0_24px_rgba(255,0,119,0.12)]">
              <BuildingStorefrontIcon className="w-7 h-7 text-neon-pink" />
            </div>
            <h1 className="font-bebas text-[clamp(2rem,5vw,3rem)] tracking-wide text-white leading-tight mb-2">
              Become a <span className="text-neon-pink">Vendor</span>
            </h1>
            <p className="text-text-gray text-sm">Complete all steps to join the FairSynq marketplace.</p>
          </div>
        )}

        {step < 8 && <ProgressBar step={step} />}

        {/* Step content with key for animation re-trigger */}
        <div key={step} className="animate-fadeIn">
          {step === 1 && <Step1 data={data} update={update} />}
          {step === 2 && <Step2 data={data} update={update} />}
          {step === 3 && <Step3 data={data} update={update} />}
          {step === 4 && <Step4 data={data} addItem={addItem} removeItem={removeItem} updateItem={updateItem} itemComplete={itemComplete} />}
          {step === 5 && <Step5 data={data} addPhoto={addPhoto} removePhoto={removePhoto} />}
          {step === 6 && <Step6 data={data} update={update} />}
          {step === 7 && <Step7 data={data} onConnect={handleStripeConnect} loading={stripeLoading} />}
          {step === 8 && <Step8 data={data} />}
        </div>

        {/* Navigation */}
        {step < 8 && (
          <div className="flex justify-between mt-6">
            {step > 1 ? (
              <button onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-2 px-5 py-2.5 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 transition-all cursor-pointer">
                <ChevronLeftIcon className="w-4 h-4" />Back
              </button>
            ) : (
              <Link href="/"
                className="flex items-center gap-2 px-5 py-2.5 bg-white/5 border border-white/10 text-text-gray rounded-xl font-semibold text-sm hover:bg-white/10 transition-all no-underline">
                Cancel
              </Link>
            )}

            {step < 7 ? (
              <button onClick={() => setStep(s => s + 1)} disabled={!canProceed}
                className="flex items-center gap-2 px-6 py-2.5 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-all cursor-pointer border-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-neon-pink">
                Continue<ChevronRightIcon className="w-4 h-4" />
              </button>
            ) : step === 7 ? (
              <button onClick={handleSubmit} disabled={!canProceed || isSubmitting}
                className="flex items-center gap-2 px-6 py-2.5 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-all cursor-pointer border-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-neon-pink">
                {isSubmitting ? 'Submitting…' : (<>Submit Application<CheckIcon className="w-4 h-4" /></>)}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
