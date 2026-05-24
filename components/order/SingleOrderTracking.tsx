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
import { TERMINAL_STATUSES, getMapEmbedUrl, formatDate } from './helpers'
import type { OrderTrackingProps } from './types'

// Computed directly from liveStatus so the badge is always in sync with the
// vendor pill and progress bar — no delegation to a shared STATUS_LABELS map.
const BADGE_LABEL: Record<string, string> = {
  PLACED:           'Order Placed',
  ACCEPTED:         'Accepted',
  PREPARING:        'Preparing',
  READY:            'Ready for Pickup',
  RUNNER_COLLECTED: 'Ready for Pickup',
  COMPLETED:        'Completed',
  DELIVERED:        'Completed',
  CANCELLED:        'Cancelled',
  UNCOLLECTED:      'Uncollected',
  UNDELIVERABLE:    'Undeliverable',
}

const BADGE_COLOR: Record<string, string> = {
  PLACED:           'text-amber-400 bg-amber-400/10 border-amber-400/20',
  ACCEPTED:         'text-blue-400 bg-blue-400/10 border-blue-400/20',
  PREPARING:        'text-blue-400 bg-blue-400/10 border-blue-400/20',
  READY:            'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  RUNNER_COLLECTED: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  COMPLETED:        'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  DELIVERED:        'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  CANCELLED:        'text-red-400 bg-red-400/10 border-red-400/20',
  UNCOLLECTED:      'text-red-400 bg-red-400/10 border-red-400/20',
  UNDELIVERABLE:    'text-red-400 bg-red-400/10 border-red-400/20',
}

// Same mapping used by SingleVendorProgress — defined here too so badge and
// bar always reference the identical variable.
const PROGRESS_PERCENT: Record<string, number> = {
  PENDING_PAYMENT:  10,
  PLACED:           10,
  ACCEPTED:         33,
  PREPARING:        55,
  READY:            80,
  RUNNER_COLLECTED: 80,
  COMPLETED:        100,
  DELIVERED:        100,
  CANCELLED:        0,
  UNCOLLECTED:      0,
  UNDELIVERABLE:    0,
}

export default function SingleOrderTracking({
  order,
  liveStatus,
  fairSlug,
  cancelling,
  showCancelModal,
  setShowCancelModal,
  showSupportModal,
  setShowSupportModal,
  onCancel,
  onOrderAgain,
}: OrderTrackingProps) {
  // Multi-vendor works because it reads order.vendorOrderStatuses (updated by
  // setOrder). Mirror that here: prefer vendorOrderStatuses[0] so this uses
  // the same update path, falling back to liveStatus if the row isn't present.
  const vendorStatus = order.vendorOrderStatuses?.[0]?.status ?? liveStatus

  console.log('[SingleOrderTracking] liveStatus:', liveStatus, '| vendorStatus:', vendorStatus)

  const isCancelled     = TERMINAL_STATUSES.includes(vendorStatus)
  const isCompleted     = vendorStatus === 'COMPLETED' || vendorStatus === 'DELIVERED'
  const canCancel       = vendorStatus === 'PLACED'
  const mapSrc          = getMapEmbedUrl(order)
  const runnerLocation: { lat: number; lng: number } | null = null

  // Badge, bar, and pill all derive from the same vendorStatus variable.
  const badgeLabel    = BADGE_LABEL[vendorStatus]   ?? vendorStatus
  const badgeColor    = BADGE_COLOR[vendorStatus]   ?? 'text-[#A1A1A1] bg-white/5 border-white/10'
  const progressWidth = `${PROGRESS_PERCENT[vendorStatus] ?? 10}%`

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
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${badgeColor}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                {badgeLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6">
          <div className="mb-4">
            <SingleVendorProgress
              vendorName={order.vendor.name}
              status={vendorStatus}
              progressWidth={progressWidth}
            />
          </div>

          <StatusBanner order={order} status={vendorStatus} />

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
                        order.fulfillmentType === 'HOME_DELIVERY' && liveStatus === 'READY'
                          ? 'Awaiting runner location…'
                          : 'Order location'
                      )}
                    </div>
                  </div>
                </div>
              )}

              <OrderItemsCard order={order} isMultiVendor={false} />

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

            <OrderMetaCard order={order} isMultiVendor={false} />
          </div>
        </div>
      </div>

      <CancelModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={onCancel}
        loading={cancelling}
        orderStatus={liveStatus}
      />
      <SupportModal
        isOpen={showSupportModal}
        onClose={() => setShowSupportModal(false)}
        order={order}
      />
    </>
  )
}
