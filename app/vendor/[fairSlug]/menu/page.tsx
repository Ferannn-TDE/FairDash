'use client'

import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import {
  PlusIcon, PencilIcon, TrashIcon, ClockIcon,
  CheckCircleIcon, XCircleIcon, BuildingStorefrontIcon,
  ExclamationTriangleIcon, ClockIcon as PendingIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import { ImagePlus } from 'lucide-react'
import { useVendorMeta } from '@/lib/contexts/VendorContext'
import { downscaleImage } from '@/lib/downscale-image'
import {
  STAGE_BUTTON_LABEL,
  addStaged,
  buildSubmitBody,
  optimisticRowsFor,
  reconcileAfterSubmit,
  removeStaged,
  rollbackOptimistic,
  rowsFromSubmitResponse,
  submitButtonLabel,
  trayHeading,
  trayHint,
  updateStaged,
  type StagedItem,
} from '@/lib/menu-requests/staging'
import {
  ACCEPT_IMAGE,
  ALLOWED_IMAGE_MIME,
  UPLOAD_MAX_MB,
  invalidMimeMessage,
  isWithinUploadCap,
} from '@/lib/upload-limits'

interface MenuItem {
  id: string
  name: string
  description: string
  price: number
  prepTime: number
  category: string
  imageUrl: string
  isAvailable: boolean
}

interface PendingRequest {
  id: string
  type: 'ADD' | 'EDIT' | 'DELETE'
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  name: string | null
  menuItemId: string | null
  menuItem: { name: string } | null
  createdAt: string
}

const inputCls = 'w-full bg-bg-dark border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40'
const labelCls = 'block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1'

const BLANK = {
  name: '', description: '', price: 0, prepTime: 10,
  category: '', imageUrl: '', isAvailable: true,
}

// ─── Image upload ─────────────────────────────────────────────────────────────

// This picker UPLOADS ON SELECT. The photo goes to the PUBLIC `menu-images` bucket the moment
// it is chosen, and `onChange` receives the permanent public url — so what the vendor sees in
// the preview is the object that is actually stored. It used to hand back a blob: url, which
// is an in-memory handle to a file in ONE browser tab: dead the moment that tab closes, and
// stripped to '' before submit, so a photographed menu item silently arrived at the organizer
// with no photo at all.
//
// Upload-on-select rather than hold-the-File-until-submit because the path is VENDOR-scoped
// and the vendor already exists. (The vendor-documents wizard holds Files precisely because
// the vendor does NOT exist until create — a different lifecycle, hence a different shape.)
// It also means a batch of staged items will each already carry a real url before submit.
//
// ORDER MATTERS: downscale BEFORE the cap check. A phone photo is routinely 8–12 MB and
// shrinks to well under 4 MB; checking the original would reject a perfectly good picture for
// a size it no longer has by the time it is uploaded. Same order as the delivery-proof caller.
function ImageUpload({ imageUrl, onChange, onUploadingChange }: {
  imageUrl: string
  onChange: (url: string) => void
  onUploadingChange?: (uploading: boolean) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const { vendorId } = useVendorMeta()
  const [uploading, setUploading] = useState(false)

  function setBusy(next: boolean) {
    setUploading(next)
    onUploadingChange?.(next)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    e.target.value = '' // let the same file be re-picked after a rejection
    if (!picked) return
    if (!ALLOWED_IMAGE_MIME.has(picked.type)) {
      toast.error(invalidMimeMessage(ALLOWED_IMAGE_MIME))
      return
    }
    if (!vendorId) {
      toast.error('Still loading your booth — try again in a moment')
      return
    }

    setBusy(true)
    try {
      // Shrink first (best-effort: returns the original if it can't decode), then measure.
      const file = await downscaleImage(picked)
      if (!isWithinUploadCap(file.size)) {
        toast.error(
          `This photo is still over ${UPLOAD_MAX_MB} MB after compression. ` +
          'Try a smaller image or a lower camera resolution.',
          { duration: 8000 },
        )
        return
      }

      const signRes = await fetch('/api/storage/menu-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorId, filename: file.name, contentType: file.type }),
      })
      const sign = await signRes.json()
      if (!sign.success) {
        toast.error(sign.error?.message ?? 'Could not start the image upload')
        return
      }

      // PUT straight to Supabase — token is in the url (no Authorization header).
      const put = await fetch(sign.data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type, 'x-upsert': 'true' },
        body: file,
      })
      if (!put.ok) {
        // The bucket's file_size_limit lands here as a 413 — the one rejection this app cannot
        // pre-empt, since the bytes never pass through our server.
        toast.error(
          put.status === 413
            ? `Image is too large (limit ${UPLOAD_MAX_MB} MB) — try a smaller one`
            : 'Image upload failed — check your connection and retry',
        )
        return
      }

      // Store the PUBLIC URL, not the path: this bucket is public and nothing downstream signs.
      onChange(sign.data.publicUrl)
      toast.success('Photo uploaded')
    } catch {
      toast.error('Image upload failed — check your connection and retry')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label className={labelCls}>Item Image</label>
      {uploading ? (
        <div className="w-full aspect-[4/3] rounded-xl border-2 border-dashed border-neon-pink/30 bg-neon-pink/[0.03] flex flex-col items-center justify-center gap-2">
          <ArrowPathIcon className="w-6 h-6 text-neon-pink animate-spin" />
          <p className="text-sm text-text-gray">Uploading…</p>
        </div>
      ) : imageUrl ? (
        <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-[#0a0a0a] border border-white/[0.06] group">
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} className="px-4 py-2 bg-white/10 backdrop-blur text-white text-sm font-semibold rounded-lg hover:bg-white/20 transition-colors cursor-pointer">Replace</button>
            <button type="button" onClick={() => onChange('')} className="px-4 py-2 bg-red-500/90 text-white text-sm font-semibold rounded-lg hover:bg-red-500 transition-colors cursor-pointer">Remove</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => fileRef.current?.click()} className="w-full aspect-[4/3] rounded-xl border-2 border-dashed border-white/[0.08] flex flex-col items-center justify-center gap-2 hover:border-neon-pink/30 hover:bg-neon-pink/[0.02] transition-all group cursor-pointer">
          <div className="w-12 h-12 rounded-xl bg-white/[0.04] flex items-center justify-center group-hover:bg-neon-pink/10 transition-colors">
            <ImagePlus className="w-5 h-5 text-text-gray group-hover:text-neon-pink transition-colors" />
          </div>
          <p className="text-sm text-text-gray">Upload an image</p>
          <p className="text-xs text-text-gray/50">PNG, JPG · Max {UPLOAD_MAX_MB}MB</p>
        </button>
      )}
      <input ref={fileRef} type="file" accept={ACCEPT_IMAGE} className="hidden" onChange={handleFile} />
    </div>
  )
}

