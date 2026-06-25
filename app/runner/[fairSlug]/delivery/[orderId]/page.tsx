'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Car, MapPin, Phone, CheckSquare, Square, Package, Camera } from 'lucide-react'
import toast from 'react-hot-toast'

const FULFILLMENT_LABEL: Record<string, string> = {
  CURBSIDE: 'Curbside', HOME_DELIVERY: 'Home Delivery', BOOTH_PICKUP: 'Booth Pickup',
}

interface DeliveryOrder {
  id: string
  status: string
  fulfillmentType: string
  customerName: string
  customerPhone: string
  deliveryFee: number | null
  total: number
  deliveryStreet?: string | null
  deliveryCity?: string | null
  deliveryZip?: string | null
  vehicleMake?: string | null
  vehicleColor?: string | null
  vehiclePlate?: string | null
  pickupLocation?: string | null
  vendor?: { name?: string | null; boothNumber?: string | null } | null
  orderItems?: { id: string; quantity: number; menuItem?: { name?: string | null } | null }[]
}

export default function DeliveryPage() {
  const params = useParams()
  const router = useRouter()
  const fairSlug = params.fairSlug as string
  const orderId = params.orderId as string

  const [order, setOrder] = useState<DeliveryOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [pickedUp, setPickedUp] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    try {
      const res = await fetch(`/api/runners/me/orders?orderId=${orderId}`)
      const json = await res.json()
      if (json.success) {
        const o = json.data.order ?? json.data
        setOrder(o)
        if (o?.status === 'DELIVERED') setPickedUp(true)
      }
    } catch { /* reconnect handler below refetches */ } finally { setLoading(false) }
  }

  // Reconnection: a runner mid-delivery drops WiFi — refetch on focus/online so
  // the screen never silently goes stale.
  useEffect(() => {
    load()
    const refetch = () => load()
    window.addEventListener('focus', refetch)
    window.addEventListener('online', refetch)
    return () => { window.removeEventListener('focus', refetch); window.removeEventListener('online', refetch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const signRes = await fetch('/api/storage/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: `delivery_${orderId}_${file.name}`, contentType: file.type }),
      })
      const sign = await signRes.json()
      if (!sign.success) { toast.error('Could not start photo upload'); return }
      const put = await fetch(sign.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!put.ok) { toast.error('Photo upload failed'); return }
      setPhotoUrl(sign.data.publicUrl)
      toast.success('Photo attached')
    } catch { toast.error('Photo upload failed') } finally { setUploading(false) }
  }

  async function confirmDelivery() {
    if (!order) return
    if (!photoUrl) { toast.error('Take a proof-of-delivery photo first'); return }
    setSubmitting(true)
    // Best-effort GPS for HOME_DELIVERY (the route GPS-verifies within range).
    const getPos = () => new Promise<GeolocationPosition | null>(resolve => {
      if (!navigator.geolocation) return resolve(null)
      navigator.geolocation.getCurrentPosition(p => resolve(p), () => resolve(null), { timeout: 5000 })
    })
    const pos = order.fulfillmentType === 'HOME_DELIVERY' ? await getPos() : null
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'DELIVERED', photoUrl,
          ...(pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : {}),
        }),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        toast.success('Delivery complete!')
        router.push(`/runner/${fairSlug}/dashboard`)
      } else {
        toast.error(json.error?.message ?? 'Could not confirm delivery')
      }
    } catch { toast.error('Network error — try again') } finally { setSubmitting(false) }
  }

  if (loading) return <div className="max-w-[540px] mx-auto px-4 py-10 text-center text-text-gray text-sm">Loading…</div>
  if (!order) return <div className="max-w-[540px] mx-auto px-4 py-10 text-center text-text-gray text-sm">Delivery not found.</div>

  const itemCount = (order.orderItems ?? []).reduce((s, i) => s + i.quantity, 0)

  return (
    <div className="max-w-[540px] mx-auto px-4 py-6 space-y-4 pb-28">
      <Link href={`/runner/${fairSlug}/dashboard`} className="inline-flex items-center gap-1.5 text-sm text-text-gray hover:text-white transition-colors">
        <ChevronLeft className="w-4 h-4" /> Dashboard
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-bebas text-3xl tracking-wide text-white leading-tight">Active <span className="text-neon-pink">Delivery</span></h1>
          <p className="text-text-gray text-sm">#{order.id.slice(-8).toUpperCase()} · {order.customerName}</p>
        </div>
        <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20">{FULFILLMENT_LABEL[order.fulfillmentType]}</span>
      </div>

      {/* Step 1: pick up from the vendor */}
      <div className={`bg-bg-card border rounded-2xl p-4 ${pickedUp ? 'border-emerald-500/30' : 'border-white/10'}`}>
        <button onClick={() => setPickedUp(v => !v)} className="flex items-start gap-3 w-full text-left bg-transparent border-0 cursor-pointer">
          {pickedUp ? <CheckSquare className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" /> : <Square className="w-5 h-5 text-text-gray mt-0.5 shrink-0" />}
          <div className="flex-1">
            <p className={`font-semibold text-sm ${pickedUp ? 'text-text-gray line-through' : 'text-white'}`}>
              Collect from {order.vendor?.name ?? 'vendor'}{order.vendor?.boothNumber ? ` · Booth ${order.vendor.boothNumber}` : ''}
            </p>
            <div className="mt-1 space-y-0.5">
              {(order.orderItems ?? []).map(i => <p key={i.id} className="text-text-gray text-xs">{i.quantity}× {i.menuItem?.name ?? 'Item'}</p>)}
            </div>
          </div>
        </button>
      </div>

      {/* Step 2: deliver */}
      <div className={`bg-bg-card border rounded-2xl p-5 space-y-4 transition-all ${pickedUp ? 'border-neon-pink/30' : 'border-white/10 opacity-50'}`}>
        <div className="flex items-center gap-1.5 text-sm text-white"><Phone className="w-3.5 h-3.5 text-text-gray" />{order.customerPhone}</div>

        {order.fulfillmentType === 'CURBSIDE' && (
          <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
            <Car className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div><p className="text-white font-semibold text-sm">{order.vehicleColor} {order.vehicleMake}</p>
              {order.vehiclePlate && <p className="text-text-gray text-xs">Plate: {order.vehiclePlate}</p>}
              {order.pickupLocation && <p className="text-text-gray text-xs mt-0.5">Zone: {order.pickupLocation}</p>}</div>
          </div>
        )}
        {order.fulfillmentType === 'HOME_DELIVERY' && order.deliveryStreet && (
          <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl p-3">
            <MapPin className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            <div><p className="text-white font-semibold text-sm">{order.deliveryStreet}</p>
              <p className="text-text-gray text-xs">{order.deliveryCity}, {order.deliveryZip}</p>
              <a href={`https://maps.google.com/?q=${encodeURIComponent(`${order.deliveryStreet}, ${order.deliveryCity}`)}`} target="_blank" rel="noopener noreferrer" className="text-neon-pink text-xs mt-1 inline-block hover:underline">Open Maps</a></div>
          </div>
        )}

        <div className="border-t border-white/5 pt-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-text-gray text-sm"><Package className="w-4 h-4" />{itemCount} items · ${(order.total ?? 0).toFixed(2)}</span>
          <span className="text-emerald-400 text-sm font-semibold">+${(order.deliveryFee ?? 0).toFixed(2)} fee</span>
        </div>

        {/* Proof-of-delivery photo (required by the status route) */}
        <div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={!pickedUp || uploading}
            className={`w-full h-11 rounded-xl font-semibold text-sm border flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 ${photoUrl ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-white/5 border-white/10 text-white'}`}>
            <Camera className="w-4 h-4" />{uploading ? 'Uploading…' : photoUrl ? 'Photo attached ✓ — retake' : 'Take proof-of-delivery photo'}
          </button>
        </div>
      </div>

      <button onClick={confirmDelivery} disabled={!pickedUp || !photoUrl || submitting}
        className="w-full py-4 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border-0">
        {submitting ? 'Confirming…' : !pickedUp ? 'Collect the order first' : !photoUrl ? 'Add a delivery photo' : 'Confirm Delivery Complete'}
      </button>
    </div>
  )
}
