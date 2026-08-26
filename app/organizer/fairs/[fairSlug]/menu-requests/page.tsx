'use client'

import { useState, useEffect, useRef, use, useCallback } from 'react'
import {
  CheckIcon,
  XMarkIcon,
  QueueListIcon,
  ArrowPathIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface CurrentItem {
  id: string
  name: string
  description: string | null
  price: number
  category: string
  prepTime: number | null
  imageUrl: string | null
}

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
  currentItem: CurrentItem | null
  reviewNote: string | null
  createdAt: string
  vendor: { id: string; name: string }
}

// ── Type badge ────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<MenuRequest['type'], { label: string; cls: string }> = {
  ADD:    { label: 'New Item',  cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-400/20' },
  EDIT:   { label: 'Edit',      cls: 'bg-blue-500/15   text-blue-400    border-blue-400/20'    },
  DELETE: { label: 'Remove',    cls: 'bg-red-500/15    text-red-400     border-red-400/20'     },
}

function timeAgo(isoDate: string): string {
  const secs = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000)
  if (secs < 60)   return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

// ── Diff row ──────────────────────────────────────────────────────────────────

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

// ── Request card ──────────────────────────────────────────────────────────────

function RequestCard({
  req,
  fairSlug,
  onReviewed,
}: {
  req: MenuRequest
  fairSlug: string
  onReviewed: (id: string, status: 'APPROVED' | 'REJECTED') => void
}) {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')
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

  // Resolved state
  if (req.status !== 'PENDING') {
    return (
      <div className="bg-[#111] border border-white/[0.05] rounded-xl px-4 py-3 flex items-center gap-3 opacity-50">
        <span className={`px-2 py-0.5 rounded-full text-[0.6rem] font-bold uppercase tracking-wider border shrink-0 ${cfg.cls}`}>{cfg.label}</span>
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
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`px-2 py-0.5 rounded-full text-[0.6rem] font-bold uppercase tracking-wider border shrink-0 ${cfg.cls}`}>
          {cfg.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold font-inter truncate">
            {req.vendor.name}
          </p>
          <p className="text-white/30 text-[0.6875rem] font-inter">{timeAgo(req.createdAt)}</p>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 pb-4 space-y-3">

        {/* ADD — show proposed item */}
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
                {[req.category, req.prepTime != null ? `${req.prepTime}m prep` : null]
                  .filter(Boolean).join(' · ')}
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
            {req.name       !== null && <DiffRow label="Name"     before={req.currentItem.name}              after={req.name} />}
            {req.price      !== null && <DiffRow label="Price"    before={`$${req.currentItem.price.toFixed(2)}`} after={`$${req.price.toFixed(2)}`} />}
            {req.category   !== null && <DiffRow label="Category" before={req.currentItem.category}          after={req.category} />}
            {req.prepTime   !== null && <DiffRow label="Prep"     before={req.currentItem.prepTime != null ? `${req.currentItem.prepTime}m` : '—'} after={`${req.prepTime}m`} />}
            {req.description !== null && <DiffRow label="Desc"    before={req.currentItem.description ?? '—'} after={req.description} />}
            {req.imageUrl   !== null && req.imageUrl !== req.currentItem.imageUrl && (
              <div className="grid grid-cols-[5rem_1fr_1fr] gap-2 items-center mt-2">
                <span className="text-white/30 uppercase tracking-wider text-[0.6rem] font-semibold">Image</span>
                {req.currentItem.imageUrl
                  ? <img src={req.currentItem.imageUrl} alt="before" className="w-10 h-10 object-cover rounded border border-white/10" />
                  : <span className="text-white/30 text-xs">—</span>}
                {req.imageUrl
                  ? <img src={req.imageUrl} alt="after" className="w-10 h-10 object-cover rounded border border-white/10" />
                  : <span className="text-white/30 text-xs">—</span>}
              </div>
            )}
          </div>
        )}

        {/* DELETE — show what will be removed */}
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
              <p className="text-red-400/60 text-[0.6875rem] font-inter mt-1">This item will be marked unavailable</p>
            </div>
          </div>
        )}

        {/* Reject reason input */}
        {rejectOpen && (
          <div>
            <label className="block text-[0.6rem] uppercase tracking-wider text-white/30 font-semibold mb-1">
              Reason for rejection (optional)
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

        {/* Action buttons */}
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
                Confirm Reject
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

// ── Page ──────────────────────────────────────────────────────────────────────

type TabFilter = 'PENDING' | 'ALL'

/** The API route's default take. One constant so the fetch and "Load more" cannot drift. */
const MENU_REQUESTS_PAGE_SIZE = 50
/** The API route's hard cap (it clamps take to 100) — a window refresh cannot ask for more. */
const MENU_REQUESTS_MAX_TAKE = 100
const POLL_INTERVAL_MS = 30_000

/**
 * A background refresh re-reads the window that is ALREADY on screen. It must update the rows
 * it covers and drop nothing: rows the organizer pulled in with "Load more" sit past the
 * refreshed window and are kept verbatim. Menu requests are never deleted server-side — only
 * their status moves — so "absent from this response" means "outside this window", never
 * "gone", and keeping the row is the honest read.
 *
 * The list is FIFO (createdAt asc), so anything genuinely new belongs at the tail.
 */
function mergeRequests(prev: MenuRequest[], fresh: MenuRequest[]): MenuRequest[] {
  if (prev.length === 0) return fresh
  const freshById = new Map(fresh.map(r => [r.id, r]))
  const merged = prev.map(r => freshById.get(r.id) ?? r)
  const known = new Set(prev.map(r => r.id))
  for (const r of fresh) if (!known.has(r.id)) merged.push(r)
  return merged
}

export default function MenuRequestsPage({ params }: { params: Promise<{ fairSlug: string }> }) {
  const { fairSlug } = use(params)

  const [requests, setRequests] = useState<MenuRequest[]>([])
  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter]     = useState<TabFilter>('PENDING')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  // Holds the in-flight request so the 30s poll cannot stack a second one on top.
  const inFlightRef = useRef<AbortController | null>(null)
  // How many rows are on screen — the size of the window a refresh must re-read. Mirrored in a
  // ref so the poll can read it without re-creating the interval on every list change, and
  // written in an effect, never during render (scripts/flicker-class-guard.ts [G]).
  const loadedCountRef = useRef(0)
  useEffect(() => { loadedCountRef.current = requests.length }, [requests])

  /**
   * silent = a BACKGROUND refresh: the list stays on screen and only the header icon spins.
   * The old signature was `replace = true`, which the poll called with no argument — so every
   * tick raised the full-page skeleton and reset the list to page 1, discarding "Load more".
   * Same silent/refreshing + AbortController idiom as the fair dashboard (../page.tsx).
   */
  const fetchRequests = useCallback(async (silent = false) => {
    // IN-FLIGHT GUARD — a timer tick must never queue behind a request that is still running;
    // a user-initiated load supersedes its predecessor rather than being dropped.
    if (inFlightRef.current) {
      if (silent) return
      inFlightRef.current.abort()
    }
    const controller = new AbortController()
    inFlightRef.current = controller

    if (!silent) setLoading(true)
    else setRefreshing(true)

    // Re-read the window ON SCREEN, not page 1 — rows pulled in with "Load more" must survive
    // a tick. Both reads happen before the await, so they describe the list as it is now.
    const take = Math.min(
      Math.max(loadedCountRef.current, MENU_REQUESTS_PAGE_SIZE),
      MENU_REQUESTS_MAX_TAKE,
    )
    const isFirstFill = loadedCountRef.current === 0

    try {
      const res = await fetch(
        `/api/organizer/fairs/${fairSlug}/menu-requests?take=${take}`,
        { signal: controller.signal },
      )
      const json = await res.json()
      if (!json.data?.requests) return
      setRequests(prev => mergeRequests(prev, json.data.requests))
      // nextCursor marks where the ORGANIZER's pagination stopped. Only the first fill and
      // loadMore may move it; a refresh over already-loaded rows has nothing to say about
      // what comes after them.
      if (isFirstFill) setNextCursor(json.data.nextCursor ?? null)
    } catch {
      // aborted or offline — the next tick retries. (An aborted request lands here by design.)
    } finally {
      // Only the CURRENT request clears the slot AND the indicators: an aborted predecessor
      // must not release the guard out from under its replacement, nor switch off the spinner
      // its replacement just switched on. The same check means a request that resolves after
      // unmount (the cleanup nulls the slot) sets no state at all.
      if (inFlightRef.current === controller) {
        inFlightRef.current = null
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [fairSlug])

  useEffect(() => { void fetchRequests(false) }, [fetchRequests])

  // 30s background poll. Silent — the list never blinks; at most the header icon spins.
  useEffect(() => {
    const id = setInterval(() => { void fetchRequests(true) }, POLL_INTERVAL_MS)
    return () => {
      clearInterval(id)
      // Navigating away must not leave a request running against a dead page.
      inFlightRef.current?.abort()
      inFlightRef.current = null
    }
  }, [fetchRequests])

  function handleReviewed(id: string, status: 'APPROVED' | 'REJECTED') {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r))
  }

  function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    fetch(`/api/organizer/fairs/${fairSlug}/menu-requests?take=${MENU_REQUESTS_PAGE_SIZE}&cursor=${nextCursor}`)
      .then(r => r.json())
      .then(json => {
        if (json.data?.requests) {
          // Through the same merge: a poll that landed mid-flight may already hold some of
          // these rows, and appending blind would show them twice.
          setRequests(prev => mergeRequests(prev, json.data.requests))
          setNextCursor(json.data.nextCursor ?? null)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false))
  }

  const filtered = filter === 'PENDING'
    ? requests.filter(r => r.status === 'PENDING')
    : requests

  const pendingCount = requests.filter(r => r.status === 'PENDING').length

  const TABS: { key: TabFilter; label: string }[] = [
    { key: 'PENDING', label: pendingCount > 0 ? `Pending (${pendingCount})` : 'Pending' },
    { key: 'ALL',     label: 'All Requests' },
  ]

  return (
    <div className="p-6 md:p-4 max-w-[52rem] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.25rem)] tracking-wide text-white leading-tight">
            Menu <span className="text-neon-pink">Approval Queue</span>
          </h1>
          <p className="text-white/30 text-sm font-inter mt-0.5">
            Review vendor menu change requests — changes go live immediately on approval
          </p>
        </div>
        <button
          onClick={() => { void fetchRequests(true) }}
          disabled={refreshing}
          className="shrink-0 p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-40 transition-colors cursor-pointer"
          title="Refresh"
        >
          <ArrowPathIcon className={`w-4 h-4 text-white/50 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Pending count banner */}
      {pendingCount > 0 && filter !== 'PENDING' && (
        <button
          onClick={() => setFilter('PENDING')}
          className="w-full mb-5 px-4 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400 text-sm font-semibold font-inter text-left hover:bg-amber-500/15 transition-colors cursor-pointer"
        >
          {pendingCount} pending request{pendingCount !== 1 ? 's' : ''} waiting for review →
        </button>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 bg-[#111] border border-white/5 rounded-lg p-1 mb-5 w-fit">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold font-inter transition-colors cursor-pointer ${
              filter === tab.key
                ? 'bg-white/10 text-white'
                : 'text-white/30 hover:text-white/60'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-[4.5rem] bg-white/[0.04] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#111] border border-white/[0.05] rounded-xl p-14 text-center">
          <QueueListIcon className="w-8 h-8 mx-auto mb-3 text-white/10" />
          <p className="text-white/25 font-inter text-sm">
            {filter === 'PENDING' ? 'No pending requests — queue is clear.' : 'No requests yet.'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {filtered.map(req => (
              <RequestCard
                key={req.id}
                req={req}
                fairSlug={fairSlug}
                onReviewed={handleReviewed}
              />
            ))}
          </div>

          {nextCursor && filter === 'ALL' && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-5 w-full py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 text-white/50 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