// ─── Add item form ────────────────────────────────────────────────────────────

// `submitLabel` is a prop, not a constant, because this form's action changed meaning: it now
// ADDS TO THE TRAY rather than submitting for approval. The EditItemModal below keeps its own
// wording — editing a live menu item really does submit a change request, so the two must not
// share a caption.
function AddItemForm({ categories, onSubmit, onCancel, submitLabel }: {
  categories: string[]
  onSubmit: (item: typeof BLANK) => void
  onCancel: () => void
  submitLabel: string
}) {
  const [form, setForm] = useState({ ...BLANK, category: categories[0] ?? '' })
  // Submitting mid-upload would post an empty imageUrl and lose the photo silently — the
  // exact failure this build exists to remove.
  const [uploading, setUploading] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (uploading) { toast.error('Wait for the photo to finish uploading'); return }
    if (!form.name.trim()) { toast.error('Name is required'); return }
    if (form.price <= 0) { toast.error('Price must be greater than 0'); return }
    onSubmit(form)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-bg-card border border-neon-pink/25 rounded-2xl p-5 mb-6">
      <h3 className="font-bebas text-lg tracking-wide text-white mb-1">Add an item</h3>
      <p className="text-text-gray text-xs mb-4">
        This goes into your submission — nothing is sent until you submit it.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-1 gap-3 mb-3">
        <div className="col-span-2 sm:col-span-1">
          <ImageUpload imageUrl={form.imageUrl} onChange={url => setForm(p => ({ ...p, imageUrl: url }))} onUploadingChange={setUploading} />
        </div>
        <div>
          <label className={labelCls}>Item Name *</label>
          <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Brisket Plate" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Category *</label>
          <input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} placeholder="e.g., Mains" list="categories-list" className={inputCls} />
          <datalist id="categories-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
        </div>
        <div>
          <label className={labelCls}>Price (USD) *</label>
          <input required type="number" min="0.01" step="0.01" value={form.price || ''} onChange={e => setForm(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))} placeholder="0.00" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Prep Time (min)</label>
          <input type="number" min="1" max="120" value={form.prepTime} onChange={e => setForm(p => ({ ...p, prepTime: parseInt(e.target.value) || 10 }))} className={inputCls} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className={labelCls}>Description</label>
          <textarea rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What makes it special…" className={`${inputCls} resize-none`} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors cursor-pointer">Cancel</button>
        {/* SECONDARY on purpose. The neon-pink primary belongs to the tray's submit control —
            two buttons of equal weight, one saying "add" and one saying "submit", is the
            overload this relabel exists to remove. Different words AND different weight. */}
        <button
          type="submit"
          disabled={uploading}
          className="flex items-center gap-1.5 px-5 py-2 bg-white/5 border border-white/15 text-white rounded-xl text-sm font-semibold hover:bg-white/10 disabled:opacity-40 transition-colors cursor-pointer"
        >
          {uploading ? 'Uploading photo…' : <><PlusIcon className="w-4 h-4" />{submitLabel}</>}
        </button>
      </div>
    </form>
  )
}

