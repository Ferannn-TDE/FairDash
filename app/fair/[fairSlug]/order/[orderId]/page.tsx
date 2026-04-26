'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  CheckIcon,
  ClockIcon,
  MapPinIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  ChatBubbleLeftEllipsisIcon,
  ReceiptPercentIcon,
  BuildingStorefrontIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import toast from 'react-hot-toast'
import { getDatabase, ref, onValue, off } from 'firebase/database'
import { getFirebaseApp } from '@/lib/firebase-client'
import { useFair } from '../../../../_contexts/FairContext'
import Breadcrumb from '../../_components/Breadcrumb'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderItem {
  id: string
  quantity: number
  unitPrice: number
  subtotal: number
  specialInstructions?: string | null
  menuItem: { name: string; imageUrl?: string | null }
}

interface Order {
  id: string
  status: string
  fulfillmentType: string
  eventId: string
  vendorId: string
  customerId: string
  runnerId?: string | null
  subtotal: number
  deliveryFee?: number | null
  serviceCharge?: number | null
  fairSynqFee: number
  total: number
  customerName: string
  customerPhone: string
  vehicleMake?: string | null
  vehicleColor?: string | null
  vehiclePlate?: string | null
  deliveryStreet?: string | null
  deliveryCity?: string | null
  deliveryZip?: string | null
  estimatedReadyAt?: string | null
  placedAt: string
  acceptedAt?: string | null
  readyAt?: string | null
  completedAt?: string | null
  cancelledAt?: string | null
  vendor: { id: string; name: string; boothNumber?: string | null }
  orderItems: OrderItem[]
}

// ─── Status config ─────────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Order Placed', sublabel: 'Confirmed',   icon: ReceiptPercentIcon },
  { label: 'Preparing',    sublabel: 'In progress', icon: ClockIcon },
  { label: 'Ready',        sublabel: 'For pickup',  icon: BuildingStorefrontIcon },
  { label: 'Completed',    sublabel: 'All done!',   icon: CheckCircleIcon },
]

const STATUS_TO_STEP: Record<string, number> = {
  PLACED: 0, ACCEPTED: 0,
  PREPARING: 1,
  READY: 2,
  COMPLETED: 3,
}

const TERMINAL_STATUSES = ['CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE']

const STATUS_LABELS: Record<string, string> = {
  PLACED: 'Order Placed',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready for Pickup',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  UNCOLLECTED: 'Uncollected',
  UNDELIVERABLE: 'Undeliverable',
}

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatTime = (iso?: string | null) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const formatDate = (iso?: string | null) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

