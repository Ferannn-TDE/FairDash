'use client'

import { useState, useMemo, useEffect, useRef, use, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, ChevronDown, ChevronUp, Package, User, Store, Clock, ArrowUpDown } from 'lucide-react'
import { STRAND_THRESHOLDS_MS } from '@/lib/constants'
import AnimatedPagination from '@/app/_components/ui/AnimatedPagination'

// ─── Types (the real /api/admin/events/[id]/orders shape) ─

type AdminOrderStatus =
  | 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'RUNNER_COLLECTED'
  | 'COMPLETED' | 'DELIVERED' | 'CANCELLED' | 'UNCOLLECTED' | 'UNDELIVERABLE'
  | 'REFUNDED'

interface AdminOrderItem { id?: string; name: string; quantity: number }

interface AdminOrder {
  id: string
  status: AdminOrderStatus
  fulfillmentType: string
  customerName: string
  vendorName: string
  total: number
  placedAt: string
  items: AdminOrderItem[]
  cancellationReason?: string | null
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PLACED:           { label: 'New',           cls: 'bg-neon-pink/10 text-neon-pink border-neon-pink/20' },
  ACCEPTED:         { label: 'Accepted',      cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  PREPARING:        { label: 'Preparing',     cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  READY:            { label: 'Ready',         cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  RUNNER_COLLECTED: { label: 'En Route',      cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  COMPLETED:        { label: 'Completed',     cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  DELIVERED:        { label: 'Delivered',     cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  CANCELLED:        { label: 'Cancelled',     cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  UNCOLLECTED:      { label: 'Uncollected',   cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
  UNDELIVERABLE:    { label: 'Undeliverable', cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
  REFUNDED:         { label: 'Refunded',      cls: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
}

const FULFILLMENT_LABEL: Record<string, string> = {
  BOOTH_PICKUP:  'Booth Pickup',
  CURBSIDE:      'Curbside',
  HOME_DELIVERY: 'Home Delivery',
}

/**
 * The "this looks stuck" threshold. Read from the SAME constant the reconciler's strand clocks
 * use (lib/constants) — not a second number invented for this page, which would drift from the
 * one that actually flags orders. This surface only COLOURS a number; timers flag, humans decide
 * (PROJECT_INVARIANTS), so nothing here acts on an order.
 */
const STUCK_AFTER_MS = STRAND_THRESHOLDS_MS.claimedNotCollected

/** Whole minutes since an order was placed — "stuck" without the arithmetic. */
function minutesSince(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60_000))
}

function formatAge(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  return h < 24 ? `${h}h ${mins % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}

/**
 * Day bucket for grouping. An order's placedAt is an INSTANT, so it groups by the VIEWER's
 * local day — the day the person reading the log lived through. (Fair start/end dates are the
 * other kind and render zone-fixed via lib/event-date; see that module for why they differ.)
 */
function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabel(iso: string, nowMs: number): string {
  const d = new Date(iso)
  if (dayKey(iso) === dayKey(new Date(nowMs).toISOString())) return 'Today'
  if (dayKey(iso) === dayKey(new Date(nowMs - 86_400_000).toISOString())) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Tab VALUES mirror lib/fair-orders TAB_STATUSES — the server owns the status→tab mapping and
// returns a count per tab, so nothing is re-derived here. No "refunded" tab: REFUNDED is not a
// master OrderStatus (a refund is a Refund row; the order stays CANCELLED/COMPLETED), so that
// tab was always empty. "Issues" is the fair-day question it replaces.
const FILTER_TABS = [
  { value: 'all',       label: 'All' },
  { value: 'active',    label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'issues',    label: 'Issues' },
] as const

/**
 * Rows per page — the SINGLE source for both the fetch `take` and the totalPages divisor.
 *
 * Write those two separately and the pager lies: the take decides how many rows a page HOLDS,
 * the divisor decides what "N of M" CLAIMS about it, and any gap between them is an indicator
 * confidently describing a page shape that doesn't exist. One constant makes that unexpressible.
 *
 * Deliberately NOT shared with the vendor order-history list (25) — these are different surfaces
 * with different densities, and coupling them would mean one can't be tuned without moving the
 * other. lib/fair-orders clamps take to 100 and defaults to 50; this sits inside that.
 */
const ADMIN_ORDERS_PAGE_SIZE = 50

const ACTIVE_STATUSES = new Set(['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED'])

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AdminOrderStatus }) {
  const meta = STATUS_META[status] ?? { label: status, cls: 'bg-white/10 text-text-gray border-white/20' }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[0.6875rem] font-semibold border ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

function OrderRow({ order, nowMs }: { order: AdminOrder; nowMs: number }) {
  const [expanded, setExpanded] = useState(false)
  const placedTime = new Date(order.placedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  // Age is shown for ACTIVE orders only: on a finished order the number answers nothing, and a
  // 6-day-old completed row glowing amber would train the eye to ignore the colour that matters.
  const isActive = ACTIVE_STATUSES.has(order.status)
  const ageMins = isActive ? minutesSince(order.placedAt, nowMs) : null
  const stuck = ageMins !== null && ageMins * 60_000 >= STUCK_AFTER_MS

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden bg-bg-card">
      {/* THE ROW IS A GRID, NOT A FLEX BOX — the same fix the vendor order card carries, for the
          same reason. It was a flex row whose cells were sized by their CONTENT: `flex-1` on the
          left group, `shrink-0` on the right cluster, and no truncation anywhere. So "CB" and
          "RANDY'S HOUSE OF BBQ" put the following columns at different x-positions, and the age
          badge — which only renders for ACTIVE orders — shifted the amount on some rows and not
          others. Nothing lined up, which is exactly what a log is scanned for: an admin runs
          their eye down the amount column to compare, or down the status column to see a
          pattern, and can only do that if those columns actually ARE columns.

          Tracks (lg+):  [id] [status] [fulfil] [customer] [vendor] [time] [age] [amount] [chev]
                        5.5rem  7rem    6rem      1fr        1fr    4.5rem 4rem  5.25rem  1rem
          The status track is FIXED at the width of the longest label ("Undeliverable") so a wide
          badge can never push its neighbours. Name tracks are the only flexible ones and carry
          min-w-0 + truncate, so a long value ellipses INSIDE its track instead of widening it —
          that truncation is what makes every row identical, and the title attribute is where the
          full value went.

          Below lg the nine tracks cannot fit, so they fold into the first cell as stacked,
          truncating lines — uniform for the same reason, just vertically. Hidden cells are
          display:none and leave the grid entirely, so the remaining items land in tracks 1-4 by
          DOM order without a second template. Under sm the fold keeps today's visibility rules
          exactly: id + status + age + amount + chevron, nothing else. */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full grid items-center gap-x-3 gap-y-1 px-4 py-3.5 hover:bg-white/[0.02] transition-colors text-left cursor-pointer
                   grid-cols-[minmax(0,1fr)_auto_auto_1rem]
                   lg:grid-cols-[5.5rem_7rem_6rem_minmax(0,1fr)_minmax(0,1fr)_4.5rem_4rem_5.25rem_1rem]"
      >
        {/* 1 — order id. Below lg this cell also carries everything the narrow layout folds in. */}
        <div className="min-w-0">
          <span className="block font-bold text-white text-sm tabular-nums truncate">
            #{order.id.slice(-8).toUpperCase()}
          </span>

          <div className="lg:hidden mt-1.5 flex flex-col gap-1">
            {/* The wrapper carries self-start because this parent is a flex COLUMN, whose cross
                axis is WIDTH — align-items defaults to stretch, which would smear the pill
                across the whole cell as a slab. It wraps rather than taking a className so
                StatusBadge's own styles stay untouched. */}
            <span className="self-start">
              <StatusBadge status={order.status} />
            </span>
            <span className="hidden sm:inline text-xs text-text-gray truncate">
              {FULFILLMENT_LABEL[order.fulfillmentType] ?? order.fulfillmentType}
            </span>
            <span className="hidden sm:flex items-center gap-1 text-xs text-text-gray min-w-0" title={order.customerName}>
              <User className="w-3 h-3 shrink-0" />
              <span className="truncate">{order.customerName}</span>
            </span>
            <span className="hidden sm:flex items-center gap-1 text-xs text-text-gray min-w-0" title={order.vendorName}>
              <Store className="w-3 h-3 shrink-0" />
              <span className="truncate">{order.vendorName}</span>
            </span>
            <span className="hidden sm:flex items-center gap-1 text-xs text-text-gray">
              <Clock className="w-3 h-3 shrink-0" />
              <span className="tabular-nums">{placedTime}</span>
            </span>
          </div>
        </div>

        {/* 2 — status. Fixed track: badge labels vary from "New" to "Undeliverable". */}
        <div className="hidden lg:flex min-w-0">
          <StatusBadge status={order.status} />
        </div>

        {/* 3 — fulfillment */}
        <span className="hidden lg:block text-xs text-text-gray truncate">
          {FULFILLMENT_LABEL[order.fulfillmentType] ?? order.fulfillmentType}
        </span>

        {/* 4 — customer. Left-aligned: right-aligning a truncated name would leave the column
               ragged on its left edge and harder to scan, not easier. */}
        <span className="hidden lg:flex items-center gap-1 text-xs text-text-gray min-w-0" title={order.customerName}>
          <User className="w-3 h-3 shrink-0" />
          <span className="truncate">{order.customerName}</span>
        </span>

        {/* 5 — vendor */}
        <span className="hidden lg:flex items-center gap-1 text-xs text-text-gray min-w-0" title={order.vendorName}>
          <Store className="w-3 h-3 shrink-0" />
          <span className="truncate">{order.vendorName}</span>
        </span>

        {/* 6 — placed time */}
        <span className="hidden lg:flex items-center gap-1 text-xs text-text-gray">
          <Clock className="w-3 h-3 shrink-0" />
          <span className="tabular-nums">{placedTime}</span>
        </span>

        {/* 7 — age. The cell is ALWAYS rendered, badge or not: it only appears on ACTIVE orders,
               and a conditional TRACK would slide the amount left on finished rows — one of the
               two things that made this list look mis-aligned. */}
        <span className="flex justify-end">
          {ageMins !== null && (
            <span
              title={`Placed ${formatAge(ageMins)} ago`}
              className={`tabular-nums text-xs font-semibold px-2 py-0.5 rounded-md whitespace-nowrap ${
                stuck ? 'bg-orange-500/15 text-orange-300' : 'bg-white/5 text-text-gray'
              }`}
            >
              {formatAge(ageMins)}
            </span>
          )}
        </span>

        {/* 8 — amount. Right-aligned + tabular so the $ figures form one clean edge to read down. */}
        <span className="font-bold text-neon-pink text-sm tabular-nums text-right whitespace-nowrap">
          ${(order.total ?? 0).toFixed(2)}
        </span>

        {/* 9 — expand chevron */}
        {expanded
          ? <ChevronUp className="w-4 h-4 text-text-gray" />
          : <ChevronDown className="w-4 h-4 text-text-gray" />}
      </button>

      {expanded && (
        <div className="border-t border-white/10 p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">Customer</p>
              <p className="text-white">{order.customerName}</p>
            </div>
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">Vendor</p>
              <p className="text-white">{order.vendorName}</p>
            </div>
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">Placed</p>
              <p className="text-white">{placedTime}</p>
            </div>
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">Fulfillment</p>
              <p className="text-white">{FULFILLMENT_LABEL[order.fulfillmentType] ?? order.fulfillmentType}</p>
            </div>
          </div>

          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-2">Items</p>
            <div className="space-y-1">
              {order.items.map((item, i) => (
                <p key={item.id ?? i} className="text-sm text-white">
                  <span className="text-neon-pink font-semibold">{item.quantity}×</span> {item.name}
                </p>
              ))}
            </div>
          </div>

          {order.cancellationReason && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <p className="text-[0.6875rem] uppercase tracking-wide text-red-400 font-semibold mb-0.5">Reason</p>
              <p className="text-sm text-white">{order.cancellationReason}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

interface VendorOption { id: string; name: string }

export default function AdminOrdersPage({ params: paramsPromise }: { params: Promise<{ eventSlug: string }> }) {
  const params = use(paramsPromise)
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [total, setTotal] = useState(0)
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({})
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [paging, setPaging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // CURSOR STACK — the cursors walked to REACH the page on screen; page 1 is the empty stack,
  // cursorStack[i] is the cursor that fetched page i+2. Same pattern as vendor order history,
  // for the same reason: lib/fair-orders is cursor-paginated with a placedAt+id stable sort, and
  // a cursor only walks forward, so remembering the ones we used is what makes Previous possible
  // without an offset rewrite. Pushed/popped ONLY after a fetch succeeds — the page number is
  // derived from its length, so moving it on click could caption page 2's rows "3 of 6".
  const [cursorStack, setCursorStack] = useState<string[]>([])
  const [pageDir, setPageDir] = useState<1 | -1>(1)
  const listTopRef = useRef<HTMLDivElement>(null)
  // Which filter/search/sort combination the rows on screen belong to. The page-1 effect drops
  // its own stale responses with an `active` flag; a page fetch needs the same protection,
  // because the FILTERS stay live while a page is loading.
  const fetchKeyRef = useRef('')
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([])
  // Distinguishes "no vendors yet" from "not loaded" — without it the select renders as if the
  // fair had no vendors, then snaps wider when they arrive (the flicker class: a
  // plausible-but-wrong intermediate). Width is reserved either way so nothing shifts.
  const [vendorsLoaded, setVendorsLoaded] = useState(false)

  // ── Filter state lives in the URL, and DRIVES THE SERVER QUERY ───────────────
  // Every filter is whole-event: the server searches and filters all orders, not the loaded
  // page. A fair-day view ("Randy's, delivery, active") survives a refresh, can be kept open in
  // a tab, and can be sent to someone else — one copy of the state, in the address bar.
  const router = useRouter()
  const sp = useSearchParams()
  const filter     = sp.get('tab') ?? 'all'
  const urlSearch  = sp.get('q') ?? ''
  const vendorFilt = sp.get('vendor') ?? 'all'   // holds a vendorId
  const fulfilFilt = sp.get('type') ?? 'all'
  const sortNewest = sp.get('sort') !== 'oldest'

  const setParam = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || v === 'all') next.delete(k)
      else next.set(k, v)
    }
    const qs = next.toString()
    router.replace(qs ? `?${qs}` : '?', { scroll: false })
  }, [router, sp])

  // Search input is debounced before it becomes a URL param (and thus a server query): a
  // keystroke updates the box immediately, the fetch waits 350ms so typing doesn't hammer the DB.
  const [searchInput, setSearchInput] = useState(urlSearch)
  useEffect(() => { setSearchInput(urlSearch) }, [urlSearch])
  useEffect(() => {
    if (searchInput === urlSearch) return
    const t = setTimeout(() => setParam({ q: searchInput }), 350)
    return () => clearTimeout(t)
  }, [searchInput, urlSearch, setParam])

  // One clock for every age in the list, ticking each minute.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Whole-event vendor list for the filter — fetched once, so the dropdown offers every vendor,
  // not only those with an order on the loaded page.
  useEffect(() => {
    let active = true
    fetch(`/api/admin/events/${params.eventSlug}/vendors?take=200`)
      .then(r => r.json())
      .then(json => { if (active && json.success) setVendorOptions(((json.data.vendors ?? []) as VendorOption[]).map(v => ({ id: v.id, name: v.name }))) })
      .catch(() => { /* dropdown stays at "All vendors"; the loaded flag still flips below */ })
      .finally(() => { if (active) setVendorsLoaded(true) })
    return () => { active = false }
  }, [params.eventSlug])

  const buildUrl = useCallback((cursor?: string) => {
    const qp = new URLSearchParams({ take: String(ADMIN_ORDERS_PAGE_SIZE), tab: filter, sort: sortNewest ? 'newest' : 'oldest' })
    if (urlSearch)             qp.set('q', urlSearch)
    if (vendorFilt !== 'all')  qp.set('vendorId', vendorFilt)
    if (fulfilFilt !== 'all')  qp.set('type', fulfilFilt)
    if (cursor)                qp.set('cursor', cursor)
    return `/api/admin/events/${params.eventSlug}/orders?${qp.toString()}`
  }, [params.eventSlug, filter, urlSearch, vendorFilt, fulfilFilt, sortNewest])

  // First page — refetched whenever any server-scoped filter changes.
  useEffect(() => {
    let active = true
    fetchKeyRef.current = buildUrl()  // any page fetch keyed to an older URL is stale
    setLoading(true)
    setError(null)
    setCursorStack([])   // filters changed → back to page 1; old cursors address another query
    setPageDir(1)
    fetch(buildUrl())
      .then((r) => r.json())
      .then((json) => {
        if (!active) return
        if (!json.success) { setError(json.error?.message ?? 'Failed to load orders'); return }
        setOrders((json.data.orders ?? []) as AdminOrder[])
        setTotal(json.data.total ?? 0)
        setTabCounts(json.data.meta?.tabCounts ?? {})
        setNextCursor(json.data.nextCursor ?? null)
      })
      .catch(() => { if (active) setError('Failed to load orders') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [buildUrl])

  /** Apply a fetched page, THEN move the stack. REPLACES the rows — one page at a time. */
  const applyPage = useCallback((
    json: { success?: boolean; data?: { orders?: AdminOrder[]; nextCursor?: string | null; total?: number } },
    nextStack: string[],
    dir: 1 | -1,
    key: string,
  ) => {
    // A filter moved while this page was in flight — this response describes a query nobody is
    // looking at any more.
    if (fetchKeyRef.current !== key) return
    if (!json?.success) return
    setOrders((json.data?.orders ?? []) as AdminOrder[])
    setNextCursor(json.data?.nextCursor ?? null)
    setCursorStack(nextStack)
    setPageDir(dir)
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const goNext = useCallback(async () => {
    if (!nextCursor || paging) return
    setPaging(true)
    try {
      // Captured before the await: nextCursor is about to be replaced by the response, and this
      // is the value that belongs on the stack.
      const used = nextCursor
      const key = buildUrl()
      applyPage(await (await fetch(buildUrl(used))).json(), [...cursorStack, used], 1, key)
    } catch { /* stack untouched — the indicator still describes the rows on screen */ }
    finally { setPaging(false) }
  }, [nextCursor, paging, cursorStack, buildUrl, applyPage])

  const goPrev = useCallback(async () => {
    if (cursorStack.length === 0 || paging) return
    setPaging(true)
    try {
      // The page before this one was fetched with the cursor one below the top of the stack —
      // or with no cursor at all, which is page 1.
      const nextStack = cursorStack.slice(0, -1)
      const key = buildUrl()
      const prevCursor = nextStack[nextStack.length - 1]
      applyPage(await (await fetch(buildUrl(prevCursor))).json(), nextStack, -1, key)
    } catch { /* stack untouched */ }
    finally { setPaging(false) }
  }, [cursorStack, paging, buildUrl, applyPage])

  // DERIVED, never mirrored: the page IS the depth of the stack that fetched it.
  const page = cursorStack.length + 1
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_ORDERS_PAGE_SIZE))

  const hasActiveFilter = filter !== 'all' || fulfilFilt !== 'all' || vendorFilt !== 'all' || Boolean(urlSearch)

  // Day buckets over the LOADED rows (server already applied filter/search/sort). Grouping and
  // the age badge are the only client-side transforms left, and both are presentational.
  const grouped = useMemo(() => {
    const out: { key: string; label: string; orders: AdminOrder[] }[] = []
    for (const o of orders) {
      const k = dayKey(o.placedAt)
      const last = out[out.length - 1]
      if (last && last.key === k) last.orders.push(o)
      else out.push({ key: k, label: dayLabel(o.placedAt, nowMs), orders: [o] })
    }
    return out
  }, [orders, nowMs])

  return (
    <div ref={listTopRef} className="p-6 md:p-4 sm:p-3 max-w-[64rem] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight">
            Order <span className="text-neon-pink">Log</span>
          </h1>
          <p className="text-text-gray text-sm mt-0.5">
            {/* The whole-event total for the CURRENT filter+search. It no longer says "showing
                N of" — with one page on screen that number described the accumulation, and
                position now lives in the pager. */}
            {loading
              ? 'Loading…'
              : `${total} order${total === 1 ? '' : 's'}${hasActiveFilter ? ' match' : ''}`}
          </p>
        </div>
        <button
          onClick={() => setParam({ sort: sortNewest ? 'oldest' : null })}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-semibold text-text-gray hover:text-white transition-all cursor-pointer"
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
          {sortNewest ? 'Newest First' : 'Oldest First'}
        </button>
      </div>

      {/* Search — whole-event, server-side. Debounced. */}
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-gray" />
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search order code (e.g. 26685PS7), customer, or vendor — searches the whole fair"
          className="w-full bg-bg-card border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/50"
        />
      </div>

      {/* Filter tabs — counts are whole-event (server), scoped to the current search/vendor/type */}
      <div className="flex gap-1.5 flex-wrap mb-5">
        {FILTER_TABS.map((tab) => {
          const count = tabCounts[tab.value] ?? 0
          const isActive = filter === tab.value
          return (
            <button
              key={tab.value}
              onClick={() => setParam({ tab: tab.value })}
              className={`px-3.5 py-1.5 rounded-full text-[0.6875rem] font-semibold border transition-all cursor-pointer ${
                isActive
                  ? 'bg-neon-pink border-neon-pink text-white'
                  : 'bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white'
              }`}
            >
              {tab.label}
              {!loading && <span className={`ml-1.5 text-[0.625rem] ${isActive ? 'text-white/70' : 'text-white/30'}`}>{count}</span>}
            </button>
          )
        })}
      </div>

      {/* Vendor + fulfillment filters — server-side, whole-event. */}
      <div className="flex gap-2 flex-wrap mb-5">
        {vendorsLoaded ? (
          <select
            value={vendorFilt}
            onChange={(e) => setParam({ vendor: e.target.value })}
            className="w-44 bg-bg-card border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-neon-pink transition-colors cursor-pointer"
          >
            <option value="all">All vendors</option>
            {vendorOptions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        ) : (
          // Same footprint as the real control, so the row does not reflow when options land.
          <div className="w-44 h-[34px] rounded-xl bg-white/5 border border-white/10 animate-pulse" aria-hidden />
        )}
        <select
          value={fulfilFilt}
          onChange={(e) => setParam({ type: e.target.value })}
          className="w-44 bg-bg-card border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-neon-pink transition-colors cursor-pointer"
        >
          <option value="all">All fulfillment</option>
          {Object.entries(FULFILLMENT_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {hasActiveFilter && (
          <button
            onClick={() => setParam({ vendor: null, type: null, tab: null, q: null })}
            className="px-3 py-2 rounded-xl text-xs font-semibold text-text-gray hover:text-white bg-white/5 border border-white/10 transition-colors cursor-pointer"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Order list */}
      {error ? (
        <div className="bg-bg-card border border-red-500/20 rounded-2xl py-16 text-center">
          <Package className="w-10 h-10 text-red-400/40 mx-auto mb-3" />
          <p className="text-white font-semibold text-sm mb-1">Couldn’t load orders</p>
          <p className="text-text-gray text-xs">{error}</p>
        </div>
      ) : loading ? (
        <div className="bg-bg-card border border-white/10 rounded-2xl py-16 text-center">
          <Package className="w-10 h-10 text-white/10 mx-auto mb-3 animate-pulse" />
          <p className="text-text-gray text-xs">Loading orders…</p>
        </div>
      ) : orders.length === 0 ? (
        // The search/filter ran over the WHOLE event, so empty is a real answer, not "not loaded".
        <div className="bg-bg-card border border-white/10 rounded-2xl py-16 text-center">
          <Package className="w-10 h-10 text-white/10 mx-auto mb-3" />
          {urlSearch ? (
            <>
              <p className="text-white font-semibold text-sm mb-1">No order matches “{urlSearch}”</p>
              <p className="text-text-gray text-xs">Searched every order in this fair — code, customer, and vendor.</p>
            </>
          ) : hasActiveFilter ? (
            <>
              <p className="text-white font-semibold text-sm mb-1">No orders match these filters</p>
              <p className="text-text-gray text-xs">No order in the fair fits this combination.</p>
            </>
          ) : (
            <>
              <p className="text-white font-semibold text-sm mb-1">No orders yet</p>
              <p className="text-text-gray text-xs">Orders will appear here as customers check out.</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Grouped by day with a sticky header: over an 8-day fair a bare "18:02" does not
              say WHICH day, and scrolling loses the answer. */}
          {grouped.map((group) => (
            <div key={group.key}>
              <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-[#0a0a0a]/95 backdrop-blur-sm flex items-baseline gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70 font-inter">{group.label}</h2>
                <span className="text-[0.625rem] text-text-gray tabular-nums">
                  {group.orders.length} order{group.orders.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="space-y-2.5 mt-1">
                {group.orders.map((order) => (
                  <OrderRow key={order.id} order={order} nowMs={nowMs} />
                ))}
              </div>
            </div>
          ))}

          {/* Cursor-stack pagination.
              • hasNext is the SERVER's answer (nextCursor is null once this query has no further
                rows — the reader only claims another page when this one came back full), never a
                page-number comparison.
              • hasPrev is the stack, so page 1 is disabled by construction.
              • page and totalPages are both derived — the stack that fetched these rows, and the
                server-counted total for the CURRENT filter+search (lib/fair-orders counts the same
                where-clause as the list). Neither is a click counter.
              Hidden at one page: a pager over a single page is furniture. */}
          {totalPages > 1 && (
            <AnimatedPagination
              page={page}
              totalPages={totalPages}
              hasPrev={cursorStack.length > 0}
              hasNext={nextCursor !== null}
              onPrev={goPrev}
              onNext={goNext}
              busy={paging}
              direction={pageDir}
            />
          )}
        </div>
      )}
    </div>
  )
}
