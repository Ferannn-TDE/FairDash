'use client'

import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  PhotoIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

interface MenuItem {
  id: string
  name: string
  description?: string
  price: number
  prepTime?: number
  category: string
  imageUrl?: string
  isAvailable: boolean
}

interface Vendor {
  id: string
  name: string
}

const MENU_CATEGORIES = ['Mains', 'Sides', 'Drinks', 'Desserts', 'Snacks', 'Combos', 'Other']

const BLANK_FORM = { name: '', description: '', price: '', prepTime: '15', category: 'Mains', imageUrl: '' }

export default function VendorMenuPage() {
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)

  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState(BLANK_FORM)
  const [addingItem, setAddingItem] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<typeof BLANK_FORM>>({})

  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const editFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/vendors/me')
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) { setLoading(false); return }
        const v = json.data.vendor
        setVendor({ id: v.id, name: v.name })
        setMenuItems(v.menuItems ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.price || !form.category || !vendor) {
      toast.error('Name, price, and category are required')
      return
    }
    setAddingItem(true)
    try {
      const res = await fetch('/api/menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId: vendor.id,
          name: form.name,
          description: form.description || undefined,
          price: parseFloat(form.price),
          prepTime: parseInt(form.prepTime) || 15,
          category: form.category,
          imageUrl: form.imageUrl || undefined,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message || 'Failed to add item')
      setMenuItems((prev) => [...prev, json.data])
      setForm(BLANK_FORM)
      setShowAddForm(false)
      toast.success(`${json.data.name} added to menu`)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setAddingItem(false)
    }
  }

  const handleToggleAvailability = async (item: MenuItem) => {
    setTogglingIds((prev) => new Set(prev).add(item.id))
    try {
      const res = await fetch(`/api/menu/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAvailable: !item.isAvailable }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message || 'Update failed')
      setMenuItems((prev) => prev.map((m) => m.id === item.id ? { ...m, isAvailable: !m.isAvailable } : m))
      toast.success(`${item.name} marked ${!item.isAvailable ? 'available' : 'sold out'}`)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setTogglingIds((prev) => { const s = new Set(prev); s.delete(item.id); return s })
    }
  }

  const handleSaveEdit = async (item: MenuItem) => {
    try {
      const res = await fetch(`/api/menu/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          description: editForm.description,
          price: parseFloat(editForm.price ?? '0'),
          prepTime: parseInt(editForm.prepTime ?? '15') || 15,
          category: editForm.category,
          imageUrl: editForm.imageUrl || null,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message || 'Update failed')
      setMenuItems((prev) => prev.map((m) => m.id === item.id ? json.data : m))
      setEditingId(null)
      toast.success(`${json.data.name} updated`)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleDelete = async (item: MenuItem) => {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return
    setDeletingId(item.id)
    try {
      const res = await fetch(`/api/menu/${item.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message || 'Delete failed')
      setMenuItems((prev) => prev.filter((m) => m.id !== item.id))
      toast.success(`${item.name} removed from menu`)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeletingId(null)
    }
  }

  const handlePhotoUpload = async (file: File, itemId: string | null, isEdit: boolean) => {
    setUploadingId(itemId ?? 'new')
    try {
      const res = await fetch('/api/storage/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      })
      const json = await res.json()
      if (!json.success) { toast.error(json.error?.message ?? 'Photo upload not available'); return }
      await fetch(json.data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      const publicUrl: string = json.data.publicUrl
      if (isEdit) setEditForm((prev) => ({ ...prev, imageUrl: publicUrl }))
      else setForm((prev) => ({ ...prev, imageUrl: publicUrl }))
      toast.success('Photo uploaded')
    } catch {
      toast.error('Photo upload failed')
    } finally {
      setUploadingId(null)
    }
  }

  const grouped = menuItems.reduce<Record<string, MenuItem[]>>((acc, item) => {
    ;(acc[item.category] = acc[item.category] ?? []).push(item)
    return acc
  }, {})

  const inputCls = 'w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40'
  const labelCls = 'block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5'

  if (loading) {
    return (
      <div className="p-6 max-w-[78rem] mx-auto animate-pulse">
        <div className="h-9 w-48 bg-white/10 rounded-lg mb-8" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-bg-card border border-white/5 rounded-2xl" />
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
    <div className="p-6 md:p-4 sm:p-3 max-w-[78rem] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight mb-1">
            Menu <span className="text-neon-pink">Manager</span>
          </h1>
          <p className="text-text-gray text-sm">
            {menuItems.length} items across {Object.keys(grouped).length} categories
          </p>
        </div>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="flex items-center gap-2 px-4 py-2.5 bg-neon-pink text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] transition-colors duration-200 cursor-pointer border-0 shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
        >
          <PlusIcon className="w-4 h-4" />
          Add Item
        </button>
      </div>

      {/* Add Item Form */}
      {showAddForm && (
        <div className="bg-bg-card border border-neon-pink/20 rounded-2xl p-6 mb-8 animate-fadeIn">
          <h3 className="font-bebas text-xl tracking-wide text-white mb-5">New Menu Item</h3>
          <form onSubmit={handleAddItem} className="grid grid-cols-2 md:grid-cols-1 gap-4">
            <div>
              <label className={labelCls}>Item Name *</label>
              <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g., Jerk Chicken Platter" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Category *</label>
              <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} className={inputCls}>
                {MENU_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Price (USD) *</label>
              <input required type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} placeholder="0.00" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Prep Time (minutes)</label>
              <input type="number" min="1" max="120" value={form.prepTime} onChange={(e) => setForm((p) => ({ ...p, prepTime: e.target.value }))} className={inputCls} />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className={labelCls}>Description</label>
              <textarea rows={2} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="What makes this item special…" className={`${inputCls} resize-none`} />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className={labelCls}>Photo</label>
              <div className="flex gap-3">
                <input value={form.imageUrl} onChange={(e) => setForm((p) => ({ ...p, imageUrl: e.target.value }))} placeholder="Paste image URL, or upload →" className={`flex-1 ${inputCls}`} />
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f, null, false) }} />
                <button type="button" disabled={uploadingId === 'new'} onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-3 py-2.5 bg-white/5 border border-white/10 text-white rounded-xl text-xs font-semibold hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50">
                  <PhotoIcon className="w-4 h-4" />
                  {uploadingId === 'new' ? '…' : 'Upload'}
                </button>
              </div>
            </div>
            <div className="col-span-2 md:col-span-1 flex gap-3 justify-end">
              <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2.5 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={addingItem} className="px-5 py-2.5 bg-neon-pink text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] transition-colors cursor-pointer border-0 shadow-[0_4px_12px_rgba(255,0,119,0.3)] disabled:opacity-50">
                {addingItem ? 'Adding…' : 'Add Item'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Item List by Category */}
      {menuItems.length === 0 ? (
        <div className="text-center py-20 bg-bg-card border border-white/10 rounded-2xl">
          <div className="text-[5rem] mb-4 opacity-20">🍽️</div>
          <h3 className="font-bebas text-[2rem] tracking-wide mb-2">No items yet</h3>
          <p className="text-text-gray text-sm">Add your first menu item to get started.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <h3 className="font-bebas text-lg tracking-wide text-text-gray mb-3">{category}</h3>
              <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden divide-y divide-white/5">
                {items.map((item) => {
                  const isEditing = editingId === item.id
                  const isDeleting = deletingId === item.id
                  const isToggling = togglingIds.has(item.id)

                  if (isEditing) {
                    return (
                      <div key={item.id} className="p-4 bg-neon-pink/5 border-l-2 border-neon-pink animate-fadeIn">
                        <div className="grid grid-cols-2 md:grid-cols-1 gap-3 mb-3">
                          <input value={editForm.name ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} placeholder="Name" className="bg-bg-dark border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-neon-pink transition-colors" />
                          <select value={editForm.category ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, category: e.target.value }))} className="bg-bg-dark border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-neon-pink transition-colors">
                            {MENU_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input type="number" min="0" step="0.01" value={editForm.price ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, price: e.target.value }))} placeholder="Price" className="bg-bg-dark border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-neon-pink transition-colors" />
                          <input type="number" min="1" max="120" value={editForm.prepTime ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, prepTime: e.target.value }))} placeholder="Prep time (min)" className="bg-bg-dark border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-neon-pink transition-colors" />
                          <div className="col-span-2 md:col-span-1 flex gap-2">
                            <input value={editForm.imageUrl ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, imageUrl: e.target.value }))} placeholder="Image URL" className="flex-1 bg-bg-dark border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40" />
                            <input ref={editFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f, item.id, true) }} />
                            <button type="button" disabled={uploadingId === item.id} onClick={() => editFileRef.current?.click()} className="px-3 py-2 bg-white/5 border border-white/10 text-white rounded-xl text-xs hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50">
                              <PhotoIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-xs font-semibold hover:bg-white/10 transition-colors cursor-pointer">
                            Cancel
                          </button>
                          <button onClick={() => handleSaveEdit(item)} className="px-3 py-1.5 bg-neon-pink text-white rounded-lg text-xs font-semibold hover:bg-[#e0006b] transition-colors cursor-pointer border-0">
                            Save
                          </button>
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div key={item.id} className="flex items-center gap-4 p-4 hover:bg-white/[0.02] transition-colors">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} className="w-12 h-12 rounded-xl object-cover shrink-0 bg-white/5" />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center shrink-0 text-xl">🍽️</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-white font-semibold text-sm">{item.name}</p>
                          {item.prepTime && (
                            <span className="flex items-center gap-1 text-text-gray text-[0.625rem] bg-white/5 px-1.5 py-0.5 rounded-md">
                              <ClockIcon className="w-3 h-3" />{item.prepTime}m
                            </span>
                          )}
                        </div>
                        <p className="text-neon-pink font-semibold text-sm">${item.price.toFixed(2)}</p>
                        {item.description && <p className="text-text-gray text-xs mt-0.5 truncate">{item.description}</p>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${item.isAvailable ? 'text-emerald-400' : 'text-red-400'}`}>
                            {item.isAvailable ? 'Available' : 'Sold out'}
                          </span>
                          <button
                            disabled={isToggling}
                            onClick={() => handleToggleAvailability(item)}
                            className={`relative w-9 h-5 rounded-full transition-colors duration-300 cursor-pointer border-0 shrink-0 disabled:opacity-50 ${item.isAvailable ? 'bg-emerald-500' : 'bg-white/20'}`}
                          >
                            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-300 ${item.isAvailable ? 'translate-x-4' : 'translate-x-0'}`} />
                          </button>
                        </div>
                        <button
                          onClick={() => { setEditingId(item.id); setEditForm({ name: item.name, description: item.description ?? '', price: String(item.price), prepTime: String(item.prepTime ?? 15), category: item.category, imageUrl: item.imageUrl ?? '' }) }}
                          className="p-1.5 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0"
                        >
                          <PencilIcon className="w-4 h-4 text-text-gray hover:text-white" />
                        </button>
                        <button
                          disabled={isDeleting}
                          onClick={() => handleDelete(item)}
                          className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer bg-transparent border-0 disabled:opacity-50"
                        >
                          <TrashIcon className="w-4 h-4 text-text-gray hover:text-red-400" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