const getMapEmbedUrl = (order: Order) => {
  let query = ''
  if (order.fulfillmentType === 'HOME_DELIVERY' && order.deliveryStreet) {
    query = `${order.deliveryStreet}, ${order.deliveryCity} ${order.deliveryZip}`
  } else if (order.vendor?.boothNumber) {
    query = `${order.vendor.name} booth ${order.vendor.boothNumber}`
  } else {
    query = order.vendor?.name || 'Fair grounds'
  }
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed&hl=en&z=15`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_COLORS[status] ?? 'text-[#A1A1A1] bg-white/5 border-white/10'}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

function OrderStepper({ status, steps }: { status: string; steps: typeof STEPS }) {
  const currentStep = STATUS_TO_STEP[status] ?? -1
  const isCancelled = TERMINAL_STATUSES.includes(status)

  if (isCancelled) {
    return (
      <div className="bg-[#1A1A1A] border border-red-500/20 rounded-2xl p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
          <XMarkIcon className="w-5 h-5 text-red-400" />
        </div>
        <div>
          <p className="text-white font-semibold text-sm">Order {STATUS_LABELS[status]}</p>
          <p className="text-[#A1A1A1] text-xs mt-0.5">
            {status === 'CANCELLED' ? 'This order was cancelled.' :
             status === 'UNCOLLECTED' ? 'This order was not collected in time.' :
             'This order could not be delivered.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl p-5 md:p-4">
      <div className="flex items-start">
        {steps.map((step, idx) => (
          <div key={step.label} className="flex items-start flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className={`w-10 h-10 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-all duration-300 flex-shrink-0 ${
                idx < currentStep
                  ? 'bg-[#FF0077] shadow-[0_0_20px_rgba(255,0,119,0.4)]'
                  : idx === currentStep
                  ? 'bg-[#FF0077] ring-4 ring-[#FF0077]/20 shadow-[0_0_30px_rgba(255,0,119,0.6)]'
                  : 'bg-white/5 border border-white/10'
              }`}>
                {idx < currentStep ? (
                  <CheckIcon className="w-5 h-5 md:w-4 md:h-4 text-white" />
                ) : (
                  <step.icon className={`w-5 h-5 md:w-4 md:h-4 ${idx === currentStep ? 'text-white' : 'text-[#A1A1A1]'}`} />
                )}
              </div>
              <p className={`text-[0.6875rem] md:text-[0.625rem] font-semibold text-center mt-2 leading-tight ${idx <= currentStep ? 'text-white' : 'text-[#A1A1A1]'}`}>
                {step.label}
              </p>
              <p className="hidden md:block text-[0.5625rem] text-[#A1A1A1]/60 text-center mt-0.5">{step.sublabel}</p>
            </div>
            {idx < steps.length - 1 && (
              <div className="flex items-center flex-shrink-0 pt-5 md:pt-4 w-4 md:w-3">
                <div className={`h-0.5 w-full transition-all duration-500 ${idx < currentStep ? 'bg-[#FF0077]' : 'bg-white/10'}`} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function OrderItemsCard({ order }: { order: Order }) {
  return (
    <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
        <p className="text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold">Order Items</p>
        <StatusBadge status={order.status} />
      </div>
      <div className="px-5 py-3 divide-y divide-white/5">
        {order.orderItems.map(item => (
          <div key={item.id} className="flex items-center gap-3 py-3">
            {item.menuItem.imageUrl ? (
              <img src={item.menuItem.imageUrl} alt={item.menuItem.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-white/5" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0 text-base">🍽️</div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{item.menuItem.name}</p>
              {item.specialInstructions && (
                <p className="text-[#A1A1A1] text-xs mt-0.5 truncate">{item.specialInstructions}</p>
              )}
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="text-[#A1A1A1] text-xs">×{item.quantity}</p>
              <p className="text-white text-sm font-medium">${item.subtotal.toFixed(2)}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="px-5 py-4 bg-white/[0.02] border-t border-white/5 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-[#A1A1A1]">Subtotal</span>
          <span className="text-white">${order.subtotal.toFixed(2)}</span>
        </div>
        {(order.deliveryFee ?? 0) > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-[#A1A1A1]">Delivery fee</span>
            <span className="text-white">${order.deliveryFee!.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold border-t border-white/5 pt-2 mt-2">
          <span className="text-white">Total</span>
          <span className="text-[#FF0077] text-base [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
            ${order.total.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}

function OrderMetaCard({ order }: { order: Order }) {
  const isDelivery = order.fulfillmentType === 'HOME_DELIVERY'
  const isCurbside = order.fulfillmentType === 'CURBSIDE'
  const hasAddress = isDelivery && order.deliveryStreet

  return (
    <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/5">
        <p className="text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold">Order Details</p>
      </div>
      <div className="px-5 py-4 space-y-4">
        <div>
          <p className="text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold mb-1">Order #</p>
          <p className="text-white font-mono text-sm">{order.id.slice(-8).toUpperCase()}</p>
        </div>
        <div>
          <p className="text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold mb-1">Vendor</p>
          <div className="flex items-center gap-2">
            <BuildingStorefrontIcon className="w-4 h-4 text-[#FF0077] flex-shrink-0" />
            <span className="text-white text-sm">{order.vendor.name}</span>
            {order.vendor.boothNumber && (
              <span className="text-[#A1A1A1] text-xs">· Booth {order.vendor.boothNumber}</span>
            )}
          </div>
        </div>
        <div>
          <p className="text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold mb-1">Fulfillment</p>
          <p className="text-white text-sm">
            {isDelivery ? '🚶 Home Delivery' : isCurbside ? '🚗 Curbside' : '🏬 Booth Pickup'}
          </p>
        </div>
        {isCurbside && order.vehicleMake && (
          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold mb-1">Vehicle</p>
            <p className="text-white text-sm">
              {order.vehicleColor} {order.vehicleMake}
              {order.vehiclePlate && ` · ${order.vehiclePlate}`}
            </p>
          </div>
        )}
        {hasAddress && (
          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold mb-1">Delivery Address</p>
            <div className="flex items-start gap-2">
              <MapPinIcon className="w-4 h-4 text-[#FF0077] flex-shrink-0 mt-0.5" />
              <p className="text-white text-sm">
                {order.deliveryStreet}<br />
                {order.deliveryCity}, {order.deliveryZip}
              </p>
            </div>
          </div>
        )}
        <div>
          <p className="text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold mb-2">Timeline</p>
          <div className="space-y-1.5">
            {[
              { label: 'Placed',    value: order.placedAt },
              { label: 'Accepted',  value: order.acceptedAt },
              { label: 'Ready',     value: order.readyAt },
              { label: 'Completed', value: order.completedAt },
              { label: 'Cancelled', value: order.cancelledAt },
            ].filter(t => t.value).map(t => (
              <div key={t.label} className="flex justify-between items-center">
                <span className="text-[#A1A1A1] text-xs">{t.label}</span>
                <span className="text-white text-xs font-medium">
                  {formatTime(t.value)} · {formatDate(t.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusBanner({ order }: { order: Order }) {
  const { status, fulfillmentType, estimatedReadyAt, vendor, vehicleColor, vehicleMake } = order

  let Icon: React.ElementType = ClockIcon
  let colorClass = 'bg-amber-500/10 border-amber-500/20 text-amber-300'
  let message: string | null = null

  if (status === 'PLACED') {
    message = 'Waiting for the vendor to accept your order (up to 2 minutes)…'
  } else if (status === 'ACCEPTED' || status === 'PREPARING') {
    colorClass = 'bg-blue-500/10 border-blue-500/20 text-blue-300'
    const readyStr = estimatedReadyAt
      ? ` Estimated ready at ${new Date(estimatedReadyAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
      : ''
    message = `The vendor is preparing your order.${readyStr}`
  } else if (status === 'READY') {
    Icon = CheckCircleIcon
    colorClass = 'bg-[#FF0077]/10 border-[#FF0077]/20 text-[#FF0077]'
    if (fulfillmentType === 'BOOTH_PICKUP') {
      message = vendor?.boothNumber
        ? `Order ready at Booth #${vendor.boothNumber}. Walk to the express lane.`
        : 'Your order is ready for pickup at the vendor booth!'
    } else if (fulfillmentType === 'CURBSIDE') {
      message = vehicleColor && vehicleMake
        ? `Your order is ready. A Runner is bringing it to your ${vehicleColor} ${vehicleMake}.`
        : 'Your order is ready. A Runner is on their way to your vehicle.'
    } else {
      message = 'Your order is out for delivery!'
    }
  } else if (status === 'COMPLETED') {
    Icon = CheckCircleIcon
    colorClass = 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
    message = fulfillmentType === 'HOME_DELIVERY'
      ? 'Delivered! We hope you enjoy your food.'
      : 'Order complete! Enjoy your food.'
  } else {
    return null
  }

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border mb-6 ${colorClass}`}>
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <p className="text-sm font-medium leading-snug">{message}</p>
    </div>
  )
}

function CancelModal({
  isOpen, onClose, onConfirm, loading, orderStatus,
}: {
  isOpen: boolean; onClose: () => void; onConfirm: () => void; loading: boolean; orderStatus: string
}) {
  if (!isOpen) return null
  const feeApplies = orderStatus === 'ACCEPTED'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1A1A1A] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-[0_20px_60px_rgba(0,0,0,0.6)] animate-fadeIn">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="font-bebas text-xl tracking-wide text-white">Cancel Order?</h3>
            <p className="text-[#A1A1A1] text-xs">This cannot be undone.</p>
          </div>
        </div>
        {feeApplies ? (
          <div className="mb-6 space-y-3">
            <p className="text-[#A1A1A1] text-sm">
              The vendor has already accepted your order. A{' '}
              <span className="text-white font-semibold">$5.00 cancellation fee</span> will be
              retained and the remainder refunded within 5–10 business days.
            </p>
            <p className="text-[0.6875rem] text-amber-400/80">
              Cancellations after a vendor has started your order incur a $5.00 fee.
            </p>
          </div>
        ) : (
          <p className="text-[#A1A1A1] text-sm mb-6">
            Your order will be cancelled and a full refund will be issued within 5–10 business days.
          </p>
        )}
        <div className="flex gap-3">
          <button onClick={onClose} disabled={loading} className="flex-1 py-2.5 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors cursor-pointer active:scale-[0.97]">
            Keep Order
          </button>
          <button onClick={onConfirm} disabled={loading} className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 active:scale-[0.97] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'Cancelling…' : feeApplies ? 'Cancel (−$5.00 fee)' : 'Cancel Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SupportModal({ isOpen, onClose, orderId }: { isOpen: boolean; onClose: () => void; orderId: string }) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1A1A1A] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-[0_20px_60px_rgba(0,0,0,0.6)] animate-fadeIn">
        <button onClick={onClose} className="absolute top-4 right-4 p-1 text-[#A1A1A1] hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer bg-transparent border-0">
          <XMarkIcon className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-[#FF0077]/10 border border-[#FF0077]/20 flex items-center justify-center flex-shrink-0">
            <ChatBubbleLeftEllipsisIcon className="w-5 h-5 text-[#FF0077]" />
          </div>
          <div>
            <h3 className="font-bebas text-xl tracking-wide text-white">Contact Support</h3>
            <p className="text-[#A1A1A1] text-xs">Order #{orderId.slice(-8).toUpperCase()}</p>
          </div>
        </div>
        <div className="space-y-3">
          <a
            href="mailto:support@fairsynq.com?subject=Order Support"
            className="flex items-center gap-3 p-3.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm font-medium no-underline hover:bg-white/10 hover:border-[#FF0077]/30 transition-all"
          >
            <span className="text-lg">✉️</span>
            Email support
          </a>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrderTrackingPage() {
  const params = useParams<{ fairSlug: string; orderId: string }>()
  const { fair } = useFair()

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [showSupportModal, setShowSupportModal] = useState(false)
  const [runnerLocation, setRunnerLocation] = useState<{ lat: number; lng: number } | null>(null)

  // ── Fetch order ──────────────────────────────────────────────────────────
  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${params.orderId}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message ?? 'Failed to load order')
      setOrder(json.data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [params.orderId])

  // Initial fetch + 15-second polling fallback for non-terminal orders
  useEffect(() => {
    fetchOrder()
    const isActive = !order || (!TERMINAL_STATUSES.includes(order.status) && order.status !== 'COMPLETED')
    if (!isActive) return
    const interval = setInterval(fetchOrder, 15_000)
    return () => clearInterval(interval)
  }, [fetchOrder, order?.status])

  // ── Firebase RTDB — real-time customer status listener ───────────────────
  // Path: fairs/{eventId}/customerOrders/{customerId}/{orderId}
  // The status update route writes here so customers get push updates.
  useEffect(() => {
    if (!order?.eventId || !order?.customerId) return
    const app = getFirebaseApp()
    if (!app) return

    const db = getDatabase(app)
    const orderRef = ref(db, `fairs/${order.eventId}/customerOrders/${order.customerId}/${params.orderId}`)

    onValue(orderRef, snap => {
      const data = snap.val()
      if (data?.status) {
        setOrder(prev => prev ? { ...prev, status: data.status, updatedAt: data.updatedAt } : prev)
      }
    })

    return () => off(orderRef)
  }, [order?.eventId, order?.customerId, params.orderId])

  // ── Firebase RTDB — runner live location (HOME_DELIVERY READY only) ──────
  useEffect(() => {
    if (!order?.eventId || !order?.runnerId) return
    if (order.status !== 'READY') return
    if (order.fulfillmentType !== 'HOME_DELIVERY') return

    const app = getFirebaseApp()
    if (!app) return

    const db = getDatabase(app)
    const locRef = ref(db, `fairs/${order.eventId}/runnerLocation/${order.runnerId}`)

    onValue(locRef, snap => {
      const loc = snap.val()
      if (loc?.lat && loc?.lng) setRunnerLocation({ lat: loc.lat, lng: loc.lng })
    })

    return () => off(locRef)
  }, [order?.eventId, order?.runnerId, order?.status, order?.fulfillmentType])

  // ── Cancel handler ────────────────────────────────────────────────────────
  const handleCancel = async () => {
    setCancelling(true)
    try {
      const res = await fetch(`/api/orders/${params.orderId}/cancel`, { method: 'PATCH' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message ?? 'Cancellation failed')
      setShowCancelModal(false)
      const fee = json.data?.cancellationFee
      toast.success(
        fee > 0
          ? `Order cancelled. Refund issued minus $${fee.toFixed(2)} cancellation fee.`
          : 'Order cancelled. Full refund is on the way.'
      )
      fetchOrder()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel order. Please contact support.')
    } finally {
      setCancelling(false)
    }
  }

  // ── Loading / error / empty states ────────────────────────────────────────
  if (loading) return null // loading.tsx handles skeleton

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-5 text-center">
        <div className="text-[5rem] mb-4 opacity-30">📦</div>
        <h3 className="font-bebas text-[2rem] tracking-wide mb-2">Order not found</h3>
        <p className="text-[#A1A1A1] text-base mb-8 max-w-sm">{error}</p>
        <Link href={`/fair/${params.fairSlug}/orders`} className="text-[#FF0077] font-semibold hover:text-[#e0006b] transition-colors">
          View all orders →
        </Link>
      </div>
    )
  }

  if (!order) return null

  const canCancel = ['PLACED', 'ACCEPTED'].includes(order.status)
  const isCancelled = TERMINAL_STATUSES.includes(order.status)
  const isCompleted = order.status === 'COMPLETED'
  const mapSrc = getMapEmbedUrl(order)

  // Relabel "Ready" step based on fulfillment type
  const steps = STEPS.map((s, i) =>
    i === 2
      ? { ...s,
          label: order.fulfillmentType === 'HOME_DELIVERY' ? 'Out for Delivery' : 'Ready for Pickup',
          sublabel: order.fulfillmentType === 'HOME_DELIVERY' ? 'On the way' : 'For pickup',
        }
      : s
  )

  return (
    <>
      <div className="min-h-screen pb-16">
        {/* Page header */}
        <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-8 md:py-6 border-b border-white/10">
          <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8">
            <Breadcrumb crumbs={[
              { label: 'My Orders', href: `/fair/${params.fairSlug}/orders` },
              { label: `Order #${order.id.slice(-8).toUpperCase()}` },
            ]} />
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="font-bebas text-[clamp(1.75rem,4vw,2.5rem)] tracking-[0.125rem] leading-none mb-1">
                  Track Order
                </h1>
                <p className="text-[#A1A1A1] text-sm">
                  #{order.id.slice(-8).toUpperCase()} · {order.vendor.name} · {formatDate(order.placedAt)}
                </p>
              </div>
              <StatusBadge status={order.status} />
            </div>
          </div>
        </div>

        <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6">
          {/* Stepper */}
          <div className="mb-4">
            <OrderStepper status={order.status} steps={steps} />
          </div>

          {/* Status banner */}
          <StatusBanner order={order} />

          {/* Two-column layout */}
          <div className="grid grid-cols-[1fr_22rem] lg:grid-cols-1 gap-5">

            {/* Left: map + items + actions */}
            <div className="flex flex-col gap-5">
              {!isCancelled && mapSrc && (
                <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl overflow-hidden">
                  <div className="relative w-full h-64 md:h-48">
                    <iframe
                      title="Order location"
                      src={runnerLocation
                        ? `https://maps.google.com/maps?q=${runnerLocation.lat},${runnerLocation.lng}&output=embed&hl=en&z=16`
                        : mapSrc}
                      className="w-full h-full border-0"
                      loading="lazy"
                      allowFullScreen
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                    <div className={`absolute top-3 left-3 bg-black/80 backdrop-blur-sm px-3 py-1.5 rounded-full flex items-center gap-2 text-xs font-semibold border ${
                      runnerLocation
                        ? 'text-[#FF0077] border-[#FF0077]/30'
                        : 'text-[#A1A1A1] border-white/10'
                    }`}>
                      <TruckIcon className="w-3.5 h-3.5" />
                      {runnerLocation ? (
                        <>Runner location live <span className="w-2 h-2 rounded-full bg-[#FF0077] animate-pulse" /></>
                      ) : (
                        order.fulfillmentType === 'HOME_DELIVERY' && order.status === 'READY'
                          ? 'Awaiting runner location…'
                          : 'Order location'
                      )}
                    </div>
                  </div>
                </div>
              )}

              <OrderItemsCard order={order} />

              {!isCompleted && !isCancelled && (
                <div className="flex gap-3 md:flex-col">
                  <button
                    onClick={() => setShowSupportModal(true)}
                    className="flex items-center justify-center gap-2 flex-1 py-3 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors cursor-pointer active:scale-[0.97]"
                  >
                    <ChatBubbleLeftEllipsisIcon className="w-4 h-4" />
                    Contact Support
                  </button>
                  {canCancel && (
                    <button
                      onClick={() => setShowCancelModal(true)}
                      className="flex items-center justify-center gap-2 flex-1 py-3 bg-transparent border-2 border-red-500/40 text-red-400 rounded-xl text-sm font-semibold hover:bg-red-500/10 hover:border-red-500/60 transition-all cursor-pointer active:scale-[0.97]"
                    >
                      <XMarkIcon className="w-4 h-4" />
                      Cancel Order
                    </button>
                  )}
                </div>
              )}

              {isCompleted && (
                <div className="flex gap-3 md:flex-col">
                  <Link
                    href={`/fair/${params.fairSlug}/vendors`}
                    className="flex items-center justify-center gap-2 flex-1 py-3 bg-[#FF0077] text-white rounded-xl text-sm font-semibold no-underline hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)] active:scale-[0.97]"
                  >
                    Order Again
                  </Link>
                  <button
                    onClick={() => setShowSupportModal(true)}
                    className="flex items-center justify-center gap-2 flex-1 py-3 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors cursor-pointer active:scale-[0.97]"
                  >
                    <ChatBubbleLeftEllipsisIcon className="w-4 h-4" />
                    Support
                  </button>
                </div>
              )}
            </div>

            {/* Right: order meta */}
            <OrderMetaCard order={order} />
          </div>
        </div>
      </div>

      <CancelModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancel}
        loading={cancelling}
        orderStatus={order.status}
      />
      <SupportModal
        isOpen={showSupportModal}
        onClose={() => setShowSupportModal(false)}
        orderId={params.orderId}
      />
    </>
  )
}
