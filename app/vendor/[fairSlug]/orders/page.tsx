'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  ChevronDown, ChevronUp, Clock, User, Phone,
  ShoppingBag, Car, MapPin, CheckCircle, XCircle,
  Package, ArrowUpDown,
} from 'lucide-react'
import { useVendorMeta } from '@/lib/contexts/VendorContext'
import { StatusPill } from '@/components/ui/StatusPill'
import { EarningsBadge } from '@/app/_components/EarningsBadge'
import { getStatusMeta, TAB_STATUS_MAP } from '@/lib/order-status'
import { formatDeliveryAddress, toDeliveryAddress as addr } from '@/lib/delivery-address'

// ─── Types ──────────────────────────────────────────────────────────────────

type OrderStatus = 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED' | string

interface OrderItem {
  itemName: string
  quantity: number
  unitPrice: number
}

interface Order {
  id: string
  status: OrderStatus
  fulfillmentType: 'BOOTH_PICKUP' | 'CURBSIDE' | 'HOME_DELIVERY' | string
  customerName: string
  customerPhone?: string | null
  total: number
  subtotal: number
  vendorSubtotal: number
  earnings: number
  earningsStatus: import('@/app/_components/EarningsBadge').EarningsStatus
  orderItems: OrderItem[]
  placedAt: string
  estimatedReadyAt?: string | null
  vehicleColor?: string | null
  vehicleMake?: string | null
  vehiclePlate?: string | null
  deliveryStreet?: string | null
  deliveryCity?: string | null
}

// ─── Constants ──────────────────────────────────────────────────────────────

const FULFILLMENT_LABEL: Record<string, string> = {
  BOOTH_PICKUP: 'Booth Pickup',
  CURBSIDE: 'Curbside',
  HOME_DELIVERY: 'Home Delivery',
}

