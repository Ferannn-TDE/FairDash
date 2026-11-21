'use client'

// PENDING MENU REQUESTS — admin side (audit H5, Step 2g).
//
// The organizer approves a fair's menu requests; a platform admin approves them ONLY when the fair
// has no organizer. The admin route answers 404 for a fair with an organizer, and this panel then
// renders nothing: there is nothing here for an admin to decide.

import { useEffect, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { formatPriceChange, type PriceChangeSummary } from '@/lib/menu/price-gate'

interface PendingMenuRequest {
  id: string
  type: 'ADD' | 'EDIT' | 'DELETE' | 'RESTORE'
  name: string | null
  price: number | null
  category: string | null
  currentItem: { name: string; price: number; removedAt: string | null } | null
  priceChange: PriceChangeSummary | null
  variantGroup: string | null
  variantLabel: string | null
  /** How many pending sizes deciding this row decides (H5 Fix B); null when not a size of a new item. */
  sizesInGroup: number | null
  /** F4: the live item this pending size is added to (decided on its own); null otherwise. */
  newSizeOf: string | null
  createdAt: string
  vendor: { id: string; name: string }
}

const TYPE_LABEL: Record<PendingMenuRequest['type'], string> = {
  ADD: 'New item',
  EDIT: 'Edit',
  DELETE: 'Remove',
  RESTORE: 'Restore',
}

export default function MenuRequestsPanel({ eventSlug }: { eventSlug: string }) {
  // null = not applicable (the fair has an organizer) or not loaded yet.
  const [requests, setRequests] = useState<PendingMenuRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch(`/api/admin/events/${eventSlug}/menu-requests`)
      .then(async r => {
        if (r.status === 404) return null
        const json = await r.json()
        if (!json.success) throw new Error(json.error?.message ?? 'Failed to load menu requests')
        return json.data.requests as PendingMenuRequest[]
      })
      .then(rows => { if (active) setRequests(rows) })
      .catch((e: Error) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [eventSlug])

  async function decide(id: string, action: 'APPROVE' | 'REJECT') {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/events/${eventSlug}/menu-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error?.message ?? 'Action failed'); return }
      // Deciding one size of a brand-new item decides all its pending sizes, so they all leave the
      // list. A new size of a live item (F4) is decided on its own, so only it leaves.
      setRequests(prev => {
        const decided = (prev ?? []).find(r => r.id === id)
        return (prev ?? []).filter(r => r.id !== id && !(decided?.type === 'ADD' && decided.variantGroup && !decided.newSizeOf
          && r.type === 'ADD' && r.vendor.id === decided.vendor.id && r.variantGroup === decided.variantGroup))
      })
    } catch {
      setError('Network error')
    } finally {
      setBusy(null)
    }
  }

  if (requests === null && !error) return null

  return (
    <div className="mb-6 bg-[#111111] border border-white/5 rounded-xl">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <ClipboardList className="w-4 h-4 text-[#888]" />
        <h2 className="text-sm font-inter font-semibold text-white">Pending menu requests</h2>
        <span className="text-xs text-[#666] font-inter">This fair has no organizer, so FairSynq decides these.</span>
      </div>
      {error && <p className="px-4 py-2 text-xs text-red-400 font-inter">{error}</p>}
      {requests && requests.length === 0 && (
        <p className="px-4 py-6 text-center text-sm text-[#555] font-inter">No pending menu requests.</p>
      )}
      {requests && requests.length > 0 && (
        <ul className="divide-y divide-white/5">
          {requests.map(r => (
            <li key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-inter text-white truncate">
                  <span className="text-[10px] uppercase font-semibold text-[#888] mr-2">{TYPE_LABEL[r.type]}</span>
                  {r.type === 'ADD' ? r.name : r.currentItem?.name ?? r.name ?? '—'}
                  {r.variantLabel && <span className="text-[#888]"> · Size: {r.variantLabel}</span>}
                </p>
                {r.sizesInGroup != null && r.sizesInGroup > 1 && (
                  <p className="text-[11px] text-amber-300/80 font-inter">
                    {r.sizesInGroup} sizes of {r.variantGroup} — approving or rejecting one decides all {r.sizesInGroup}
                  </p>
                )}
                {r.newSizeOf && (
                  <p className="text-[11px] text-amber-300/80 font-inter">New size of {r.newSizeOf}, which is already on the menu</p>
                )}
                <p className="text-xs text-[#666] font-inter truncate">
                  {r.vendor.name}
                  {r.type === 'ADD' && r.price !== null && ` · $${r.price.toFixed(2)}`}
                </p>
                {r.priceChange && r.priceChange.direction !== 'same' && (
                  <p className={`text-xs font-inter font-semibold mt-1 ${r.priceChange.direction === 'up' ? 'text-amber-300' : 'text-[#9a9a9a]'}`}>
                    Price {formatPriceChange(r.priceChange)}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  disabled={busy === r.id}
                  onClick={() => decide(r.id, 'APPROVE')}
                  className="px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                >
                  Approve
                </button>
                <button
                  disabled={busy === r.id}
                  onClick={() => decide(r.id, 'REJECT')}
                  className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white/80 text-xs font-semibold cursor-pointer"
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
