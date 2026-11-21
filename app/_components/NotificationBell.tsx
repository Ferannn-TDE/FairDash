'use client'

// NOTIFICATION BELL: the real bell in the admin and organizer portals (audit H5, step 3c).
// Reads the signed-in person's own notifications from GET /api/notifications/feed and marks them
// read with PATCH. Refreshes every 60 seconds while the tab is visible, and when the tab comes back.
// Links are followed only when lib/notification-link.ts says they stay on this site.
// A failed load never breaks the page: no dot, and the panel says so.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BellIcon } from '@heroicons/react/24/outline'
import { safeBellLink } from '@/lib/notification-link'

const FEED_URL = '/api/notifications/feed'
const PAGE_SIZE = 20
const POLL_MS = 60_000

type FeedItem = {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  readAt: string | null
  createdAt: string
}
type FeedPage = { items: FeedItem[]; unreadCount: number; nextBefore: string | null }

async function fetchPage(before?: string): Promise<FeedPage> {
  const qs = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (before) qs.set('before', before)
  const res = await fetch(`${FEED_URL}?${qs}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`feed ${res.status}`)
  const json = await res.json() as { success?: boolean; data?: FeedPage }
  if (!json.success || !json.data) throw new Error('feed: bad response')
  return json.data
}

async function markRead(body: { ids: string[] } | { all: true }): Promise<number> {
  const res = await fetch(FEED_URL, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`mark read ${res.status}`)
  const json = await res.json() as { success?: boolean; data?: { unreadCount: number } }
  if (!json.success || !json.data) throw new Error('mark read: bad response')
  return json.data.unreadCount
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d} d ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * align: which edge of the button the panel lines up with. "right" for a header bell at the right
 * of the screen; "left" for a bell in the left sidebar, so the panel opens over the page.
 */
export default function NotificationBell({ align = 'right' }: { align?: 'left' | 'right' }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<FeedItem[]>([])
  const [unread, setUnread] = useState(0)
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<FeedItem[]>([])
  useEffect(() => { itemsRef.current = items }, [items])

  // The newest page. Rows already loaded by "Load more" that are older than this page are kept,
  // and so is the "Load more" position after them.
  const refresh = useCallback(async () => {
    try {
      const page = await fetchPage()
      const pageIds = new Set(page.items.map(i => i.id))
      const oldest = page.items[page.items.length - 1]
      const older = oldest
        ? itemsRef.current.filter(p => !pageIds.has(p.id) && (p.createdAt < oldest.createdAt || (p.createdAt === oldest.createdAt && p.id < oldest.id)))
        : []
      setItems([...page.items, ...older])
      if (older.length === 0) setNextBefore(page.nextBefore)
      setUnread(page.unreadCount)
      setFailed(false)
      setLoaded(true)
    } catch {
      setFailed(true)
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [refresh])

  // Close on Escape or a click outside.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) void refresh()
  }

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(nextBefore)
      setItems(prev => {
        const have = new Set(prev.map(p => p.id))
        return [...prev, ...page.items.filter(i => !have.has(i.id))]
      })
      setNextBefore(page.nextBefore)
      setUnread(page.unreadCount)
    } catch {
      setFailed(true)
    } finally {
      setLoadingMore(false)
    }
  }

  const markAll = async () => {
    try {
      const count = await markRead({ all: true })
      const now = new Date().toISOString()
      setItems(prev => prev.map(i => (i.readAt ? i : { ...i, readAt: now })))
      setUnread(count)
    } catch {
      setFailed(true)
    }
  }

  const openItem = async (item: FeedItem) => {
    if (!item.readAt) {
      try {
        const count = await markRead({ ids: [item.id] })
        const now = new Date().toISOString()
        setItems(prev => prev.map(i => (i.id === item.id ? { ...i, readAt: now } : i)))
        setUnread(count)
      } catch {
        setFailed(true)
      }
    }
    const href = safeBellLink(item.link)
    if (href) {
      setOpen(false)
      router.push(href)
    }
  }

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
  const badge = unread > 9 ? '9+' : String(unread)

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative p-2 rounded-lg hover:bg-white/5 transition-colors"
      >
        <BellIcon className="w-5 h-5 text-[#888]" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF0077] text-white text-[10px] font-semibold leading-[18px] text-center">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-[70vh] flex flex-col bg-[#111111] border border-white/10 rounded-xl shadow-2xl z-[60] overflow-hidden`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <span className="text-sm font-semibold text-white">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="text-xs text-[#FF0077] hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="overflow-y-auto">
            {failed && (
              <p className="px-4 py-3 text-xs text-[#ff6b6b]">Couldn&apos;t load notifications.</p>
            )}
            {loaded && !failed && items.length === 0 && (
              <p className="px-4 py-6 text-sm text-[#888] text-center">No notifications yet</p>
            )}
            {!loaded && (
              <p className="px-4 py-6 text-sm text-[#888] text-center">Loading…</p>
            )}
            <ul>
              {items.map(item => {
                const hasLink = safeBellLink(item.link) !== null
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void openItem(item)}
                      className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${item.readAt ? '' : 'bg-[#FF0077]/5'}`}
                    >
                      <div className="flex items-start gap-2">
                        {!item.readAt && <span className="mt-1.5 w-2 h-2 rounded-full bg-[#FF0077] shrink-0" aria-hidden="true" />}
                        <div className="min-w-0">
                          <p className={`text-sm ${item.readAt ? 'text-[#aaa]' : 'text-white font-medium'}`}>{item.title}</p>
                          <p className="text-xs text-[#888] mt-0.5 whitespace-pre-line break-words">{item.body}</p>
                          <p className="text-[11px] text-[#666] mt-1">
                            {timeAgo(item.createdAt)}
                            {!item.readAt && <span className="sr-only"> (unread)</span>}
                            {hasLink && <span className="text-[#FF0077]"> · Open</span>}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
            {nextBefore && (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="w-full py-3 text-xs text-[#888] hover:text-white disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