const FILTER_TABS = [
  { value: 'all',       label: 'All' },
  { value: 'PLACED',    label: 'Incoming' },
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'READY',     label: 'Ready' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const

// ─── Sub-components ─────────────────────────────────────────────────────────

function FulfillmentIcon({ type }: { type: string }) {
  if (type === 'CURBSIDE') return <Car className="w-3.5 h-3.5" />
  if (type === 'HOME_DELIVERY') return <MapPin className="w-3.5 h-3.5" />
  return <ShoppingBag className="w-3.5 h-3.5" />
}

function OrderCard({ order }: { order: Order }) {
  const [expanded, setExpanded] = useState(false)
  const placedTime = new Date(order.placedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const shortId = '#' + order.id.slice(-8).toUpperCase()
  // One summary string, truncated by CSS (ellipsis) rather than sheared mid-word by a
  // too-narrow flex cell — which is what turned "1× Item" into the broken-looking "1× I".
  // The full text stays available via the title attribute and the expanded panel.
  const itemSummary = order.orderItems.map(i => `${i.quantity}× ${i.itemName}`).join(', ')

  return (
    <div className={`border border-white/10 rounded-2xl overflow-hidden transition-all duration-200 ${
      order.status === 'PLACED' ? 'border-neon-pink/30 bg-neon-pink/[0.03]' : 'bg-bg-card'
    }`}>
      {/* THE ROW IS A GRID, NOT A FLEX BOX.
          It used to be a flex row with TWO `flex-1` cells, so content length decided
          x-positions: a long item name shoved the amount left, a wide status badge ("Order
          Placed" vs "Declined") shoved the customer info right, and nothing lined up from
          row to row. Fixed column tracks are what make a list scannable — a vendor can run
          their eye down the amount column and compare, or down the status column and see a
          pattern, only if those columns actually ARE columns.

          Tracks (lg+):  [id + time] [status] [customer] [items] [amount] [chevron]
                           7rem       8.5rem   9rem      1fr      6.5rem   1rem
          The status track is FIXED WIDTH so a wide badge can never push its siblings.
          Flexible cells carry min-w-0 + truncate, or a long value would blow the track out
          instead of ellipsing. Narrower screens collapse to [content][amount][chevron]. */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full grid items-center gap-x-4 gap-y-1 p-4 sm:p-5 hover:bg-white/[0.02] transition-colors text-left cursor-pointer
                   grid-cols-[minmax(0,1fr)_auto_1rem]
                   lg:grid-cols-[7rem_8.5rem_9rem_minmax(0,1fr)_6.5rem_1rem]"
      >
        {/* 1 — order id + time. On small screens this cell carries everything. */}
        <div className="min-w-0">
          <span className="block font-bold text-white text-sm tabular-nums truncate">{shortId}</span>
          <span className="flex items-center gap-1 text-xs text-text-gray mt-0.5">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="tabular-nums">{placedTime}</span>
          </span>

          {/* Below lg the dedicated tracks are hidden, so fold their content in here —
              same information, still truncating rather than wrapping into ragged rows. */}
          <div className="lg:hidden mt-1.5 flex flex-col gap-1">
            <StatusPill status={order.status} />
            <span className="flex items-center gap-1 text-xs text-text-gray min-w-0">
              <User className="w-3 h-3 shrink-0" />
              <span className="truncate">{order.customerName}</span>
            </span>
            <span className="flex items-center gap-1 text-xs text-text-gray/70 min-w-0">
              <FulfillmentIcon type={order.fulfillmentType} />
              <span className="truncate">{itemSummary}</span>
            </span>
          </div>
        </div>

        {/* 2 — status. FIXED track: badges vary in width, so anchor them here rather than
               letting "Order Placed" push everything after it. */}
        <div className="hidden lg:flex min-w-0">
          <StatusPill status={order.status} />
        </div>

        {/* 3 — customer + fulfillment */}
        <div className="hidden lg:block min-w-0">
          <span className="flex items-center gap-1 text-xs text-white/80 min-w-0">
            <User className="w-3 h-3 shrink-0" />
            <span className="truncate">{order.customerName}</span>
          </span>
          <span className="flex items-center gap-1 text-xs text-text-gray mt-0.5 min-w-0">
            <FulfillmentIcon type={order.fulfillmentType} />
            <span className="truncate">{FULFILLMENT_LABEL[order.fulfillmentType] ?? order.fulfillmentType}</span>
          </span>
        </div>

        {/* 4 — items. Truncates with an ellipsis instead of shearing a name to one letter. */}
        <div className="hidden lg:block min-w-0">
          <p className="text-white/60 text-xs truncate" title={itemSummary}>{itemSummary}</p>
        </div>

        {/* 5 — amount. One shape for every state, right-aligned, tabular figures so the
               decimal points line up down the column. */}
        <div className="justify-self-end">
          <EarningsBadge amount={order.earnings} status={order.earningsStatus} variant="stacked" />
        </div>

        {/* 6 — chevron */}
        <div className="justify-self-end text-text-gray">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/10 p-4 sm:p-5 space-y-4">
          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-2">Items</p>
            <div className="space-y-1.5">
              {order.orderItems.map((item, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm text-white">
                    <span className="text-neon-pink font-semibold">{item.quantity}×</span>{' '}
                    {item.itemName}
                  </span>
                  <span className="text-sm text-text-gray">${(item.unitPrice * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 pt-2 border-t border-white/5 space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-text-gray">Your Items Subtotal</span>
                <span className="text-xs text-white">${(order.vendorSubtotal ?? order.subtotal ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-text-gray">Your Take-Home</span>
                <EarningsBadge amount={order.earnings} status={order.earningsStatus} />
              </div>
            </div>
          </div>

          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-2">Customer</p>
            <div className="flex flex-wrap gap-4">
              <span className="flex items-center gap-1.5 text-sm text-white">
                <User className="w-3.5 h-3.5 text-text-gray" />
                {order.customerName}
              </span>
              {order.customerPhone && (
                <span className="flex items-center gap-1.5 text-sm text-white">
                  <Phone className="w-3.5 h-3.5 text-text-gray" />
                  {order.customerPhone}
                </span>
              )}
            </div>
          </div>

          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-2">Fulfillment</p>
            <div className="flex items-start gap-2">
              <FulfillmentIcon type={order.fulfillmentType} />
              <div className="text-sm text-white space-y-0.5">
                <p className="font-semibold">{FULFILLMENT_LABEL[order.fulfillmentType] ?? order.fulfillmentType}</p>
                {order.fulfillmentType === 'CURBSIDE' && (
                  <p className="text-text-gray text-xs">
                    {order.vehicleColor} {order.vehicleMake}{order.vehiclePlate ? ` · ${order.vehiclePlate}` : ''}
                  </p>
                )}
                {order.fulfillmentType === 'HOME_DELIVERY' && (
                  <p className="text-text-gray text-xs">{formatDeliveryAddress(addr(order))}</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/[0.03] rounded-xl p-3">
              <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">Placed</p>
              <p className="text-sm text-white">{placedTime}</p>
            </div>
            {order.estimatedReadyAt && (
              <div className="bg-white/[0.03] rounded-xl p-3">
                <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-0.5">Est. Ready</p>
                <p className="text-sm text-white">
                  {new Date(order.estimatedReadyAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            )}
          </div>

          {(() => {
            const meta = getStatusMeta(order.status)
            const Icon = meta.iconType === 'check' ? CheckCircle : meta.iconType === 'x' ? XCircle : Package
            return (
              <div className="flex items-center gap-2">
                <Icon className={`w-4 h-4 ${meta.color}`} />
                <span className="text-xs text-text-gray">{meta.label}</span>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

export default function VendorOrdersPage() {
  const { vendorId } = useVendorMeta()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [sortNewest, setSortNewest] = useState(true)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})

  // FILTERING AND SORTING ARE SERVER-SIDE. They used to be done in the browser over
  // whatever the first (capped) fetch returned — which meant the tab counts lied ("3
  // cancelled" meant "3 among your last 50 orders") and everything past the 50th order was
  // unreachable. Paginating a client-side filter would have given "page 2 of everything"
  // wearing the Cancelled tab's label.
  //
  // The fetch key is (filter, sort). Any change to it is a NEW query from page 1 — the
  // cursor is dropped and the list is REPLACED, never appended. Otherwise you land on page
  // 5 of a 2-page filter, or mix Cancelled rows into Completed.
  useEffect(() => {
    if (!vendorId) return
    let cancelled = false
    setLoading(true)
    setNextCursor(null)

    const qs = new URLSearchParams({
      tab: filter,
      sort: sortNewest ? 'newest' : 'oldest',
      take: String(PAGE_SIZE),
      withCounts: '1',
    })
    fetch(`/api/vendors/${vendorId}/orders/history?${qs}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled || !json.success) return
        setOrders(json.data?.orders ?? [])          // REPLACE — this is page 1
        setNextCursor(json.data?.nextCursor ?? null)
        if (json.data?.counts) setCounts(json.data.counts)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true } // a stale response must never overwrite a newer filter
  }, [vendorId, filter, sortNewest])

  // Next page of the CURRENT (filter, sort). Appends. The cursor is the last row's id, and
  // the server's stable sort (placedAt + id) makes "the row after this one" deterministic.
  const loadMore = useCallback(async () => {
    if (!vendorId || !nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const qs = new URLSearchParams({
        tab: filter,
        sort: sortNewest ? 'newest' : 'oldest',
        take: String(PAGE_SIZE),
        cursor: nextCursor,
      })
      const json = await (await fetch(`/api/vendors/${vendorId}/orders/history?${qs}`)).json()
      if (json.success) {
        setOrders(prev => [...prev, ...(json.data?.orders ?? [])])
        setNextCursor(json.data?.nextCursor ?? null)
      }
    } catch { /* leave the cursor intact so the user can retry */ }
    finally { setLoadingMore(false) }
  }, [vendorId, nextCursor, filter, sortNewest, loadingMore])

  // Rows are already filtered AND sorted by the server. Re-filtering here would silently
  // re-introduce the client-side bug; re-sorting would only sort the pages fetched so far.
  const filtered = orders
  const tabCounts = counts

  return (
    <div className="p-6 md:p-4 sm:p-3 max-w-[56rem] mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight">
            Order <span className="text-neon-pink">History</span>
          </h1>
          <p className="text-text-gray text-sm mt-0.5">
            {/* The TRUE total for the active filter (counted server-side across all
                history), not the number of rows fetched so far. */}
            {loading
              ? 'Loading…'
              : (() => {
                  const total = tabCounts[filter] ?? orders.length
                  const shown = orders.length
                  return total > shown
                    ? `Showing ${shown} of ${total} order${total !== 1 ? 's' : ''}`
                    : `${total} order${total !== 1 ? 's' : ''} total`
                })()}
          </p>
        </div>
        <button
          onClick={() => setSortNewest(v => !v)}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-semibold text-text-gray hover:text-white hover:border-white/20 transition-all duration-200 cursor-pointer"
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
          {sortNewest ? 'Newest First' : 'Oldest First'}
        </button>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-6">
        {FILTER_TABS.map(tab => {
          const count = tabCounts[tab.value as keyof typeof tabCounts] ?? 0
          const isActive = filter === tab.value
          return (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-3.5 py-1.5 rounded-full text-[0.6875rem] font-semibold border transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'bg-neon-pink border-neon-pink text-white'
                  : 'bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white'
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 text-[0.625rem] ${isActive ? 'text-white/70' : 'text-white/30'}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-bg-card border border-white/10 rounded-2xl py-16 text-center">
          <Package className="w-10 h-10 text-white/10 mx-auto mb-3" />
          <p className="text-white font-semibold text-sm mb-1">No orders found</p>
          <p className="text-text-gray text-xs">No orders match the selected filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(order => (
            <OrderCard key={order.id} order={order} />
          ))}

          {/* Cursor pagination. `nextCursor` is null once the server has no further rows
              for THIS filter, so the button disappears exactly when the list is complete. */}
          {nextCursor && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full py-3 rounded-2xl bg-white/5 border border-white/10 text-text-gray text-xs font-semibold hover:text-white hover:border-white/20 transition-colors cursor-pointer disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : `Load ${PAGE_SIZE} more`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
