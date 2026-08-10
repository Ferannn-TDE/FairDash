'use client'

import Link from 'next/link'
import {
  ChatBubbleLeftEllipsisIcon,
  XMarkIcon,
  LockClosedIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'
import {
  SingleVendorProgress,
  StatusBanner,
  OrderItemsCard,
  OrderMetaCard,
  CancelModal,
  SupportModal,
} from './OrderComponents'
import { getMapEmbedUrl, formatDate } from './helpers'
import type { OrderTrackingProps } from './types'
import { StatusPill } from '@/components/ui/StatusPill'
import { DeliverySegmentBar, DeliveryStatusLine, DriverCard } from './DeliveryTracking'

export default function SingleOrderTracking({
  order,
  view,
  fairSlug,
  cancelling,
  locationSlot,
  showCancelModal,
  setShowCancelModal,
  showSupportModal,
  setShowSupportModal,
  onCancel,
  onOrderAgain,
}: OrderTrackingProps) {
  // EVERY status question this view asks is answered by the one derivation. It used to
  // read vendorOrderStatuses[0] (positional, unfiltered — B3) with a liveStatus fallback,
  // then hand-roll isCancelled / isCompleted / canCancel on top of it. Three of those four
  // reads disagreed with the other tracking view about the same order.
  const { displayStatus, isCancelled, isCompleted, canCancel, isRunnerOrder } = view
  const progress = view.delivery
  const mapSrc   = getMapEmbedUrl(order)
  const runnerLocation: { lat: number; lng: number } | null = null

  return (
    <>
      <div className="min-h-screen pb-16">
        {/* Page header */}
        <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-8 md:py-6 border-b border-white/10">
          <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8">
            <nav className="flex items-center gap-2 mb-4 text-sm">
              <Link href={`/fair/${fairSlug}/orders`} className="text-[#A1A1A1] hover:text-white transition-colors">
                My Orders
              </Link>
              <span className="text-white/20">›</span>
              <span className="text-white">Order #{order.id.slice(-8).toUpperCase()}</span>
            </nav>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="font-bebas text-[clamp(1.75rem,4vw,2.5rem)] tracking-[0.125rem] leading-none mb-1">
                  Track Order
                </h1>
                <p className="text-[#A1A1A1] text-sm">
                  #{order.id.slice(-8).toUpperCase()} · {order.vendor.name} · {formatDate(order.placedAt)}
                </p>
              </div>
              {/* Runner orders: the segment bar + status line are the ONLY indicators —
                  no pill, so a second reader can't disagree with the bar again. */}
              {!isRunnerOrder && <StatusPill status={displayStatus} />}
            </div>
          </div>
        </div>

        {/* Live runner map — directly under the header, so the page reads
            Track Order → where it is → the rest. */}
        {locationSlot && (
          <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 pt-6">{locationSlot}</div>
        )}

        <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6">
          <div className="mb-4 space-y-4">
            {/* `progress` is non-null exactly when isRunnerOrder — branching on it directly
                keeps the two facts from being asserted separately. */}
            {progress ? (
              <>
                <DeliverySegmentBar progress={progress} />
                <DeliveryStatusLine progress={progress} />
                <DriverCard order={order} />
              </>
            ) : (
              <>
                <SingleVendorProgress
                  vendorName={order.vendor.name}
                  status={displayStatus}
                />
                <StatusBanner order={order} status={displayStatus} />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-5">
            <div className="flex flex-col gap-5">
              {!isCancelled && mapSrc && (
                <div className="hidden lg:block bg-[#1A1A1A] border border-white/5 rounded-2xl overflow-hidden">
                  <div className="relative w-full h-64 md:h-48">
                    <iframe
                      title="Order location"
                      src={runnerLocation != null
                        ? `https://maps.google.com/maps?q=${(runnerLocation as {lat:number;lng:number}).lat},${(runnerLocation as {lat:number;lng:number}).lng}&output=embed&hl=en&z=16`
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
                        order.fulfillmentType === 'HOME_DELIVERY' && displayStatus === 'READY'
                          ? 'Awaiting runner location…'
                          : 'Order location'
                      )}
                    </div>
                  </div>
                </div>
              )}

              <OrderItemsCard order={order} view={view} isMultiVendor={false} />

              {!isCompleted && !isCancelled && (
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowSupportModal(true)}
                    className="flex items-center justify-center gap-2 flex-1 py-3 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors cursor-pointer active:scale-[0.97]"
                  >
                    <ChatBubbleLeftEllipsisIcon className="w-4 h-4" />
                    Contact Support
                  </button>
                  {canCancel ? (
                    <button
                      onClick={() => setShowCancelModal(true)}
                      className="flex items-center justify-center gap-2 flex-1 py-3 bg-transparent border-2 border-red-500/40 text-red-400 rounded-xl text-sm font-semibold hover:bg-red-500/10 hover:border-red-500/60 transition-all cursor-pointer active:scale-[0.97]"
                    >
                      <XMarkIcon className="w-4 h-4" />
                      Cancel Order
                    </button>
                  ) : (
                    <div className="flex items-center justify-center gap-2 flex-1 py-3 rounded-xl border border-white/10 text-white/30 text-sm cursor-not-allowed">
                      <LockClosedIcon className="w-4 h-4" />
                      Cannot cancel — vendor is preparing
                    </div>
                  )}
                </div>
              )}

              {isCompleted && (
                <div className="flex gap-3">
                  <button
                    onClick={onOrderAgain}
                    className="flex items-center justify-center gap-2 flex-1 py-3 bg-[#FF0077] text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)] active:scale-[0.97] cursor-pointer"
                  >
                    Order Again
                  </button>
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

            <OrderMetaCard order={order} view={view} isMultiVendor={false} />
          </div>
        </div>
      </div>

      <CancelModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={onCancel}
        loading={cancelling}
        needsApproval={!canCancel}
      />
      <SupportModal
        isOpen={showSupportModal}
        onClose={() => setShowSupportModal(false)}
        order={order}
        view={view}
      />
    </>
  )
}
