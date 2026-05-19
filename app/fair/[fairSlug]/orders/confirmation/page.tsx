'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircleIcon } from '@heroicons/react/24/outline'

interface OrderSummary {
  id: string
  vendorName: string
  status: string
  total: number
  itemCount: number
}

export default function MultiOrderConfirmationPage() {
  const params = useParams<{ fairSlug: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const ids = (searchParams.get('ids') ?? '').split(',').filter(Boolean)

  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (ids.length === 0) { router.replace(`/fair/${params.fairSlug}`); return }
    Promise.all(
      ids.map(id =>
        fetch(`/api/orders/${id}`)
          .then(r => r.json())
          .then(json => {
            if (!json.data) return null
            const order = json.data
            return {
              id: order.id,
              vendorName: order.vendor?.name ?? 'Vendor',
              status: order.status,
              total: order.total,
              itemCount: (order.orderItems ?? []).reduce((s: number, i: { quantity: number }) => s + i.quantity, 0),
            } as OrderSummary
          })
          .catch(() => null)
      )
    ).then(results => {
      setOrders(results.filter(Boolean) as OrderSummary[])
      setLoading(false)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-5 py-16 text-center">
        <div className="w-8 h-8 border-2 border-[#FF0077] border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-5 py-12 text-white">
      <div className="text-center mb-10">
        <CheckCircleIcon className="w-16 h-16 text-green-400 mx-auto mb-4" />
        <h1 className="font-bebas text-4xl tracking-wide mb-2">Orders Placed!</h1>
        <p className="text-[#A1A1A1]">
          {orders.length} order{orders.length !== 1 ? 's' : ''} confirmed. Vendors are being notified.
        </p>
      </div>

      <div className="space-y-3 mb-8">
        {orders.map(order => (
          <Link
            key={order.id}
            href={`/fair/${params.fairSlug}/order/${order.id}`}
            className="block bg-[#1A1A1A] border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-white">{order.vendorName}</span>
              <span className="text-[#FF0077] font-bold">${(order.total ?? 0).toFixed(2)}</span>
            </div>
            <p className="text-[#A1A1A1] text-sm">
              {order.itemCount ?? '—'} item{order.itemCount !== 1 ? 's' : ''} · Track order →
            </p>
          </Link>
        ))}
      </div>

      <Link
        href={`/fair/${params.fairSlug}`}
        className="block text-center py-3 border border-white/10 rounded-xl text-white/60 hover:text-white hover:border-white/20 transition-colors text-sm"
      >
        Back to fair
      </Link>
    </div>
  )
}
