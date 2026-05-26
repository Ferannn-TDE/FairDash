'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@clerk/clerk-react'
import { useFair } from '../../../_contexts/FairContext'
import Breadcrumb from '../_components/Breadcrumb'

import type { OrderDTO } from '@/types/order-dto'

type OrderSummary = Pick<OrderDTO, 'id' | 'status' | 'placedAt' | 'total' | 'vendor' | 'items'>

const STATUS_COLORS: Record<string, string> = {
  PLACED:        'text-amber-400 bg-amber-400/10 border-amber-400/20',
  ACCEPTED:      'text-amber-400 bg-amber-400/10 border-amber-400/20',
  PREPARING:     'text-blue-400 bg-blue-400/10 border-blue-400/20',
  READY:         'text-[#FF0077] bg-[#FF0077]/10 border-[#FF0077]/20',
  COMPLETED:     'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  CANCELLED:     'text-red-400 bg-red-400/10 border-red-400/20',
  UNCOLLECTED:   'text-red-400 bg-red-400/10 border-red-400/20',
  UNDELIVERABLE: 'text-red-400 bg-red-400/10 border-red-400/20',
}

const STATUS_LABELS: Record<string, string> = {
  PLACED: 'Placed', ACCEPTED: 'Accepted', PREPARING: 'Preparing',
  READY: 'Ready', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
  UNCOLLECTED: 'Uncollected', UNDELIVERABLE: 'Undeliverable',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[status] ?? 'text-[#A1A1A1] bg-white/5 border-white/10'}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function FairOrdersPage() {
  const params = useParams<{ fairSlug: string }>()
  const router = useRouter()
  const { isLoaded, isSignedIn } = useAuth()
  const { fair } = useFair()
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.replace(`/sign-in?redirect_url=/fair/${params.fairSlug}/orders`)
    }
  }, [isLoaded, isSignedIn, params.fairSlug, router])

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    setLoading(true)
    fetch('/api/orders/history?limit=50')
      .then(r => r.json())
      .then(json => {
        if (json?.success) {
          const all: OrderSummary[] = json.data.orders ?? []
          setOrders(all.filter(o => o.status !== 'PENDING_PAYMENT'))
        }
      })
      .catch(() => {/* show empty state */})
      .finally(() => setLoading(false))
  }, [])

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 sm:py-10">
        <div className="h-9 w-64 bg-white/10 rounded-lg animate-pulse mb-6" />
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-[#1A1A1A] border border-white/5 rounded-2xl p-5 h-24" />
          ))}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 sm:py-10">
        <div className="h-9 w-64 bg-white/10 rounded-lg animate-pulse mb-6" />
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-[#1A1A1A] border border-white/5 rounded-2xl p-5 flex items-start justify-between gap-3">
              <div className="space-y-2 flex-1">
                <div className="h-4 bg-white/10 rounded-full w-36" />
                <div className="h-3 bg-white/5 rounded-full w-52" />
                <div className="h-3 bg-white/5 rounded-full w-28" />
              </div>
              <div className="h-6 w-20 bg-white/10 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 sm:py-10 text-white">
      <Breadcrumb crumbs={[{ label: 'My Orders' }]} />
      <h1 className="font-bebas text-3xl sm:text-4xl tracking-wide mb-6 sm:mb-8">My Orders</h1>

      {orders.length === 0 ? (
        <div className="bg-[#1A1A1A] border border-white/10 rounded-2xl p-12 text-center">
          <div className="text-[4rem] mb-4 opacity-20">📦</div>
          <p className="text-[#A1A1A1] mb-2">No orders yet at this fair.</p>
          <p className="text-[#A1A1A1] text-sm mb-8">
            Browse vendors and place your first order.
          </p>
          <Link
            href={`/fair/${params.fairSlug}/vendors`}
            className="inline-flex items-center px-6 py-3 rounded-xl font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ background: accentColor }}
          >
            Browse Vendors
          </Link>
        </div>
      ) : (
        <div className="space-y-3 max-w-2xl">
          {orders.map(order => {
            const shortId = order.id.slice(-8).toUpperCase()
            const vendorNames = [...new Set(
              order.items
                .map(i => i.vendorName)
                .filter(Boolean) as string[]
            )]
            const vendorSummary = vendorNames.length === 0
              ? (order.vendor?.name ?? 'Unknown')
              : vendorNames.length === 1
              ? vendorNames[0]
              : vendorNames.length === 2
              ? `${vendorNames[0]} & ${vendorNames[1]}`
              : `${vendorNames[0]} +${vendorNames.length - 1} more`

            return (
              <Link
                key={order.id}
                href={`/fair/${params.fairSlug}/order/${shortId}`}
                className="block bg-[#1A1A1A] border border-white/5 rounded-2xl p-5 no-underline hover:border-[#FF0077]/30 hover:scale-[1.01] transition-all duration-200 group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-white font-bold text-sm font-mono tracking-tight">#{shortId}</p>
                      <StatusBadge status={order.status} />
                    </div>
                    <p className="text-[#A1A1A1] text-xs truncate">{vendorSummary}</p>
                    <p className="text-[#A1A1A1] text-xs mt-0.5">
                      {order.items.length} item{order.items.length !== 1 ? 's' : ''} · ${order.total.toFixed(2)} · {formatDate(order.placedAt)}
                    </p>
                  </div>
                  <span className="text-[#A1A1A1] group-hover:text-[#FF0077] transition-colors flex-shrink-0 text-lg">→</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
