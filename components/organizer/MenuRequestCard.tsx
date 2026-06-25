'use client'

import { useState } from 'react'
import { CheckIcon, XMarkIcon, ArrowPathIcon, PhotoIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CurrentItem {
  id: string
  name: string
  description: string | null
  price: number
  category: string
  prepTime: number | null
  imageUrl: string | null
}

export interface MenuRequestCardData {
  id: string
  type: 'ADD' | 'EDIT' | 'DELETE'
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  name: string | null
  description: string | null
  price: number | null
  category: string | null
  prepTime: number | null
  imageUrl: string | null
  menuItemId: string | null
  currentItem: CurrentItem | null
  reviewNote: string | null
  createdAt: string
  vendor: { id: string; name: string }
}

const TYPE_CONFIG: Record<MenuRequestCardData['type'], { label: string; cls: string }> = {
  ADD:    { label: 'New Item', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-400/20' },
  EDIT:   { label: 'Edit',     cls: 'bg-blue-500/15   text-blue-400    border-blue-400/20'    },
  DELETE: { label: 'Remove',   cls: 'bg-red-500/15    text-red-400     border-red-400/20'     },
}

function timeAgo(isoDate: string): string {
  const secs = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000)
  if (secs < 60)    return `${secs}s ago`
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function DiffRow({ label, before, after }: { label: string; before: string; after: string }) {
  const changed = before !== after
  return (
    <div className="grid grid-cols-[5rem_1fr_1fr] gap-2 items-start text-xs">
      <span className="text-white/30 uppercase tracking-wider text-[0.6rem] font-semibold pt-0.5">{label}</span>
      <span className={changed ? 'text-white/40 line-through' : 'text-white/60'}>{before || '—'}</span>
      <span className={changed ? 'text-white font-semibold' : 'text-white/60'}>{after || '—'}</span>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface MenuRequestCardProps {
  req: MenuRequestCardData
  fairSlug: string
  onReviewed: (id: string, status: 'APPROVED' | 'REJECTED') => void
}

export function MenuRequestCard({ req, fairSlug, onReviewed }: MenuRequestCardProps) {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason]         = useState('')
  const [submitting, setSubmitting] = useState<'APPROVE' | 'REJECT' | null>(null)

  const cfg = TYPE_CONFIG[req.type]

  async function submit(action: 'APPROVE' | 'REJECT') {
    setSubmitting(action)
    try {
      const res = await fetch(
        `/api/organizer/fairs/${fairSlug}/menu-requests/${req.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, reason: reason || undefined }),
        }
      )
      const json = await res.json()
      if (json.success) {
        toast.success(action === 'APPROVE' ? 'Request approved — menu updated' : 'Request rejected')
        onReviewed(req.id, action === 'APPROVE' ? 'APPROVED' : 'REJECTED')
      } else {
        toast.error(json.error?.message ?? 'Action failed')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSubmitting(null)
      setRejectOpen(false)
    }
  }

  // Resolved state — dimmed
  if (req.status !== 'PENDING') {
    return (
      <div className="bg-[#111] border border-white/[0.05] rounded-xl px-4 py-3 flex items-center gap-3 opacity-50">
        <span className={`px-2 py-0.5 rounded-full text-[0.6rem] font-bold uppercase tracking-wider border shrink-0 ${cfg.cls}`}>
          {cfg.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-white/60 text-sm truncate">
            {req.type === 'ADD' ? req.name : req.currentItem?.name ?? '—'}
          </p>
          <p className="text-white/30 text-xs">{req.vendor.name}</p>
        </div>
        <span className={`text-xs font-semibold shrink-0 ${req.status === 'APPROVED' ? 'text-emerald-400' : 'text-red-400'}`}>
          {req.status === 'APPROVED' ? 'Approved' : 'Rejected'}
        </span>
      </div>
    )
  }

  return (
    <div className="bg-[#111] border border-white/[0.07] rounded-xl overflow-hidden hover:border-white/[0.12] transition-colors">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`px-2 py-0.5 rounded-full text-[0.6rem] font-bold uppercase tracking-wider border shrink-0 ${cfg.cls}`}>
          {cfg.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold font-inter truncate">{req.vendor.name}</p>
          <p className="text-white/30 text-[0.6875rem] font-inter">{timeAgo(req.createdAt)}</p>
        </div>
      </div>

      <div className="px-4 pb-4 space-y-3">
        {/* ADD */}
        {req.type === 'ADD' && (
          <div className="flex gap-3">
            {req.imageUrl ? (
              <img src={req.imageUrl} alt="" className="w-14 h-14 object-cover rounded-lg border border-white/10 shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <PhotoIcon className="w-5 h-5 text-white/20" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-semibold font-inter">{req.name}</p>
              {req.price !== null && (
                <p className="text-neon-pink text-sm font-inter font-semibold">${req.price.toFixed(2)}</p>
              )}
              <p className="text-white/40 text-xs font-inter mt-0.5">
                {[req.category, req.prepTime != null ? `${req.prepTime}m prep` : null].filter(Boolean).join(' · ')}
              </p>
              {req.description && (
                <p className="text-white/40 text-xs font-inter mt-1 line-clamp-2">{req.description}</p>
              )}
            </div>
          </div>
        )}

        {/* EDIT — before/after diff */}
        {req.type === 'EDIT' && req.currentItem && (
          <div className="space-y-1.5 bg-white/[0.025] rounded-lg p-3">
            <div className="grid grid-cols-[5rem_1fr_1fr] gap-2 mb-2">
              <span />
              <span className="text-[0.6rem] uppercase tracking-wider text-white/25 font-semibold">Before</span>
              <span className="text-[0.6rem] uppercase tracking-wider text-white/50 font-semibold">After</span>
            </div>
            {req.name       !== null && <DiffRow label="Name"     before={req.currentItem.name}                              after={req.name} />}
            {req.price      !== null && <DiffRow label="Price"    before={`$${req.currentItem.price.toFixed(2)}`}             after={`$${req.price.toFixed(2)}`} />}
            {req.category   !== null && <DiffRow label="Category" before={req.currentItem.category}                          after={req.category} />}
            {req.prepTime   !== null && <DiffRow label="Prep"     before={req.currentItem.prepTime != null ? `${req.currentItem.prepTime}m` : '—'} after={`${req.prepTime}m`} />}
            {req.description !== null && <DiffRow label="Desc"    before={req.currentItem.description ?? '—'}                after={req.description} />}
          </div>
        )}

        {/* DELETE */}
        {req.type === 'DELETE' && req.currentItem && (
          <div className="flex gap-3 bg-red-500/5 border border-red-500/10 rounded-lg p-3">
            {req.currentItem.imageUrl ? (
              <img src={req.currentItem.imageUrl} alt="" className="w-12 h-12 object-cover rounded-md border border-white/10 shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-md bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <PhotoIcon className="w-4 h-4 text-white/20" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-white/80 text-sm font-inter font-semibold">{req.currentItem.name}</p>
              <p className="text-white/40 text-xs font-inter">${req.currentItem.price.toFixed(2)} · {req.currentItem.category}</p>
              <p className="text-red-400/60 text-[0.6875rem] font-inter mt-1">Will be marked unavailable</p>
            </div>
          </div>
        )}

        {/* Reject reason */}
        {rejectOpen && (
          <div>
            <label className="block text-[0.6rem] uppercase tracking-wider text-white/30 font-semibold mb-1">
              Reason (optional)
            </label>
            <input
              autoFocus
              value={reason}
              onChange={e => setReason(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit('REJECT') }}
              placeholder="e.g. Image required, price out of range…"
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-inter outline-none focus:border-neon-pink transition-colors"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-0.5">
          <button
            disabled={!!submitting}
            onClick={() => submit('APPROVE')}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
          >
            {submitting === 'APPROVE'
              ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
              : <CheckIcon className="w-3.5 h-3.5" />}
            Approve
          </button>
          {rejectOpen ? (
            <>
              <button
                disabled={!!submitting}
                onClick={() => submit('REJECT')}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                {submitting === 'REJECT'
                  ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                  : <XMarkIcon className="w-3.5 h-3.5" />}
                Confirm
              </button>
              <button
                onClick={() => { setRejectOpen(false); setReason('') }}
                className="px-3 py-2 text-white/40 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              disabled={!!submitting}
              onClick={() => setRejectOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 text-white/70 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              <XMarkIcon className="w-3.5 h-3.5" />
              Reject
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
