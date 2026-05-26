'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Car, MapPin, Phone, CheckSquare, Square, Package } from 'lucide-react'
import { mockDeliveryRequest } from '@/lib/mock/runner'

const FULFILLMENT_LABEL: Record<string, string> = {
  CURBSIDE:      'Curbside',
  HOME_DELIVERY: 'Home Delivery',
  BOOTH_PICKUP:  'Booth Pickup',
}

export default function DeliveryPage() {
  const params = useParams()
  const router = useRouter()
  const fairSlug = params.fairSlug as string

  const order = mockDeliveryRequest

  const [collected, setCollected] = useState<Record<string, boolean>>(
    Object.fromEntries(order.vendorStops.map((v) => [v.vendorId, false]))
  )
  const [delivered, setDelivered] = useState(false)

  const allCollected = Object.values(collected).every(Boolean)

  const toggleCollected = (vendorId: string) => {
    setCollected((prev) => ({ ...prev, [vendorId]: !prev[vendorId] }))
  }

  const handleConfirmDelivery = () => {
    setDelivered(true)
    setTimeout(() => router.push(`/runner/${fairSlug}/dashboard`), 1500)
  }

  return (
    <div className="max-w-[540px] mx-auto px-4 py-6 space-y-4">

      {/* Back */}
      <Link
        href={`/runner/${fairSlug}/dashboard`}
        className="inline-flex items-center gap-1.5 text-sm text-text-gray hover:text-white transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Dashboard
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-bebas text-3xl tracking-wide text-white leading-tight">
            Active <span className="text-neon-pink">Delivery</span>
          </h1>
          <p className="text-text-gray text-sm">#{order.id.slice(-8).toUpperCase()} · {order.customerName}</p>
        </div>
        <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20">
          {FULFILLMENT_LABEL[order.fulfillmentType]}
        </span>
      </div>

      {/* Step 1: Collect from vendors */}
      <div className={`bg-bg-card border rounded-2xl overflow-hidden transition-colors ${
        allCollected ? 'border-emerald-500/30' : 'border-white/10'
      }`}>
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              allCollected ? 'bg-emerald-500 text-white' : 'bg-neon-pink text-white'
            }`}>
              {allCollected ? '✓' : '1'}
            </div>
            <h2 className="font-bebas text-lg tracking-wide text-white">Collect from Vendors</h2>
          </div>
          <span className="text-xs text-text-gray">
            {Object.values(collected).filter(Boolean).length}/{order.vendorStops.length}
          </span>
        </div>

        <div className="divide-y divide-white/5">
          {order.vendorStops.map((stop) => {
            const isDone = collected[stop.vendorId]
            return (
              <div key={stop.vendorId} className={`p-4 transition-colors ${isDone ? 'bg-emerald-500/[0.04]' : ''}`}>
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggleCollected(stop.vendorId)}
                    className="mt-0.5 shrink-0 cursor-pointer bg-transparent border-0"
                  >
                    {isDone
                      ? <CheckSquare className="w-5 h-5 text-emerald-400" />
                      : <Square className="w-5 h-5 text-text-gray" />}
                  </button>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className={`font-semibold text-sm ${isDone ? 'line-through text-text-gray' : 'text-white'}`}>
                        {stop.vendorName}
                      </p>
                      <span className="text-xs text-text-gray bg-white/5 px-2 py-0.5 rounded-full">
                        Booth {stop.boothNumber}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {stop.items.map((item, i) => (
                        <p key={i} className="text-text-gray text-xs">
                          {item.quantity}× {item.name}
                        </p>
                      ))}
                    </div>
                  </div>
                  {isDone && (
                    <span className="shrink-0 text-[0.625rem] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                      Collected
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Step 2: Deliver */}
      <div className={`bg-bg-card border rounded-2xl overflow-hidden transition-all ${
        allCollected ? 'border-neon-pink/30 opacity-100' : 'border-white/10 opacity-50'
      }`}>
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            allCollected ? 'bg-neon-pink text-white' : 'bg-white/10 text-text-gray'
          }`}>2</div>
          <h2 className="font-bebas text-lg tracking-wide text-white">Deliver to Customer</h2>
        </div>

        <div className="p-5 space-y-4">
          {/* Customer info */}
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-1.5 text-sm text-white">
              <Phone className="w-3.5 h-3.5 text-text-gray" />
              {order.customerPhone}
            </div>
          </div>

          {/* Fulfillment details */}
          {order.fulfillmentType === 'CURBSIDE' && (
            <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
              <Car className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-white font-semibold text-sm">{order.vehicleColor} {order.vehicleMake}</p>
                <p className="text-text-gray text-xs">Plate: {order.vehiclePlate}</p>
                <p className="text-text-gray text-xs mt-0.5">Zone: {order.curbsideZone}</p>
              </div>
            </div>
          )}

          {order.fulfillmentType === 'HOME_DELIVERY' && (
            <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl p-3">
              <MapPin className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-white font-semibold text-sm">{order.deliveryStreet}</p>
                <p className="text-text-gray text-xs">{order.deliveryCity}, {order.deliveryZip}</p>
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(`${order.deliveryStreet}, ${order.deliveryCity}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neon-pink text-xs mt-1 inline-block hover:underline"
                >
                  Open Maps
                </a>
              </div>
            </div>
          )}

          {/* Order summary */}
          <div className="border-t border-white/5 pt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-text-gray" />
              <span className="text-text-gray text-sm">
                {order.vendorStops.reduce((s, v) => s + v.items.reduce((a, i) => a + i.quantity, 0), 0)} items ·{' '}
                ${(order.total ?? 0).toFixed(2)}
              </span>
            </div>
            <span className="text-emerald-400 text-sm font-semibold">
              +${(order.deliveryFee ?? 0).toFixed(2)} fee
            </span>
          </div>
        </div>
      </div>

      {/* Confirm delivery */}
      {delivered ? (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 text-center">
          <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-3">
            <span className="text-white text-lg">✓</span>
          </div>
          <p className="text-emerald-400 font-semibold">Delivery complete!</p>
          <p className="text-text-gray text-xs mt-1">Redirecting to dashboard…</p>
        </div>
      ) : (
        <button
          onClick={handleConfirmDelivery}
          disabled={!allCollected}
          className="w-full py-4 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border-0"
        >
          {allCollected ? 'Confirm Delivery Complete' : `Collect all items first (${Object.values(collected).filter(Boolean).length}/${order.vendorStops.length})`}
        </button>
      )}

    </div>
  )
}
