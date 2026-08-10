'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@clerk/clerk-react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { getFirebaseApp } from '@/lib/firebase-client'
import { useFairCart } from '../../../../_contexts/FairCartContext'
import SingleOrderTracking from '@/components/order/SingleOrderTracking'
import MultiOrderTracking from '@/components/order/MultiOrderTracking'
import RunnerLocationBanner from '@/components/order/RunnerLocationBanner'
import { buildVendorGroups } from '@/components/order/helpers'
import type { Order } from '@/components/order/types'

export default function OrderTrackingPage() {
  const { fairSlug, orderId } = useParams<{ fairSlug: string; orderId: string }>()
  const router = useRouter()
  const { isLoaded, isSignedIn } = useAuth()
  const { addItem, clearCart } = useFairCart()

  const [order, setOrder]               = useState<Order | null>(null)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [cancelling, setCancelling]     = useState(false)
  const [liveStatus, setLiveStatus]     = useState<string>('')
  const [stableEventId, setStableEventId]     = useState<string | null>(null)
  const [stableCustomerId, setStableCustomerId] = useState<string | null>(null)
  const [showCancelModal, setShowCancelModal]   = useState(false)
  const [showSupportModal, setShowSupportModal] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.replace(`/login?redirect=/fair/${fairSlug}/order/${orderId}`)
    }
  }, [isLoaded, isSignedIn, fairSlug, orderId, router])

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    setLoading(true)
    fetch(`/api/orders/${orderId}`)
      .then(r => r.json())
      .then(json => {
        if (json?.success) {
          setOrder(json.data)
          setLiveStatus(json.data.status)
          setStableEventId(json.data.eventId)
          setStableCustomerId(json.data.customerId)
        } else {
          setError('Order not found')
        }
      })
      .catch(() => setError('Failed to load order — please refresh'))
      .finally(() => setLoading(false))
  }, [isLoaded, isSignedIn, orderId])

  useEffect(() => {
    if (!stableEventId || !stableCustomerId) return
    const TERMINAL = new Set(['COMPLETED', 'DELIVERED', 'CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE'])
    const app = getFirebaseApp()

    if (app) {
      let unsubscribe: (() => void) | null = null
      import('firebase/database').then(({ getDatabase, ref, onValue, off: firebaseOff }) => {
        const db = getDatabase(app)
        const statusRef = ref(db, `fairs/${stableEventId}/customerOrders/${stableCustomerId}/${orderId}`)
        const handler = onValue(statusRef, snap => {
          const data = snap.val() as { status: string; vendorId?: string } | null
          if (data?.status) {
            setLiveStatus(data.status)
            setOrder(prev => {
              if (!prev) return prev
              const updatedVendorStatuses = data.vendorId
                ? (prev.vendorOrderStatuses ?? []).map(vs =>
                    vs.vendorId === data.vendorId ? { ...vs, status: data.status } : vs
                  )
                : prev.vendorOrderStatuses
              return { ...prev, status: data.status, vendorOrderStatuses: updatedVendorStatuses }
            })
          }
        })
        unsubscribe = () => firebaseOff(statusRef, 'value', handler)
      }).catch(() => {})
      return () => { unsubscribe?.() }
    }

    pollingRef.current = setInterval(() => {
      fetch(`/api/orders/${orderId}`)
        .then(r => r.json())
        .then(json => {
          if (json?.success) {
            setOrder(json.data)
            setLiveStatus(json.data.status)
            if (TERMINAL.has(json.data.status) && pollingRef.current) {
              clearInterval(pollingRef.current)
              pollingRef.current = null
            }
          }
        })
        .catch(() => {})
    }, 10_000)

    return () => {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
    }
  }, [stableEventId, stableCustomerId, orderId])

  const handleCancel = async () => {
    setCancelling(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, { method: 'PATCH' })
      if (res.ok) {
        // vendorOrderStatuses must be patched too, not just the master status:
        // SingleOrderTracking derives EVERYTHING it shows — isCancelled, canCancel, the
        // timeline — from vendorOrderStatuses[0].status (SingleOrderTracking.tsx:40-44),
        // not from order.status or liveStatus. Setting only the master left the view on
        // PLACED, so a successful cancel looked like nothing had happened until a reload.
        // REFUNDED is what the server actually writes for a pre-accept cancel
        // (cancel/route.ts:84 → refundVendorPortion) and is terminal for the view
        // (FAILED_STATUSES, lib/order-status.ts:17), so isCancelled flips.
        setOrder(prev => prev ? {
          ...prev,
          status: 'CANCELLED',
          cancelledAt: new Date().toISOString(),
          vendorOrderStatuses: (prev.vendorOrderStatuses ?? []).map(vs => ({ ...vs, status: 'REFUNDED' })),
        } : prev)
        setLiveStatus('CANCELLED')
        setShowCancelModal(false)
        toast.success('Order cancelled. Refund is on the way.')
      } else if (res.status === 409) {
        setShowCancelModal(false)
        const refresh = await fetch(`/api/orders/${orderId}`)
        const refreshJson = await refresh.json()
        if (refreshJson?.success) { setOrder(refreshJson.data); setLiveStatus(refreshJson.data.status) }
        toast.error('This order can no longer be cancelled — the vendor has started preparing it.')
      } else {
        toast.error('Could not cancel — please contact support')
      }
    } catch {
      toast.error('Network error — please try again')
    } finally {
      setCancelling(false)
    }
  }

  const handleOrderAgain = useCallback(() => {
    if (!order) return
    clearCart()
    order.orderItems.forEach(item => {
      addItem(
        { id: item.menuItemId, name: item.menuItem.name, price: item.unitPrice, prepTime: item.menuItem.prepTime ?? undefined, imageUrl: item.menuItem.imageUrl },
        { id: item.vendor?.id ?? item.vendorId, name: item.vendor?.name ?? order.vendor.name }
      )
    })
    router.push(`/fair/${fairSlug}/checkout`)
  }, [order, clearCart, addItem, router, fairSlug])

  if (loading) return (
    <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 animate-pulse">
      <div className="flex items-start justify-between mb-6">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-white/10 rounded" />
          <div className="h-4 w-64 bg-white/5 rounded" />
        </div>
        <div className="h-7 w-24 bg-white/10 rounded-full" />
      </div>
      <div className="bg-white/[0.03] rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between gap-2">
          {[1,2,3,4].map(i => (
            <div key={i} className="flex flex-col items-center gap-2 flex-1">
              <div className="w-10 h-10 rounded-full bg-white/10" />
              <div className="h-3 w-16 bg-white/5 rounded hidden sm:block" />
            </div>
          ))}
        </div>
      </div>
      <div className="h-12 bg-white/[0.03] rounded-xl mb-4" />
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 space-y-4">
          <div className="h-48 sm:h-64 bg-white/[0.03] rounded-2xl" />
          <div className="bg-white/[0.03] rounded-2xl p-4 space-y-3">
            <div className="h-4 w-32 bg-white/10 rounded" />
            {[1,2].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-white/10 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-40 bg-white/10 rounded" />
                  <div className="h-3 w-20 bg-white/5 rounded" />
                </div>
                <div className="h-4 w-12 bg-white/10 rounded" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-12 bg-white/[0.03] rounded-xl" />
            <div className="h-12 bg-white/[0.03] rounded-xl" />
          </div>
        </div>
        <div className="lg:w-72 bg-white/[0.03] rounded-2xl p-4 space-y-4 h-fit">
          <div className="h-4 w-24 bg-white/10 rounded" />
          {[1,2,3,4,5].map(i => (
            <div key={i} className="space-y-1">
              <div className="h-3 w-16 bg-white/5 rounded" />
              <div className="h-4 w-32 bg-white/10 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 px-5 text-center">
      <div className="text-[5rem] mb-4 opacity-30">📦</div>
      <h3 className="font-bebas text-[2rem] tracking-wide mb-2">Order not found</h3>
      <p className="text-[#A1A1A1] text-base mb-8 max-w-sm">{error}</p>
      <Link href={`/fair/${fairSlug}/orders`} className="text-[#FF0077] font-semibold hover:text-[#e0006b] transition-colors">
        View all orders →
      </Link>
    </div>
  )

  if (!order) return null

  const sharedProps = {
    order, liveStatus, fairSlug, cancelling,
    showCancelModal, setShowCancelModal,
    showSupportModal, setShowSupportModal,
    onCancel: handleCancel,
    onOrderAgain: handleOrderAgain,
  }

  const isMultiVendor = buildVendorGroups(order.orderItems).length > 1
  const locationPanel = (
    <RunnerLocationBanner
      orderId={orderId}
      fulfillmentType={order.fulfillmentType}
      status={liveStatus}
    />
  )
  return (
    <>
      {/* Live runner location is passed as a SLOT so it renders UNDER the "Track Order"
          header (which lives inside each tracking view) rather than above it. Self-polls;
          renders nothing until a runner-fulfilled order reaches READY/RUNNER_COLLECTED. */}
      {isMultiVendor
        ? <MultiOrderTracking {...sharedProps} locationSlot={locationPanel} />
        : <SingleOrderTracking {...sharedProps} locationSlot={locationPanel} />}
    </>
  )
}
