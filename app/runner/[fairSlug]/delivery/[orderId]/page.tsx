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
  collectedAt?: string | null
  returnRequestedAt?: string | null
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
  const [collecting, setCollecting] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [requesting, setRequesting] = useState(false)
  // Live-location share (Phase 1): 'sharing' once a fix has POSTed OK.
  const [geoStatus, setGeoStatus] = useState<'off' | 'sharing' | 'denied' | 'unavailable'>('off')
  const [lastSharedAt, setLastSharedAt] = useState<number | null>(null)
  // The Supabase object PATH of the uploaded proof (private bucket) — never a URL.
  const [proofPath, setProofPath] = useState<string | null>(null)
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
        // pickedUp reflects the SERVER truth (collectedAt persisted), not local taps — so a
        // reload/reconnect mid-delivery restores the real collected state. DELIVERED implies it.
        setPickedUp(o?.collectedAt != null || o?.status === 'DELIVERED')
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

  // LIVE LOCATION CAPTURE — while this order is RUNNER_COLLECTED (active delivery),
  // watch GPS and POST each fix to the server, which relays it to the customer.
  // The server independently re-verifies ownership + state on every write; this is
  // just the client feeding it. No wake lock yet (Phase 2) — hence the on-screen note.
  useEffect(() => {
    if (!order || order.status !== 'RUNNER_COLLECTED') return
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoStatus('unavailable')
      return
    }

    let cancelled = false
    async function post(pos: GeolocationPosition) {
      try {
        const res = await fetch('/api/runners/me/location', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
          }),
        })
        if (!cancelled && res.ok) { setGeoStatus('sharing'); setLastSharedAt(Date.now()) }
      } catch { /* transient network drop — watchPosition keeps firing */ }
    }

    const watchId = navigator.geolocation.watchPosition(
      pos => { if (!cancelled) post(pos) },
      err => {
        if (cancelled) return
        setGeoStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )

    return () => { cancelled = true; navigator.geolocation.clearWatch(watchId) }
  }, [order?.status])

  // The REAL collect action (U1). Optimism is DELIBERATELY withheld: pickedUp flips only on a
  // confirmed server success, so a failure leaves the checkbox HONEST (unchecked) and the
  // runner can retry — never optimistically stuck "collected" while the bag is still on the
  // counter. The endpoint is idempotent, so a retry after a lost-but-succeeded response is a
  // benign no-op (alreadyCollected), not a double-collect.
  async function collect() {
    if (!order || pickedUp || collecting) return
    setCollecting(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/collect`, { method: 'POST' })
      const json = await res.json()
      if (res.ok && json.success) {
        setPickedUp(true)
        setOrder(o => (o ? { ...o, collectedAt: json.data.collectedAt ?? new Date().toISOString() } : o))
        if (!json.data.alreadyCollected) toast.success('Collected from vendor')
      } else {
        toast.error(json.error || json.message || 'Could not mark collected — try again')
      }
    } catch {
      toast.error('Could not mark collected — check your connection and retry')
    } finally {
      setCollecting(false)
    }
  }

  // PRE-collection release (U2): hand a claimed-but-not-collected order back to the pool. Valid
  // only before collection — once collected, handing it back needs the vendor-confirmed return
  // (U3), and the server refuses a release on a collected order. On success the order is no
  // longer yours, so leave the screen.
  async function release() {
    if (!order || pickedUp || releasing) return
    if (!window.confirm('Release this delivery back to the pool? Another runner can then claim it.')) return
    setReleasing(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/release`, { method: 'POST' })
      const json = await res.json()
      if (res.ok && json.success) {
        toast.success('Released back to the pool')
        router.push(`/runner/${fairSlug}/dashboard`)
      } else {
        toast.error(json.error || json.message || 'Could not release — try again')
      }
    } catch {
      toast.error('Could not release — check your connection and retry')
    } finally {
      setReleasing(false)
    }
  }

  // POST-collection return (U3): the runner has the bag but can't deliver. Ask the vendor to
  // take it back — the order moves back to the pool only when the VENDOR confirms. Optimism
  // withheld: the banner flips only on a confirmed server success (returnRequestedAt is server
  // truth), so a failure stays retryable, never a false "return requested".
  async function requestReturn() {
    if (!order || !pickedUp || order.returnRequestedAt || requesting) return
    if (!window.confirm('Ask the vendor to take this order back? You keep the food until they confirm.')) return
    setRequesting(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/request-return`, { method: 'POST' })
      const json = await res.json()
      if (res.ok && json.success) {
        setOrder(o => (o ? { ...o, returnRequestedAt: json.data.returnRequestedAt ?? new Date().toISOString() } : o))
        toast.success('Return requested — waiting for the vendor to confirm')
      } else {
        toast.error(json.error || json.message || 'Could not request a return — try again')
      }
    } catch {
      toast.error('Could not request a return — check your connection and retry')
    } finally {
      setRequesting(false)
    }
  }

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
      // PUT to the signed upload url — token is in the url (no Authorization header);
      // x-upsert lets a retake overwrite the same object.
      const put = await fetch(sign.data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type, 'x-upsert': 'true' },
        body: file,
      })
      if (!put.ok) { toast.error('Photo upload failed'); return }
      // Store the PATH, not a URL — the bucket is private; reads resolve a signed url later.
      setProofPath(sign.data.path)
      toast.success('Photo attached')
    } catch { toast.error('Photo upload failed') } finally { setUploading(false) }
  }

  async function confirmDelivery() {
    if (!order) return
    if (!proofPath) { toast.error('Take a proof-of-delivery photo first'); return }
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
          status: 'DELIVERED', proofPath,
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

      {/* Live-location share status (Phase 1: no wake lock — keep-screen-on note) */}
      {order.status === 'RUNNER_COLLECTED' && (
        <div className={`rounded-2xl p-3 border text-sm flex items-start gap-2.5 ${
          geoStatus === 'sharing' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
          : geoStatus === 'denied' ? 'bg-red-500/10 border-red-500/20 text-red-300'
          : geoStatus === 'unavailable' ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
          : 'bg-white/5 border-white/10 text-text-gray'
        }`}>
          <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            {geoStatus === 'sharing' && (
              <p className="font-semibold">Sharing your location with the customer
                {lastSharedAt && <span className="font-normal text-emerald-400/80"> · updated {Math.max(0, Math.round((Date.now() - lastSharedAt) / 1000))}s ago</span>}
              </p>
            )}
            {geoStatus === 'denied' && <p className="font-semibold">Location permission needed to share your position. Enable location for this site in your browser settings, then reload.</p>}
            {geoStatus === 'unavailable' && <p className="font-semibold">Location is unavailable on this device right now.</p>}
            {geoStatus === 'off' && <p className="font-semibold">Starting location sharing…</p>}
            <p className="text-xs mt-0.5 opacity-80">Keep this screen on — sharing pauses if your phone sleeps.</p>
          </div>
        </div>
      )}

      {/* Step 1: pick up from the vendor */}
      <div className={`bg-bg-card border rounded-2xl p-4 ${pickedUp ? 'border-emerald-500/30' : 'border-white/10'}`}>
        <button onClick={collect} disabled={pickedUp || collecting} className="flex items-start gap-3 w-full text-left bg-transparent border-0 cursor-pointer disabled:cursor-default">
          {pickedUp ? <CheckSquare className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" /> : <Square className="w-5 h-5 text-text-gray mt-0.5 shrink-0" />}
          <div className="flex-1">
            <p className={`font-semibold text-sm ${pickedUp ? 'text-text-gray line-through' : 'text-white'}`}>
              Collect from {order.vendor?.name ?? 'vendor'}{order.vendor?.boothNumber ? ` · Booth ${order.vendor.boothNumber}` : ''}
            </p>
            <div className="mt-1 space-y-0.5">
              {(order.orderItems ?? []).map(i => <p key={i.id} className="text-text-gray text-xs">{i.quantity}× {i.menuItem?.name ?? 'Item'}</p>)}
            </div>
            {collecting && <p className="text-text-gray text-xs mt-1">Marking collected…</p>}
          </div>
        </button>
      </div>

      {/* Pre-collection escape: hand it back to the pool (only before you've collected). */}
      {!pickedUp && (
        <button
          onClick={release}
          disabled={releasing}
          className="w-full text-center text-xs text-text-gray hover:text-white transition-colors bg-transparent border-0 disabled:opacity-50 cursor-pointer"
        >
          {releasing ? 'Releasing…' : "Can't take this? Release it back to the pool"}
        </button>
      )}

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
            className={`w-full h-11 rounded-xl font-semibold text-sm border flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 ${proofPath ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-white/5 border-white/10 text-white'}`}>
            <Camera className="w-4 h-4" />{uploading ? 'Uploading…' : proofPath ? 'Photo attached ✓ — retake' : 'Take proof-of-delivery photo'}
          </button>
        </div>
      </div>

      {order.returnRequestedAt ? (
        <div className="w-full bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-center">
          <p className="text-amber-400 font-semibold text-sm">Return requested — waiting for the vendor to confirm</p>
          <p className="text-text-gray text-xs mt-0.5">Hand the food back to {order.vendor?.name ?? 'the vendor'}. Once they confirm it&apos;s returned, this order goes back to the pool.</p>
        </div>
      ) : (
        <button onClick={confirmDelivery} disabled={!pickedUp || !proofPath || submitting}
          className="w-full py-4 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border-0">
          {submitting ? 'Confirming…' : !pickedUp ? 'Collect the order first' : !proofPath ? 'Add a delivery photo' : 'Confirm Delivery Complete'}
        </button>
      )}

      {/* Post-collection escape: can't deliver → ask the vendor to take it back (U3). */}
      {pickedUp && !order.returnRequestedAt && (
        <button onClick={requestReturn} disabled={requesting}
          className="w-full text-center text-xs text-text-gray hover:text-white transition-colors bg-transparent border-0 disabled:opacity-50 cursor-pointer">
          {requesting ? 'Requesting…' : "Can't deliver? Ask the vendor to take it back"}
        </button>
      )}
    </div>
  )
}
