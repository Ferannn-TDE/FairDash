'use client'

import { useState, useEffect, use } from 'react'
import { CheckIcon, XMarkIcon, ClockIcon, QueueListIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { mockOrganizerFairs } from '@/lib/mock/organizer'

interface MenuRequest {
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
  reviewNote: string | null
  createdAt: string
  menuItem: { name: string } | null
  vendor: { name: string }
}

const TYPE_BADGE: Record<MenuRequest['type'], { label: string; cls: string }> = {
  ADD:    { label: 'Add',    cls: 'bg-emerald-500/15 text-emerald-400' },
  EDIT:   { label: 'Edit',   cls: 'bg-blue-500/15 text-blue-400' },
  DELETE: { label: 'Delete', cls: 'bg-red-500/15 text-red-400' },
}

function RequestCard({ req, onReview }: { req: MenuRequest; onReview: (id: string, status: 'APPROVED' | 'REJECTED', note: string) => void }) {
  const [note, setNote] = useState('')
  const [expanded, setExpanded] = useState(false)
  const badge = TYPE_BADGE[req.type]

  const title = req.type === 'ADD'
    ? req.name ?? '—'
    : req.type === 'EDIT'
    ? `Edit: ${req.menuItem?.name ?? req.menuItemId}`
    : `Remove: ${req.menuItem?.name ?? req.menuItemId}`

  return (
    <div className="bg-[#111] border border-white/[0.06] rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`px-2 py-0.5 rounded-full text-[0.6rem] font-bold uppercase tracking-wider shrink-0 ${badge.cls}`}>{badge.label}</span>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold truncate">{title}</p>
          <p className="text-[#555] text-xs mt-0.5">{req.vendor.name} · {new Date(req.createdAt).toLocaleDateString()}</p>
        </div>
        {req.status === 'PENDING' ? (
          <button onClick={() => setExpanded(v => !v)} className="text-[#555] hover:text-white text-xs font-semibold transition-colors cursor-pointer">
            {expanded ? 'Collapse' : 'Review'}
          </button>
        ) : (
          <span className={`text-xs font-semibold ${req.status === 'APPROVED' ? 'text-emerald-400' : 'text-red-400'}`}>{req.status}</span>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-white/[0.06] pt-3 space-y-3">
          {/* Proposed changes */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            {req.name        && <div><p className="text-[#555] uppercase tracking-wider text-[0.6rem]">Name</p><p className="text-white">{req.name}</p></div>}
            {req.price       !== null && <div><p className="text-[#555] uppercase tracking-wider text-[0.6rem]">Price</p><p className="text-white">${req.price?.toFixed(2)}</p></div>}
            {req.category    && <div><p className="text-[#555] uppercase tracking-wider text-[0.6rem]">Category</p><p className="text-white">{req.category}</p></div>}
            {req.prepTime    !== null && <div><p className="text-[#555] uppercase tracking-wider text-[0.6rem]">Prep</p><p className="text-white">{req.prepTime}m</p></div>}
            {req.description && <div className="col-span-2 sm:col-span-3"><p className="text-[#555] uppercase tracking-wider text-[0.6rem]">Description</p><p className="text-white">{req.description}</p></div>}
          </div>
          {req.imageUrl && (
            <img src={req.imageUrl} alt="" className="w-20 h-20 object-cover rounded-lg border border-white/10" />
          )}
          <div>
            <label className="block text-[0.6rem] uppercase tracking-wider text-[#555] font-semibold mb-1">Review Note (optional)</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Reason for rejection, etc."
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-neon-pink transition-colors"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { onReview(req.id, 'APPROVED', note); setExpanded(false) }}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              <CheckIcon className="w-3.5 h-3.5" /> Approve
            </button>
            <button
              onClick={() => { onReview(req.id, 'REJECTED', note); setExpanded(false) }}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              <XMarkIcon className="w-3.5 h-3.5" /> Reject
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function MenuRequestsPage({ params }: { params: Promise<{ fairId: string }> }) {
  const { fairId } = use(params)
  const fair = mockOrganizerFairs.find(f => f.id === fairId) ?? mockOrganizerFairs[0]
  const [requests, setRequests] = useState<MenuRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING')

  useEffect(() => {
    fetch(`/api/menu-requests?eventId=${fair.id}`)
      .then(r => r.json())
      .then(json => { if (json.success) setRequests(json.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [fair.id])

  async function handleReview(id: string, status: 'APPROVED' | 'REJECTED', reviewNote: string) {
    try {
      const res = await fetch(`/api/menu-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reviewNote }),
      })
      const json = await res.json()
      if (json.success) {
        setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r))
        toast.success(`Request ${status.toLowerCase()}`)
      } else {
        toast.error(json.error?.message ?? 'Failed to review request')
      }
    } catch {
      toast.error('Failed to review request')
    }
  }

  const filtered = filter === 'PENDING' ? requests.filter(r => r.status === 'PENDING') : requests
  const pendingCount = requests.filter(r => r.status === 'PENDING').length

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">Menu Requests</h1>
          <p className="text-[#555] text-sm font-inter mt-0.5">{fair.name}</p>
        </div>
        <div className="flex gap-1 bg-[#111] border border-white/5 rounded-lg p-1">
          {(['PENDING', 'ALL'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${filter === f ? 'bg-white/10 text-white' : 'text-[#555] hover:text-[#888]'}`}
            >
              {f === 'PENDING' ? `Pending${pendingCount > 0 ? ` (${pendingCount})` : ''}` : 'All'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-white/5 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#111111] border border-white/5 rounded-xl p-12 text-center">
          <QueueListIcon className="w-8 h-8 mx-auto mb-3 text-[#333]" />
          <p className="text-[#555] font-inter text-sm">
            {filter === 'PENDING' ? 'No pending requests.' : 'No requests yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(req => (
            <RequestCard key={req.id} req={req} onReview={handleReview} />
          ))}
        </div>
      )}
    </div>
  )
}
