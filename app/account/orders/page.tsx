'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import MarketplaceNavbar from '../../_components/MarketplaceNavbar'

import type { OrderDTO } from '@/types/order-dto'

type Order = OrderDTO

interface FairGroup {
  fairId: string
  fairName: string
  fairSlug: string
  fairColor: string
  orders: Order[]
}

const STATUS_COLORS: Record<string, string> = {
  PLACED:        'bg-yellow-500/15 text-yellow-400',
  ACCEPTED:      'bg-blue-500/15 text-blue-400',
  PREPARING:     'bg-orange-500/15 text-orange-400',
  READY:         'bg-purple-500/15 text-purple-400',
  COMPLETED:     'bg-emerald-500/15 text-emerald-400',
  CANCELLED:     'bg-red-500/15 text-red-400',
  UNCOLLECTED:   'bg-red-500/15 text-red-400',
  UNDELIVERABLE: 'bg-red-500/15 text-red-400',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[status] ?? 'bg-white/10 text-white/40'}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}

function vendorSummary(order: Order): string {
  const names = [...new Set(order.items.map(i => i.vendorName).filter(Boolean) as string[])]
  if (names.length === 0) return order.vendor?.name ?? 'Unknown'
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names[0]} +${names.length - 1} more`
}

function OrderRow({ order, fairSlug }: { order: Order; fairSlug: string }) {
  const shortId = order.id.slice(-8).toUpperCase()
  const itemSummary = order.items
    .map((i) => `${i.itemName} ×${i.quantity}`)
    .join(', ')

  const total = order.total ?? order.subtotal ?? 0
  const href = fairSlug
    ? `/fair/${fairSlug}/order/${shortId}`
    : `/fair/unknown/order/${shortId}`

  return (
    <Link
      href={href}
      className="flex items-center justify-between p-4 bg-[#1a1a1a] border border-white/[0.07] rounded-xl hover:bg-[#222] transition-colors group"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-white font-bold text-sm font-mono tracking-tight">
            #{shortId}
          </span>
          <StatusBadge status={order.status} />
        </div>
        <p className="text-white/50 text-xs truncate">{vendorSummary(order)}</p>
        {itemSummary && (
          <p className="text-white/30 text-xs truncate mt-0.5">{itemSummary}</p>
        )}
      </div>
      <div className="text-right shrink-0 ml-4">
        <p className="text-neon-pink font-bold text-sm">${(total ?? 0).toFixed(2)}</p>
        <p className="text-white/30 text-xs">
          {new Date(order.placedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </p>
      </div>
      <ChevronRightIcon className="w-4 h-4 text-white/20 group-hover:text-white/40 ml-3 shrink-0 transition-colors" />
    </Link>
  )
}

export default function AccountOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/orders/history?limit=50')
      .then((r) => r.json())
      .then((json) => { if (json.success) setOrders(json.data.orders ?? []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Group by fair, preserving insertion order (already sorted by placedAt desc)
  const fairGroups: FairGroup[] = []
  const seen = new Map<string, FairGroup>()
  for (const order of orders) {
    const fairId = order.vendor?.event?.id ?? 'unknown'
    if (!seen.has(fairId)) {
      const group: FairGroup = {
        fairId,
        fairName: order.vendor?.event?.name ?? 'Unknown Fair',
        fairSlug: order.vendor?.event?.urlSlug ?? '',
        fairColor: order.vendor?.event?.primaryColor ?? '#FF0077',
        orders: [],
      }
      seen.set(fairId, group)
      fairGroups.push(group)
    }
    seen.get(fairId)!.orders.push(order)
  }

  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">
        <div className="max-w-3xl mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-12">

          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-xs text-white/40 mb-6">
            <Link href="/" className="hover:text-white/70 transition-colors">Home</Link>
            <ChevronRightIcon className="w-3 h-3 text-white/20 shrink-0" />
            <Link href="/account" className="hover:text-white/70 transition-colors">Account</Link>
            <ChevronRightIcon className="w-3 h-3 text-white/20 shrink-0" />
            <span className="text-white/70 font-medium">Order History</span>
          </nav>

          <h1 className="font-bebas text-5xl text-white tracking-wide mb-8">
            Order History
          </h1>

          {loading ? (
            <div className="space-y-8">
              {[1, 2].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="h-4 w-40 bg-white/10 rounded animate-pulse mb-3" />
                  {[1, 2, 3].map((j) => (
                    <div key={j} className="h-16 bg-white/[0.03] rounded-xl animate-pulse" />
                  ))}
                </div>
              ))}
            </div>
          ) : fairGroups.length === 0 ? (
            <div className="bg-bg-card border border-white/10 rounded-2xl p-12 text-center">
              <p className="text-text-gray mb-2">No orders yet.</p>
              <p className="text-text-gray text-sm mb-6">
                Find a fair and place your first order.
              </p>
              <Link
                href="/fairs"
                className="inline-flex items-center px-6 py-3 rounded-xl bg-neon-pink text-white font-semibold hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
              >
                Find a Fair
              </Link>
            </div>
          ) : (
            <div className="space-y-10">
              {fairGroups.map((group) => (
                <div key={group.fairId}>
                  {/* Fair header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: group.fairColor }}
                      />
                      <h2 className="text-white font-bold text-sm uppercase tracking-wide">
                        {group.fairName}
                      </h2>
                      <span className="text-white/30 text-xs">
                        {group.orders.length} order{group.orders.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {group.fairSlug && (
                      <Link
                        href={`/fair/${group.fairSlug}/orders`}
                        className="text-xs text-white/30 hover:text-white/60 transition-colors"
                      >
                        View in fair →
                      </Link>
                    )}
                  </div>

                  {/* Order rows */}
                  <div className="space-y-2">
                    {group.orders.map((order) => (
                      <OrderRow key={order.id} order={order} fairSlug={group.fairSlug} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
