'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  TruckIcon, MapPinIcon, CameraIcon, CheckCircleIcon,
  ChevronLeftIcon, ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface OrderDetail {
  id: string
  status: 'READY' | 'RUNNER_COLLECTED' | 'DELIVERED' | 'COMPLETED'
  fulfillmentType: 'HOME_DELIVERY' | 'CURBSIDE'
  customerName: string
  customerPhone: string
  total: number
  subtotal: number
  deliveryFee: number | null
  deliveryStreet: string | null
  deliveryCity: string | null
  deliveryZip: string | null
  vehicleMake: string | null
  vehicleModel: string | null
  vehicleColor: string | null
  vehiclePlate: string | null
  curbsidePhotoUrl: string | null
  vendor: { name: string; boothNumber: string | null }
  orderItems: {
    id: string
    quantity: number
    menuItem: { name: string; imageUrl: string | null }
  }[]
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function DeliveryPage() {
  const params = useParams()
  const router = useRouter()
  const fairSlug = params.fairSlug as string
  const orderId  = params.orderId  as string

  const [order, setOrder]         = useState<OrderDetail | null>(null)
  const [loading, setLoading]     = useState(true)
  const [advancing, setAdvancing] = useState(false)
  const [photoUrl, setPhotoUrl]   = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Load order ─────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`/api/runners/me/orders?orderId=${orderId}`)
      .then(r => r.json())
      .then(json => {
        if (json.success) setOrder(json.data.order)
        else toast.error(json.error?.message || 'Order not found')
      })
      .catch(() => toast.error('Could not load order'))
      .finally(() => setLoading(false))
  }, [orderId])

  // ── Photo upload ───────────────────────────────────────────────────────────

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      // 1. Get signed upload URL
      const signRes = await fetch('/api/storage/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      })
      const signJson = await signRes.json()
      if (!signJson.success) throw new Error(signJson.error?.message || 'Could not get upload URL')

      const { uploadUrl, publicUrl } = signJson.data

      // 2. PUT the file to the signed URL
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!uploadRes.ok) throw new Error('Upload failed')

      setPhotoUrl(publicUrl)
      toast.success('Photo uploaded')
    } catch (err: any) {
      toast.error(err.message || 'Could not upload photo')
    } finally {
      setUploading(false)
    }
  }

  // ── Advance status ─────────────────────────────────────────────────────────

  const advanceStatus = async (newStatus: 'RUNNER_COLLECTED' | 'DELIVERED') => {
    if (!order || advancing) return
    setAdvancing(true)
    try {
      const body: Record<string, unknown> = { status: newStatus }

      if (newStatus === 'DELIVERED') {
        if (!photoUrl) {
          toast.error('Please upload a delivery photo first')
          setAdvancing(false)
          return
        }
        body.photoUrl = photoUrl

        // Attach GPS coordinates if available
        if ('geolocation' in navigator) {
          try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
              navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
            )
            body.lat = pos.coords.latitude
            body.lng = pos.coords.longitude
          } catch {
            // GPS optional — backend will still accept if within radius or fail gracefully
          }
        }
      }

      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message || 'Status update failed')

      setOrder(prev => prev ? { ...prev, status: newStatus } : prev)
      toast.success(newStatus === 'RUNNER_COLLECTED' ? 'Pickup confirmed' : 'Delivery confirmed!')

      if (newStatus === 'DELIVERED') {
        setTimeout(() => router.push(`/runner/${fairSlug}/dashboard`), 1200)
      }
    } catch (err: any) {
      toast.error(err.message || 'Could not update status')
    } finally {
      setAdvancing(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-dark text-white flex items-center justify-center">
        <TruckIcon className="w-8 h-8 text-text-gray animate-pulse" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-bg-dark text-white flex items-center justify-center flex-col gap-4">
        <ExclamationTriangleIcon className="w-10 h-10 text-text-gray" />
        <p className="text-text-gray">Order not found.</p>
        <Link href={`/runner/${fairSlug}/dashboard`} className="text-neon-pink text-sm hover:underline">
          Back to Dashboard
        </Link>
      </div>
    )
  }

  const isDone = ['DELIVERED', 'COMPLETED'].includes(order.status)
  const isDelivery = order.fulfillmentType === 'HOME_DELIVERY'
  const itemCount  = order.orderItems.reduce((s, i) => s + i.quantity, 0)

  return (
    <div className="min-h-screen bg-bg-dark text-white pb-20">
      <div className="max-w-[600px] mx-auto px-[6%] sm:px-5 py-8 space-y-5">

        {/* Back link */}
        <Link
          href={`/runner/${fairSlug}/dashboard`}
          className="inline-flex items-center gap-1.5 text-sm text-text-gray hover:text-white transition-colors"
        >
          <ChevronLeftIcon className="w-3.5 h-3.5" />
          Dashboard
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-bebas text-3xl tracking-wide text-white">
              Delivery #{orderId.slice(-6).toUpperCase()}
            </h1>
            <p className="text-text-gray text-sm">{order.customerName}</p>
          </div>
          <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${
            isDone
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : order.status === 'RUNNER_COLLECTED'
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
          }`}>
            {order.status === 'READY' ? 'Awaiting Pickup' :
             order.status === 'RUNNER_COLLECTED' ? 'In Transit' : 'Delivered'}
          </span>
        </div>

        {/* Pickup location */}
        <div className="bg-bg-card border border-white/10 rounded-2xl p-5">
          <h2 className="font-bebas text-lg tracking-wide text-white mb-3">Pickup From</h2>
          <p className="text-white font-semibold text-sm">{order.vendor.name}</p>
          {order.vendor.boothNumber && (
            <p className="text-text-gray text-sm">Booth {order.vendor.boothNumber}</p>
          )}
        </div>

        {/* Delivery destination */}
        {isDelivery && order.deliveryStreet && (
          <div className="bg-bg-card border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <MapPinIcon className="w-4 h-4 text-neon-pink" />
              <h2 className="font-bebas text-lg tracking-wide text-white">Deliver To</h2>
            </div>
            <p className="text-white text-sm">{order.deliveryStreet}</p>
            <p className="text-text-gray text-sm">{order.deliveryCity}{order.deliveryZip ? `, ${order.deliveryZip}` : ''}</p>
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(`${order.deliveryStreet}, ${order.deliveryCity}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-neon-pink text-xs hover:underline"
            >
              Open in Maps
            </a>
          </div>
        )}

        {/* Curbside info */}
        {!isDelivery && (order.vehicleMake || order.vehicleColor) && (
          <div className="bg-bg-card border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <TruckIcon className="w-4 h-4 text-amber-400" />
              <h2 className="font-bebas text-lg tracking-wide text-white">Customer Vehicle</h2>
            </div>
            <p className="text-white text-sm">
              {[order.vehicleColor, order.vehicleMake, order.vehicleModel].filter(Boolean).join(' ')}
            </p>
            {order.vehiclePlate && (
              <p className="text-text-gray text-sm">Plate: {order.vehiclePlate}</p>
            )}
          </div>
        )}

        {/* Order items */}
        <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10">
            <h2 className="font-bebas text-lg tracking-wide text-white">
              Items ({itemCount})
            </h2>
          </div>
          <div className="divide-y divide-white/5">
            {order.orderItems.map(item => (
              <div key={item.id} className="px-5 py-3 flex items-center gap-3">
                {item.menuItem.imageUrl ? (
                  <img src={item.menuItem.imageUrl} alt={item.menuItem.name} className="w-8 h-8 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                    <span className="text-sm">🍽️</span>
                  </div>
                )}
                <p className="text-white text-sm flex-1">{item.menuItem.name}</p>
                <p className="text-text-gray text-sm">×{item.quantity}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Photo upload — required before DELIVERED */}
        {order.status === 'RUNNER_COLLECTED' && (
          <div className="bg-bg-card border border-white/10 rounded-2xl p-5">
            <h2 className="font-bebas text-lg tracking-wide text-white mb-1">Delivery Photo</h2>
            <p className="text-text-gray text-xs mb-4">
              {isDelivery
                ? 'Required: photo of order at the delivery address door / handoff.'
                : 'Required: photo confirming handoff to customer vehicle.'}
            </p>

            {photoUrl ? (
              <div className="space-y-3">
                <img src={photoUrl} alt="Delivery confirmation" className="w-full rounded-xl object-cover max-h-48" />
                <button
                  onClick={() => { setPhotoUrl(null); if (fileRef.current) fileRef.current.value = '' }}
                  className="text-xs text-text-gray hover:text-white transition-colors cursor-pointer bg-transparent border-0"
                >
                  Retake photo
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full py-4 border-2 border-dashed border-white/10 rounded-xl flex flex-col items-center gap-2 text-text-gray hover:border-neon-pink/40 hover:text-white transition-colors cursor-pointer bg-transparent disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CameraIcon className="w-6 h-6" />
                <span className="text-sm font-medium">
                  {uploading ? 'Uploading…' : 'Tap to take / upload photo'}
                </span>
              </button>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoSelect}
            />
          </div>
        )}

        {/* Actions */}
        {!isDone && (
          <div className="space-y-3">
            {order.status === 'READY' && (
              <button
                onClick={() => advanceStatus('RUNNER_COLLECTED')}
                disabled={advancing}
                className="w-full py-4 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)] disabled:opacity-40 disabled:cursor-not-allowed border-0 cursor-pointer"
              >
                {advancing ? 'Confirming…' : 'Confirm Pickup from Vendor'}
              </button>
            )}

            {order.status === 'RUNNER_COLLECTED' && (
              <button
                onClick={() => advanceStatus('DELIVERED')}
                disabled={advancing || !photoUrl}
                className="w-full py-4 bg-emerald-500 text-white rounded-xl font-semibold text-sm hover:bg-emerald-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-0 cursor-pointer"
              >
                {advancing ? 'Confirming…' : 'Confirm Delivery'}
              </button>
            )}
          </div>
        )}

        {isDone && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 text-center">
            <CheckCircleIcon className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-emerald-400 font-semibold text-sm">Delivery complete!</p>
          </div>
        )}

      </div>
    </div>
  )
}
