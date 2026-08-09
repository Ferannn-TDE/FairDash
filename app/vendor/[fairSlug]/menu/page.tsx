'use client'

import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import {
  PlusIcon, PencilIcon, TrashIcon, ClockIcon,
  CheckCircleIcon, XCircleIcon, BuildingStorefrontIcon,
  ExclamationTriangleIcon, ClockIcon as PendingIcon,
} from '@heroicons/react/24/outline'
import { ImagePlus } from 'lucide-react'
import { useVendorMeta } from '@/lib/contexts/VendorContext'
import {
  ACCEPT_IMAGE,
  ALLOWED_IMAGE_MIME,
  UPLOAD_MAX_MB,
  invalidMimeMessage,
  isWithinUploadCap,
  uploadTooLargeMessage,
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

/**
 * A blob: URL is an in-memory handle to a file in ONE browser tab. Persisting it produced a
 * link that was broken by the time anyone loaded the page — the menu-image bug. Until a real
 * upload endpoint exists, the preview stays local and the field is submitted empty. The server
 * rejects blob:/data: values too (lib/upload-limits.ts); this keeps the flow from hitting that
 * rejection for something the vendor can't fix.
 */
function submittableImageUrl(url: string | undefined): string {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return ''
  return url
}

const BLANK = {
  name: '', description: '', price: 0, prepTime: 10,
  category: '', imageUrl: '', isAvailable: true,
}

// ─── Image upload ─────────────────────────────────────────────────────────────

// This picker does NOT upload. It makes a local blob: preview — there is no menu-image upload
// endpoint yet — and `submittableImageUrl()` below strips that blob: URL before the request
// goes out, because a blob: reference is dead the moment the tab closes and storing one only
// ever produced a permanently-broken image link. The size/type checks are here anyway so the
// picker obeys the same rule as every other upload point the day the real endpoint lands, and
// so the "Max 4MB" copy is something the app actually honours rather than decoration.
function ImageUpload({ imageUrl, onChange }: { imageUrl: string; onChange: (url: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be re-picked after a rejection
    if (!file) return
    if (!ALLOWED_IMAGE_MIME.has(file.type)) {
      toast.error(invalidMimeMessage(ALLOWED_IMAGE_MIME))
      return
    }
    if (!isWithinUploadCap(file.size)) {
      toast.error(uploadTooLargeMessage())
      return
    }
    onChange(URL.createObjectURL(file))
  }

  return (
    <div>
      <label className={labelCls}>Item Image</label>
      {imageUrl ? (
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

function AddItemForm({ categories, onSubmit, onCancel }: {
  categories: string[]
  onSubmit: (item: typeof BLANK) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({ ...BLANK, category: categories[0] ?? '' })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Name is required'); return }
    if (form.price <= 0) { toast.error('Price must be greater than 0'); return }
    onSubmit(form)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-bg-card border border-neon-pink/25 rounded-2xl p-5 mb-6">
      <h3 className="font-bebas text-lg tracking-wide text-white mb-1">New Menu Item</h3>
      <p className="text-amber-400/70 text-xs mb-4">Requires organizer approval before going live.</p>
      <div className="grid grid-cols-2 sm:grid-cols-1 gap-3 mb-3">
        <div className="col-span-2 sm:col-span-1">
          <ImageUpload imageUrl={form.imageUrl} onChange={url => setForm(p => ({ ...p, imageUrl: url }))} />
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
        <button type="submit" className="px-5 py-2 bg-neon-pink text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors cursor-pointer">Submit for Approval</button>
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <form className="relative bg-[#1c1c1c] border border-white/10 rounded-2xl p-6 w-full max-w-md overflow-y-auto max-h-[90vh]"
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); onSubmit(item.id, form); onClose() }}>
        <h3 className="font-bebas text-xl tracking-wide text-white mb-1">Edit Item</h3>
        <p className="text-amber-400/70 text-xs mb-4">Change request requires organizer approval.</p>
        <div className="space-y-3">
          <ImageUpload imageUrl={form.imageUrl} onChange={url => setForm(p => ({ ...p, imageUrl: url }))} />
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
          <button type="submit" className="px-5 py-2 bg-neon-pink text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors cursor-pointer">Submit for Approval</button>
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

  async function handleAdd(data: typeof BLANK) {
    if (!vendorId) return
    try {
      const res = await fetch('/api/menu-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, imageUrl: submittableImageUrl(data.imageUrl), vendorId, type: 'ADD' }),
      })
      const json = await res.json()
      if (json.success) {
        setShowAdd(false)
        setPendingRequests(prev => [{ id: json.data.id, type: 'ADD', status: 'PENDING', name: data.name, menuItemId: null, menuItem: null, createdAt: json.data.createdAt }, ...prev])
        toast.success('Add request submitted — awaiting organizer approval')
      } else {
        toast.error(json.error?.message ?? 'Failed to submit request')
      }
    } catch {
      toast.error('Failed to submit request')
    }
  }

  async function handleSaveEdit(id: string, updates: Partial<MenuItem>) {
    if (!vendorId) return
    const item = items.find(i => i.id === id)
    try {
      const res = await fetch('/api/menu-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId, type: 'EDIT', menuItemId: id, ...updates,
          ...(updates.imageUrl !== undefined && { imageUrl: submittableImageUrl(updates.imageUrl) }),
        }),
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

      {showAdd && <AddItemForm categories={categories} onSubmit={handleAdd} onCancel={() => setShowAdd(false)} />}

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