// ─── Item row ─────────────────────────────────────────────────────────────────

function ItemRow({ item, hasPendingRequest, onToggle, onEdit, onDelete }: {
  item: MenuItem
  hasPendingRequest: boolean
  onToggle: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors ${!item.isAvailable ? 'opacity-60' : ''}`}>
      <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
        {item.imageUrl
          ? <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
          : <BuildingStorefrontIcon className="w-5 h-5 text-white/20" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-white font-semibold text-sm">{item.name}</p>
          {!item.isAvailable && (
            <span className="px-1.5 py-0.5 bg-white/5 text-text-gray text-[0.6rem] font-bold rounded-full uppercase tracking-wider">Sold Out</span>
          )}
          {hasPendingRequest && (
            <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 text-[0.6rem] font-bold rounded-full uppercase tracking-wider border border-amber-500/20">
              Pending Approval
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-neon-pink font-semibold text-xs">${(item.price ?? 0).toFixed(2)}</span>
          {item.prepTime && (
            <span className="flex items-center gap-0.5 text-text-gray text-[0.6rem]">
              <ClockIcon className="w-2.5 h-2.5" />{item.prepTime}m
            </span>
          )}
          <span className="text-text-gray text-[0.6rem]">{item.category}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onToggle(item.id)}
          title={item.isAvailable ? 'Mark as sold out' : 'Mark as available'}
          className={`p-1.5 rounded-lg transition-all cursor-pointer border-0 ${item.isAvailable ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-red-400 hover:bg-red-500/10'}`}
        >
          {item.isAvailable ? <CheckCircleIcon className="w-4 h-4" /> : <XCircleIcon className="w-4 h-4" />}
        </button>
        <button
          onClick={() => !hasPendingRequest && onEdit(item.id)}
          disabled={hasPendingRequest}
          title={hasPendingRequest ? 'Edit request already pending approval' : 'Request edit (needs approval)'}
          className="p-1.5 text-text-gray hover:text-white hover:bg-white/5 rounded-lg transition-all cursor-pointer border-0 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <PencilIcon className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => !hasPendingRequest && onDelete(item.id)}
          disabled={hasPendingRequest}
          title={hasPendingRequest ? 'Change request already pending approval' : 'Request removal (needs approval)'}
          className="p-1.5 text-text-gray hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer border-0 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditItemModal({ item, categories, onSubmit, onClose }: {
  item: MenuItem
  categories: string[]
  onSubmit: (id: string, updates: Partial<MenuItem>) => void
  onClose: () => void
}) {
  const [form, setForm] = useState({
    name: item.name, description: item.description, price: item.price,
    prepTime: item.prepTime, category: item.category, imageUrl: item.imageUrl,
  })
  const [uploading, setUploading] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <form className="relative bg-[#1c1c1c] border border-white/10 rounded-2xl p-6 w-full max-w-md overflow-y-auto max-h-[90vh]"
        onClick={e => e.stopPropagation()}
        onSubmit={e => {
          e.preventDefault()
          if (uploading) { toast.error('Wait for the photo to finish uploading'); return }
          onSubmit(item.id, form)
          onClose()
        }}>
        <h3 className="font-bebas text-xl tracking-wide text-white mb-1">Edit Item</h3>
        <p className="text-amber-400/70 text-xs mb-4">Change request requires organizer approval.</p>
        <div className="space-y-3">
          <ImageUpload imageUrl={form.imageUrl} onChange={url => setForm(p => ({ ...p, imageUrl: url }))} onUploadingChange={setUploading} />
          <div>
            <label className={labelCls}>Name</label>
            <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Price</label>
              <input required type="number" min="0.01" step="0.01" value={form.price} onChange={e => setForm(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Prep (min)</label>
              <input type="number" min="1" max="120" value={form.prepTime} onChange={e => setForm(p => ({ ...p, prepTime: parseInt(e.target.value) || 10 }))} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Category</label>
            <input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} list="edit-categories-list" className={inputCls} />
            <datalist id="edit-categories-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className={`${inputCls} resize-none`} />
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors cursor-pointer">Cancel</button>
          <button type="submit" disabled={uploading} className="px-5 py-2 bg-neon-pink text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] disabled:opacity-40 disabled:hover:bg-neon-pink shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors cursor-pointer">
            {uploading ? 'Uploading photo…' : 'Submit for Approval'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Delete confirmation modal ────────────────────────────────────────────────

function DeleteConfirmModal({ item, onConfirm, onClose }: {
  item: MenuItem
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="font-bebas text-xl text-white tracking-wide">Remove Item?</h3>
            <p className="text-white/40 text-xs">{item.name}</p>
          </div>
        </div>
        <p className="text-white/60 text-sm mb-6">
          A removal request will be sent to the organizer for approval. The item stays live until they approve.
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/5 transition-colors cursor-pointer">Cancel</button>
          <button onClick={onConfirm} className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold whitespace-nowrap transition-colors cursor-pointer">Yes, Request Removal</button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VendorMenuPage() {
  const { vendorId } = useVendorMeta()
  const [items, setItems] = useState<MenuItem[]>([])
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [staged, setStaged] = useState<StagedItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MenuItem | null>(null)
  const [unavailableTarget, setUnavailableTarget] = useState<MenuItem | null>(null)

  useEffect(() => {
    if (!vendorId) return
    setLoading(true)
    Promise.all([
      fetch(`/api/vendors/${vendorId}/menu`).then(r => r.json()),
      fetch(`/api/menu-requests?vendorId=${vendorId}`).then(r => r.json()),
    ])
      .then(([menuJson, reqJson]) => {
        if (menuJson.success) {
          const flat: MenuItem[] = []
          for (const group of menuJson.data ?? []) {
            for (const variant of group.variants ?? []) {
              flat.push({
                id: variant.id,
                name: group.variants.length > 1 ? `${group.baseName} (${variant.label})` : group.baseName,
                description: group.description ?? '',
                price: variant.price,
                prepTime: group.prepTime ?? 10,
                category: group.category,
                imageUrl: group.imageUrl ?? '',
                isAvailable: variant.available,
              })
            }
          }
          setItems(flat)
        }
        if (reqJson.success) {
          setPendingRequests((reqJson.data as PendingRequest[]).filter(r => r.status === 'PENDING'))
        }
      })
      .catch(() => toast.error('Failed to load menu'))
      .finally(() => setLoading(false))
  }, [vendorId])

  const categories = [...new Set(items.map(i => i.category))].filter(Boolean)
  const grouped = categories
    .map(cat => ({ cat, items: items.filter(i => i.category === cat) }))
    .filter(g => g.items.length > 0)

  // Set of menuItemIds that have a pending change request — edit/delete disabled on these
  const pendingItemIds = new Set(
    pendingRequests
      .map(r => r.menuItemId)
      .filter((id): id is string => !!id)
  )

  async function handleToggleAvailability(item: MenuItem) {
    const next = !item.isAvailable
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, isAvailable: next } : i))
    try {
      const res = await fetch(`/api/menu-items/${item.id}/availability`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAvailable: next }),
      })
      if (!res.ok) throw new Error()
      toast.success(`${item.name} marked ${next ? 'available' : 'sold out'}`)
    } catch {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, isAvailable: !next } : i))
      toast.error('Failed to update availability')
    }
  }

  function handleAvailabilityClick(id: string) {
    const item = items.find(i => i.id === id)
    if (!item) return
    if (item.isAvailable) {
      setUnavailableTarget(item) // turning OFF → confirm first
    } else {
      handleToggleAvailability(item) // turning ON → immediate
    }
  }

  // ── STAGING ────────────────────────────────────────────────────────────────
  // "Add Item" no longer submits — it puts the item in the tray, and one explicit
  // "Submit" sends whatever is staged. One mental model, and the tray is always an honest
  // picture of what has not been sent yet.
  //
  // A LONE ADD IS STILL A STANDALONE REQUEST. buildSubmitBody sends one item through the
  // SINGLE form, so it is written with batchId null exactly as before — a solo add does not
  // become a one-item "submission" wrapped in a batch card downstream.
  function handleStage(data: typeof BLANK) {
    setStaged(prev => addStaged(prev, {
      name: data.name,
      description: data.description,
      price: data.price,
      prepTime: data.prepTime,
      category: data.category,
      imageUrl: data.imageUrl,
    }, `stage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`))
    setShowAdd(false)
    toast.success('Added to your submission')
  }

  /** Editing a STAGED item is local — the item does not exist server-side, so no request. */
  function handleEditStaged(stageId: string, patch: Partial<StagedItem>) {
    setStaged(prev => updateStaged(prev, stageId, patch))
  }

  async function handleSubmitStaged() {
    if (!vendorId || staged.length === 0 || submitting) return
    setSubmitting(true)

    // N optimistic rows in, all at once. They carry temp ids so the reconcile can tell them
    // from real ones no matter what the server returns.
    const temps = optimisticRowsFor(
      staged,
      i => `${Date.now()}_${i}`,
      new Date().toISOString(),
    )
    const tempIds = temps.map(t => t.id)
    setPendingRequests(prev => [...temps, ...prev] as PendingRequest[])

    try {
      const res = await fetch('/api/menu-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSubmitBody(vendorId, staged)),
      })
      const json = await res.json()

      if (json.success) {
        const rows = rowsFromSubmitResponse(json.data)
        setPendingRequests(prev => reconcileAfterSubmit(prev, tempIds, rows) as PendingRequest[])
        setStaged([])
        toast.success(
          rows.length === 1
            ? 'Request submitted — awaiting organizer approval'
            : `${rows.length} items submitted — awaiting organizer approval`,
        )
      } else {
        // ALL-OR-NOTHING, ON BOTH SIDES OF THE WIRE. The route wrote nothing, so every
        // optimistic row goes — together. And the TRAY IS LEFT INTACT: the vendor's next move
        // is to fix the item the error names and resubmit the same set, which is impossible if
        // submitting cleared their work. Clearing it partially would be worse still, leaving
        // the tray disagreeing with a server that has nothing.
        setPendingRequests(prev => rollbackOptimistic(prev, tempIds) as PendingRequest[])
        toast.error(json.error?.message ?? 'Failed to submit — your items are still here')
      }
    } catch {
      setPendingRequests(prev => rollbackOptimistic(prev, tempIds) as PendingRequest[])
      toast.error('Failed to submit — your items are still here')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSaveEdit(id: string, updates: Partial<MenuItem>) {
    if (!vendorId) return
    const item = items.find(i => i.id === id)
    try {
      const res = await fetch('/api/menu-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorId, type: 'EDIT', menuItemId: id, ...updates }),
      })
      const json = await res.json()
      if (json.success) {
        setPendingRequests(prev => [{ id: json.data.id, type: 'EDIT', status: 'PENDING', name: updates.name ?? item?.name ?? null, menuItemId: id, menuItem: { name: item?.name ?? '' }, createdAt: json.data.createdAt }, ...prev])
        toast.success('Edit request submitted — awaiting organizer approval')
      } else {
        toast.error(json.error?.message ?? 'Failed to submit request')
      }
    } catch {
      toast.error('Failed to submit request')
    }
  }

  async function handleDelete(item: MenuItem) {
    if (!vendorId) return
    try {
      const res = await fetch('/api/menu-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorId, type: 'DELETE', menuItemId: item.id }),
      })
      const json = await res.json()
      if (json.success) {
        setPendingRequests(prev => [{ id: json.data.id, type: 'DELETE', status: 'PENDING', name: null, menuItemId: item.id, menuItem: { name: item.name }, createdAt: json.data.createdAt }, ...prev])
        toast.success('Removal request submitted — awaiting organizer approval')
      } else {
        toast.error(json.error?.message ?? 'Failed to submit request')
      }
    } catch {
      toast.error('Failed to submit request')
    }
    setDeleteTarget(null)
  }

  const soldOutCount = items.filter(i => !i.isAvailable).length
  const editingItem = editingId ? items.find(i => i.id === editingId) : null
  const pendingCount = pendingRequests.length

  return (
    <div className="p-5 md:p-4 max-w-[56rem] mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-bebas text-2xl tracking-wide text-white leading-none">
            Menu <span className="text-neon-pink">Manager</span>
          </h1>
          <p className="text-text-gray text-xs mt-0.5">
            {loading ? 'Loading…' : `${items.length} ${items.length === 1 ? 'item' : 'items'}${soldOutCount > 0 ? ` · ${soldOutCount} sold out` : ''}`}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-2 px-4 py-2.5 bg-neon-pink text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          Add Item
        </button>
      </div>

      {/* Pending requests banner */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 mb-5">
          <PendingIcon className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-amber-300 text-sm">
            <span className="font-semibold">{pendingCount} pending {pendingCount === 1 ? 'request' : 'requests'}</span>
            {' '}awaiting organizer approval
          </p>
        </div>
      )}

      {/* Staging tray — what has been assembled but not yet sent.
          RENDERS WHENEVER THE FORM IS OPEN, not only once something is staged. The empty tray
          is the only place a vendor learns that items collect before being sent; gating it on
          staged.length > 0 is what made batching invisible on a fresh form. */}
      {(showAdd || staged.length > 0) && (
        <div className="bg-bg-card border border-neon-pink/25 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="font-bebas text-lg tracking-wide text-white">
                {trayHeading(staged.length)}
              </h3>
              <p className="text-text-gray text-xs mt-0.5">{trayHint(staged.length)}</p>
            </div>
            {!showAdd && (
              <button
                onClick={() => setShowAdd(true)}
                disabled={submitting}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 text-white rounded-xl text-xs font-semibold hover:bg-white/10 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                Add another
              </button>
            )}
          </div>

          <div className="space-y-2 mb-4">
            {staged.map(s => (
              <div key={s.stageId} className="flex items-center gap-3 bg-[#0f0f0f] border border-white/[0.06] rounded-xl px-3 py-2.5">
                {s.imageUrl
                  ? <img src={s.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                  : <div className="w-10 h-10 rounded-lg bg-white/5 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-semibold truncate">{s.name}</p>
                  <p className="text-text-gray text-xs">${s.price.toFixed(2)} · {s.category || 'Uncategorised'}</p>
                </div>
                <input
                  type="number" min="0.01" step="0.01" value={s.price}
                  onChange={e => handleEditStaged(s.stageId, { price: parseFloat(e.target.value) || 0 })}
                  disabled={submitting}
                  title="Edit price (not sent until you submit)"
                  className="w-24 bg-bg-dark border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs outline-none focus:border-neon-pink transition-colors disabled:opacity-40"
                />
                <button
                  onClick={() => setStaged(prev => removeStaged(prev, s.stageId))}
                  disabled={submitting}
                  title="Remove from submission"
                  className="shrink-0 p-2 rounded-lg text-text-gray hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* The submit control exists only when there is something to send — an empty tray
              must not offer "Submit 0 items". */}
          {staged.length > 0 && (
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setStaged([])}
                disabled={submitting}
                className="px-4 py-2 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 disabled:opacity-40 transition-colors cursor-pointer"
              >
                Discard all
              </button>
              {/* THE primary action of this page, and the ONLY control that says "approval". */}
              <button
                onClick={handleSubmitStaged}
                disabled={submitting}
                className="px-5 py-2 bg-neon-pink text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] disabled:opacity-40 shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors cursor-pointer"
              >
                {submitting ? 'Submitting…' : submitButtonLabel(staged.length)}
              </button>
            </div>
          )}
        </div>
      )}
      {showAdd && (
        <AddItemForm
          categories={categories}
          onSubmit={handleStage}
          onCancel={() => setShowAdd(false)}
          submitLabel={STAGE_BUTTON_LABEL}
        />
      )}


      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-white/5 rounded-2xl animate-pulse" />)}
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-20 bg-bg-card border border-white/5 rounded-2xl">
          <BuildingStorefrontIcon className="w-12 h-12 mb-3 mx-auto opacity-20 text-white" />
          <p className="text-text-gray text-sm">No menu items yet. Add your first item above.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(({ cat, items: catItems }) => (
            <div key={cat}>
              <div className="flex items-center gap-3 mb-2">
                <h3 className="font-bebas text-sm tracking-widest uppercase text-text-gray">{cat}</h3>
                <div className="flex-1 h-px bg-white/[0.05]" />
                <span className="text-text-gray text-xs">{catItems.length}</span>
              </div>
              <div className="bg-bg-card border border-white/[0.06] rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
                {catItems.map(item => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    hasPendingRequest={pendingItemIds.has(item.id)}
                    onToggle={handleAvailabilityClick}
                    onEdit={setEditingId}
                    onDelete={id => {
                      const found = items.find(i => i.id === id)
                      if (found) setDeleteTarget(found)
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingItem && (
        <EditItemModal
          item={editingItem}
          categories={categories}
          onSubmit={handleSaveEdit}
          onClose={() => setEditingId(null)}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          item={deleteTarget}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {unavailableTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-sm p-6">
            <h3 className="font-bebas text-xl text-white mb-1">Mark as Sold Out?</h3>
            <p className="text-white/50 text-sm mb-2">{unavailableTarget.name}</p>
            <p className="text-white/40 text-sm mb-6">
              This item will show as sold out on the customer menu and cannot be added to cart. You can re-enable it at any time.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setUnavailableTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/5 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleToggleAvailability(unavailableTarget)
                  setUnavailableTarget(null)
                }}
                className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors cursor-pointer"
              >
                Mark Sold Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
