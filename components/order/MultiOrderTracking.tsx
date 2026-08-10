'use client'

import Link from 'next/link'
import {
  ChatBubbleLeftEllipsisIcon,
  XMarkIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline'
import {
  MultiVendorSummaryHeader,
  StatusBanner,
  OrderItemsCard,
  OrderMetaCard,
  CancelModal,
  SupportModal,
} from './OrderComponents'
import { buildVendorGroups, formatDate } from './helpers'
import type { OrderTrackingProps } from './types'

export default function MultiOrderTracking({
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
  const vendorGroups = buildVendorGroups(order.orderItems)

  // ⚠️ THIS IS WHERE B1 LIVED. These three came from `liveStatus` — which the page set from
  // the customer RTDB node, a channel that also carries PER-VENDOR pushes. So one vendor
  // declining set liveStatus='DECLINED', TERMINAL_STATUSES.includes(...) went true, and the
  // customer's whole order rendered cancelled while the other vendor was still cooking.
  // deriveOrderView reads the master status and the lanes as separate things, so a single
  // failed lane can no longer speak for the order.
  const { displayStatus, isCancelled, isCompleted, canCancel } = view

  // Support modal: each vendor's own lane, keyed by vendorId (never positional).
  const supportVendors = vendorGroups.map(g => ({
    name: g.vendorName,
    status: view.perVendor.get(g.vendorId)?.status ?? 'PLACED',
  }))

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
                  #{order.id.slice(-8).toUpperCase()} · {vendorGroups.length} vendors · {formatDate(order.placedAt)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Live runner map — directly under the header, matching SingleOrderTracking. */}
        {locationSlot && (
          <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 pt-6">{locationSlot}</div>
        )}

        <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6">
          <div className="mb-4">
            <MultiVendorSummaryHeader
              vendorGroups={vendorGroups}
              perVendor={view.perVendor}
            />
          </div>

          <StatusBanner order={order} status={displayStatus} />

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-5">
            <div className="flex flex-col gap-5">
              <OrderItemsCard order={order} view={view} isMultiVendor={true} />

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

            <OrderMetaCard order={order} view={view} isMultiVendor={true} />
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
        vendors={supportVendors}
      />
    </>
  )
}
