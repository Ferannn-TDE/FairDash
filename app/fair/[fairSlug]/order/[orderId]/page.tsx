'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@clerk/clerk-react'
import Link from 'next/link'
import {
  CheckIcon,
  ClockIcon,
  MapPinIcon,
  XMarkIcon,
  LockClosedIcon,
  ExclamationTriangleIcon,
  ChatBubbleLeftEllipsisIcon,
  EnvelopeIcon,
  ReceiptPercentIcon,
  BuildingStorefrontIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import toast from 'react-hot-toast'
import { useFair } from '../../../../_contexts/FairContext'
import { useFairCart } from '../../../../_contexts/FairCartContext'
import Breadcrumb from '../../_components/Breadcrumb'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderItem {
  id: string
  menuItemId: string
  vendorId: string
  quantity: number
  unitPrice: number
  subtotal: number
  specialInstructions?: string | null
  menuItem: { name: string; imageUrl?: string | null; prepTime?: number | null }
  vendor: { id: string; name: string; boothNumber?: string | null }
}

interface VendorGroup {
  vendorId: string
  vendorName: string
  boothNumber?: string | null
  items: OrderItem[]
  subtotal: number
}

interface VendorOrderStatus {
  vendorId: string
  status: string
  acceptedAt?: string | null
  preparingAt?: string | null
  readyAt?: string | null
  completedAt?: string | null
  declinedAt?: string | null
  vendor?: { name: string } | null
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
  vendorOrderStatuses?: VendorOrderStatus[]
}

// ─── Status config ─────────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Order Placed', sublabel: 'Confirmed',   icon: ReceiptPercentIcon },
  { label: 'Preparing',    sublabel: 'In progress', icon: ClockIcon },
  { label: 'Ready',        sublabel: 'For pickup',  icon: BuildingStorefrontIcon },
  { label: 'Completed',    sublabel: 'All done!',   icon: CheckCircleIcon },
]

const VENDOR_STEPS = ['Placed', 'Accepted', 'Preparing', 'Ready']

const VENDOR_STATUS_TO_STEP: Record<string, number> = {
  PLACED:    0,
  ACCEPTED:  1,
  PREPARING: 2,
  READY:     3,
  COMPLETED: 4,
  DECLINED:  -1,
}

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

function buildVendorGroups(orderItems: OrderItem[]): VendorGroup[] {
  const map = new Map<string, VendorGroup>()
  for (const item of orderItems) {
    const vid = item.vendor?.id ?? item.vendorId
    if (!map.has(vid)) {
      map.set(vid, {
        vendorId: vid,
        vendorName: item.vendor?.name ?? 'Vendor',
        boothNumber: item.vendor?.boothNumber ?? null,
        items: [],
        subtotal: 0,
      })
    }
    const group = map.get(vid)!
    group.items.push(item)
    group.subtotal += item.unitPrice * item.quantity
  }
  return [...map.values()]
}

const VENDOR_STATUS_STYLES: Record<string, string> = {
  PLACED:    'text-amber-400 bg-amber-400/10 border-amber-400/20',
  ACCEPTED:  'text-amber-400 bg-amber-400/10 border-amber-400/20',
  PREPARING: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  READY:     'text-[#FF0077] bg-[#FF0077]/10 border-[#FF0077]/20',
  COMPLETED: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  DECLINED:  'text-red-400 bg-red-500/15 border-red-400/20',
}

const VENDOR_STATUS_LABELS: Record<string, string> = {
  PLACED:    'Waiting',
  ACCEPTED:  'Accepted',
  PREPARING: 'Preparing',
  READY:     'Ready',
  COMPLETED: 'Done',
  DECLINED:  'Cancelled',
}

function VendorStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${VENDOR_STATUS_STYLES[status] ?? 'text-[#A1A1A1] bg-white/5 border-white/10'}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {VENDOR_STATUS_LABELS[status] ?? status}
    </span>
  )
}

function VendorProgressSteps({ status }: { status: string }) {
  if (status === 'DECLINED') {
    return (
      <div className="flex items-center gap-1 mt-2">
        <div className="flex-1 h-0.5 rounded-full bg-red-400/30" />
      </div>
    )
  }
  const step = VENDOR_STATUS_TO_STEP[status] ?? 0
  const isCompleted = status === 'COMPLETED'
  return (
    <div className="flex items-center gap-px mt-2">
      {VENDOR_STEPS.map((_, idx) => {
        const filled = isCompleted || idx < step
        const active = !isCompleted && idx === step && step < VENDOR_STEPS.length
        return (
          <div
            key={idx}
            className={`flex-1 h-0.5 rounded-full transition-colors ${
              filled ? 'bg-[#FF0077]' : active ? 'bg-[#FF0077]/40' : 'bg-white/10'
            }`}
          />
        )
      })}
    </div>
  )
}

function VendorStatusMessage({ status, boothNumber }: { status: string; boothNumber?: string | null }) {
  const msg =
    status === 'PLACED'    ? 'Waiting for vendor to confirm…' :
    status === 'ACCEPTED'  ? 'Vendor accepted — preparing soon' :
    status === 'PREPARING' ? 'Being prepared now' :
    status === 'READY'     ? (boothNumber ? `Ready · collect from Booth ${boothNumber}` : 'Ready for pickup') :
    status === 'COMPLETED' ? 'Collected ✓' :
    status === 'DECLINED'  ? 'This vendor cancelled their portion' :
    status.toLowerCase()
  const color =
    status === 'PLACED'    ? 'text-amber-400/70' :
    status === 'ACCEPTED'  ? 'text-blue-400/70' :
    status === 'PREPARING' ? 'text-blue-400/70' :
    status === 'READY'     ? 'text-[#FF0077]/80' :
    status === 'COMPLETED' ? 'text-emerald-400/70' :
    status === 'DECLINED'  ? 'text-red-400/70' :
    'text-[#A1A1A1]'
  return <p className={`text-[0.6875rem] mt-1 ${color}`}>{msg}</p>
}

function MultiVendorSummaryHeader({
  vendorGroups,
  vendorStatuses,
}: {
  vendorGroups: VendorGroup[]
  vendorStatuses: VendorOrderStatus[]
}) {
  const getStatus = (vid: string) => vendorStatuses.find(s => s.vendorId === vid)?.status ?? 'PLACED'
  const statuses = vendorGroups.map(g => getStatus(g.vendorId))

  const allCompleted  = statuses.every(s => s === 'COMPLETED')
  const allDeclined   = statuses.every(s => s === 'DECLINED')
  const allTerminal   = statuses.every(s => ['COMPLETED', 'DECLINED'].includes(s))
  const readyCount    = statuses.filter(s => ['READY', 'COMPLETED'].includes(s)).length
  const hasReady      = statuses.some(s => s === 'READY')

  const aggregateLabel =
    allCompleted  ? 'All Done' :
    allDeclined   ? 'Cancelled' :
    allTerminal   ? 'Partially Done' :
    readyCount > 0 && readyCount < vendorGroups.length ? `${readyCount} of ${vendorGroups.length} Ready` :
    hasReady      ? 'Ready' :
    'In Progress'

  const aggregateColor =
    allCompleted              ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
    allDeclined               ? 'text-red-400 bg-red-400/10 border-red-400/20' :
    allTerminal               ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
    (hasReady || readyCount > 0) ? 'text-[#FF0077] bg-[#FF0077]/10 border-[#FF0077]/20' :
    'text-amber-400 bg-amber-400/10 border-amber-400/20'

  return (
    <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold">
          {vendorGroups.length} Vendors
        </p>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${aggregateColor}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          {aggregateLabel}
        </span>
      </div>
      <div className="space-y-3.5">
        {vendorGroups.map(group => {
          const vs = getStatus(group.vendorId)
          const step = VENDOR_STATUS_TO_STEP[vs] ?? 0
          const isCompleted = vs === 'COMPLETED'
          const isDeclined  = vs === 'DECLINED'
          const dotColor =
            isCompleted ? 'bg-emerald-400' :
            isDeclined  ? 'bg-red-400' :
            vs === 'READY' ? 'bg-[#FF0077] shadow-[0_0_8px_rgba(255,0,119,0.5)]' :
            vs === 'PREPARING' ? 'bg-blue-400 animate-pulse' :
            'bg-amber-400/60'

          return (
            <div key={group.vendorId} className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white text-sm font-medium truncate">{group.vendorName}</span>
                  <VendorStatusBadge status={vs} />
                </div>
                {isDeclined ? (
                  <div className="mt-1.5 h-0.5 rounded-full bg-red-400/20" />
                ) : (
                  <div className="flex items-center gap-px mt-1.5">
                    {VENDOR_STEPS.map((_, idx) => (
                      <div
                        key={idx}
                        className={`flex-1 h-0.5 rounded-full transition-colors ${
                          isCompleted || idx < step ? 'bg-[#FF0077]' :
                          idx === step ? 'bg-[#FF0077]/40' :
                          'bg-white/10'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OrderItemsCard({ order }: { order: Order }) {
  const groups = buildVendorGroups(order.orderItems)
  const isMultiVendor = groups.length > 1

  return (
    <div className="space-y-3">
      {/* Vendor sections */}
      {groups.map(group => {
        const vendorStatus = order.vendorOrderStatuses?.find(
          s => s.vendorId === group.vendorId
        )?.status ?? order.status

        return (
        <div key={group.vendorId} className="bg-[#1A1A1A] border border-white/5 rounded-2xl overflow-hidden">
          {/* Vendor header */}
          <div className="px-5 py-3.5 border-b border-white/5 bg-white/[0.02]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <BuildingStorefrontIcon className="w-4 h-4 text-[#FF0077] flex-shrink-0" />
                <span className="text-white font-semibold text-sm uppercase tracking-wide truncate">
                  {group.vendorName}
                </span>
                {group.boothNumber && (
                  <span className="text-[#A1A1A1] text-xs flex-shrink-0">· Booth {group.boothNumber}</span>
                )}
              </div>
              <VendorStatusBadge status={vendorStatus} />
            </div>
            {isMultiVendor && (
              <>
                <VendorProgressSteps status={vendorStatus} />
                <VendorStatusMessage status={vendorStatus} boothNumber={group.boothNumber} />
              </>
            )}
          </div>

          {/* Items */}
          <div className="px-5 py-2 divide-y divide-white/5">
            {group.items.map(item => (
              <div key={item.id} className="flex items-center gap-3 py-3">
                {item.menuItem.imageUrl ? (
                  <img src={item.menuItem.imageUrl} alt={item.menuItem.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-white/5" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                    <BuildingStorefrontIcon className="w-5 h-5 text-white/20" />
                  </div>
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

          {/* Per-vendor subtotal (only shown for multi-vendor) */}
          {isMultiVendor && (
            <div className="px-5 py-3 border-t border-white/5 flex justify-between bg-white/[0.01]">
              <span className="text-[#A1A1A1] text-xs">
                {group.items.length} item{group.items.length !== 1 ? 's' : ''} · vendor subtotal
              </span>
              <span className="text-white text-sm font-medium">${group.subtotal.toFixed(2)}</span>
            </div>
          )}
        </div>
        )
      })}

      {/* Overall totals */}
      <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl px-5 py-4 space-y-2">
        {!isMultiVendor && (
          <p className="text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold mb-3">Order Total</p>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-[#A1A1A1]">Subtotal</span>
          <span className="text-white">${order.subtotal.toFixed(2)}</span>
        </div>
        {(order.deliveryFee ?? 0) > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-[#A1A1A1]">Delivery Fee</span>
            <span className="text-white">${order.deliveryFee!.toFixed(2)}</span>
          </div>
        )}
        {(order.serviceCharge ?? 0) > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-[#A1A1A1]">Event Service Charge</span>
            <span className="text-white">${order.serviceCharge!.toFixed(2)}</span>
          </div>
        )}
        {order.fairSynqFee > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-[#A1A1A1]">Platform Fee</span>
            <span className="text-white/60">${order.fairSynqFee.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold border-t border-white/5 pt-2 mt-1">
          <span className="text-white">Total</span>
          <span className="text-[#FF0077] text-base [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
            ${(order.total + order.fairSynqFee).toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}

function TimelineRow({
  label, time, small, green, red,
}: {
  label: string
  time: string | Date
  small?: boolean
  green?: boolean
  red?: boolean
}) {
  const d = new Date(time)
  const formatted =
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) +
    ' · ' +
    d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
  const textSize = small ? 'text-[0.6875rem]' : 'text-xs'
  const labelColor = green ? 'text-emerald-400' : red ? 'text-red-400' : 'text-white/60'
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`${textSize} ${labelColor}`}>{label}</span>
      <span className={`${textSize} text-white/30 flex-shrink-0`}>{formatted}</span>
    </div>
  )
}

function OrderMetaCard({ order }: { order: Order }) {
  const isDelivery = order.fulfillmentType === 'HOME_DELIVERY'
  const isCurbside = order.fulfillmentType === 'CURBSIDE'
  const hasAddress = isDelivery && order.deliveryStreet
  const vendorGroups = buildVendorGroups(order.orderItems)
  const isMultiVendor = vendorGroups.length > 1

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
          <p className="text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold mb-1">
            {isMultiVendor ? 'Vendors' : 'Vendor'}
          </p>
          <div className="space-y-1.5">
            {vendorGroups.map(group => (
              <div key={group.vendorId} className="flex items-center gap-2">
                <BuildingStorefrontIcon className="w-4 h-4 text-[#FF0077] flex-shrink-0" />
                <span className="text-white text-sm">{group.vendorName}</span>
                {group.boothNumber && (
                  <span className="text-[#A1A1A1] text-xs">· Booth {group.boothNumber}</span>
                )}
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold mb-1">Fulfillment</p>
          <p className="text-white text-sm">
            <span className="flex items-center gap-1.5">
              {isDelivery
                ? <><MapPinIcon className="w-4 h-4 inline" /> Home Delivery</>
                : isCurbside
                ? <><TruckIcon className="w-4 h-4 inline" /> Curbside</>
                : <><BuildingStorefrontIcon className="w-4 h-4 inline" /> Booth Pickup</>
              }
            </span>
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
            {/* Master placed event — always first */}
            <TimelineRow label="Order Placed" time={order.placedAt} />

            {isMultiVendor ? (
              // Per-vendor timeline groups
              <div className="mt-3 space-y-4">
                {(order.vendorOrderStatuses ?? []).map(vs => (
                  <div key={vs.vendorId}>
                    <p className="text-white/30 text-[0.625rem] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <BuildingStorefrontIcon className="w-3 h-3 flex-shrink-0" />
                      {vs.vendor?.name ?? vs.vendorId}
                    </p>
                    <div className="ml-3 pl-3 border-l border-white/[0.08] space-y-1.5">
                      {vs.acceptedAt  && <TimelineRow label="Accepted"        time={vs.acceptedAt}  small />}
                      {vs.preparingAt && <TimelineRow label="Preparing"        time={vs.preparingAt} small />}
                      {vs.readyAt     && <TimelineRow label="Ready for Pickup" time={vs.readyAt}     small />}
                      {vs.completedAt && <TimelineRow label="Completed"        time={vs.completedAt} small green />}
                      {vs.declinedAt  && <TimelineRow label="Cancelled"        time={vs.declinedAt}  small red />}
                      {vs.status === 'PLACED' && (
                        <p className="text-white/20 text-xs italic">Awaiting response…</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              // Single vendor — flat timeline
              <>
                {order.acceptedAt  && <TimelineRow label="Accepted"        time={order.acceptedAt} />}
                {order.readyAt     && <TimelineRow label="Ready for Pickup" time={order.readyAt} />}
                {order.completedAt && <TimelineRow label="Completed"        time={order.completedAt} green />}
                {order.cancelledAt && <TimelineRow label="Cancelled"        time={order.cancelledAt} red />}
              </>
            )}
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

function SupportModal({ isOpen, onClose, order }: {
  isOpen: boolean
  onClose: () => void
  order: Order
}) {
  if (!isOpen) return null

  const shortId = order.id.slice(-8).toUpperCase()
  const subject = encodeURIComponent(`Order #${shortId} — Support Request`)
  const body = encodeURIComponent(
    `Hi FairSynq Support,\n\nI need help with Order #${shortId} from ${order.vendor.name}.\n\nOrder ID: ${order.id}\nStatus: ${order.status}\nTotal: $${order.total.toFixed(2)}\n\nDescription of issue:\n`
  )

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
            <p className="text-[#A1A1A1] text-xs">Order #{shortId}</p>
          </div>
        </div>

        {/* Order context */}
        <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-3.5 mb-5 space-y-1.5">
          {[
            { label: 'Order', value: `#${shortId}` },
            { label: 'Vendor', value: order.vendor.name },
            { label: 'Status', value: order.status.charAt(0) + order.status.slice(1).toLowerCase() },
            { label: 'Total', value: `$${order.total.toFixed(2)}`, pink: true },
          ].map(({ label, value, pink }) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-[#A1A1A1]">{label}</span>
              <span className={pink ? 'text-[#FF0077] font-semibold' : 'text-white'}>{value}</span>
            </div>
          ))}
        </div>

        <p className="text-[#A1A1A1] text-xs leading-relaxed mb-4">
          Our team typically responds within a few hours. Your order ID is pre-filled in the email for faster support.
        </p>

        <div className="space-y-2">
          <a
            href={`mailto:support@fairsynq.com?subject=${subject}&body=${body}`}
            className="flex items-center gap-3 w-full p-3.5 bg-white/5 border border-white/10 rounded-xl no-underline hover:bg-white/10 hover:border-[#FF0077]/30 transition-all"
          >
            <EnvelopeIcon className="w-4 h-4 text-[#FF0077] shrink-0" />
            <div className="text-left">
              <p className="text-white text-sm font-medium">Email Support</p>
              <p className="text-[#A1A1A1] text-xs">support@fairsynq.com</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrderTrackingPage() {
  const params = useParams<{ fairSlug: string; orderId: string }>()
  const router = useRouter()
  const { isLoaded, isSignedIn } = useAuth()
  const { fair } = useFair()
  const { addItem, clearCart } = useFairCart()

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.replace(`/sign-in?redirect_url=/fair/${params.fairSlug}/order/${params.orderId}`)
    }
  }, [isLoaded, isSignedIn, params.fairSlug, params.orderId, router])

  // Initial fetch
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    setLoading(true)
    fetch(`/api/orders/${params.orderId}`)
      .then(r => r.json())
      .then(json => {
        if (json?.success) {
          setOrder(json.data)
        } else {
          setError('Order not found')
        }
      })
      .catch(() => setError('Failed to load order — please refresh'))
      .finally(() => setLoading(false))
  }, [params.orderId])

  // Firebase RTDB listener — updates status in real time when vendor advances the order.
  // Falls back to 10-second polling when Firebase is not configured.
  useEffect(() => {
    if (!order?.eventId || !order?.customerId) return
    const { eventId, customerId } = order
    const orderId = params.orderId
    const TERMINAL = new Set(['COMPLETED', 'DELIVERED', 'CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE'])

    // Firebase path written by PATCH /api/orders/:id/status
    const { getFirebaseApp } = require('@/lib/firebase-client')
    const app = getFirebaseApp()

    if (app) {
      let off: (() => void) | null = null
      import('firebase/database').then(({ getDatabase, ref, onValue, off: firebaseOff }) => {
        const db = getDatabase(app)
        const statusRef = ref(db, `fairs/${eventId}/customerOrders/${customerId}/${orderId}`)
        const handler = onValue(statusRef, snap => {
          const data = snap.val() as { status: string } | null
          if (data?.status) {
            setOrder(prev => prev ? { ...prev, status: data.status } : prev)
          }
        })
        off = () => firebaseOff(statusRef, 'value', handler)
      }).catch(() => {})
      return () => { off?.() }
    }

    // Polling fallback — every 10 seconds until terminal state
    const interval = setInterval(() => {
      setOrder(prev => {
        if (prev && TERMINAL.has(prev.status)) {
          clearInterval(interval)
          return prev
        }
        return prev
      })
      fetch(`/api/orders/${orderId}`)
        .then(r => r.json())
        .then(json => {
          if (json?.success) setOrder(json.data)
        })
        .catch(() => {})
    }, 10_000)

    return () => clearInterval(interval)
  }, [order?.eventId, order?.customerId, params.orderId])
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [showSupportModal, setShowSupportModal] = useState(false)
  const runnerLocation: { lat: number; lng: number } | null = null

  // ── Cancel handler ────────────────────────────────────────────────────────
  const handleCancel = async () => {
    setCancelling(true)
    try {
      const res = await fetch(`/api/orders/${params.orderId}/cancel`, { method: 'PATCH' })
      const json = await res.json()
      if (res.ok) {
        setOrder(prev => prev ? { ...prev, status: 'CANCELLED', cancelledAt: new Date().toISOString() } : prev)
        setShowCancelModal(false)
        toast.success('Order cancelled. Refund is on the way.')
      } else if (res.status === 409) {
        // Order progressed past cancellable state — re-fetch to sync status
        setShowCancelModal(false)
        const refresh = await fetch(`/api/orders/${params.orderId}`)
        const refreshJson = await refresh.json()
        if (refreshJson?.success) setOrder(refreshJson.data)
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

  // ── Order Again ───────────────────────────────────────────────────────────
  const handleOrderAgain = useCallback(() => {
    if (!order) return
    clearCart()
    order.orderItems.forEach(item => {
      addItem(
        {
          id: item.menuItemId,
          name: item.menuItem.name,
          price: item.unitPrice,
          prepTime: item.menuItem.prepTime ?? undefined,
          imageUrl: item.menuItem.imageUrl,
        },
        { id: item.vendor?.id ?? item.vendorId, name: item.vendor?.name ?? order.vendor.name }
      )
    })
    router.push(`/fair/${params.fairSlug}/checkout`)
  }, [order, clearCart, addItem, router, params.fairSlug])

  // ── Loading / error / empty states ────────────────────────────────────────
  if (loading) return (
    <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 animate-pulse">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-white/10 rounded" />
          <div className="h-4 w-64 bg-white/5 rounded" />
        </div>
        <div className="h-7 w-24 bg-white/10 rounded-full" />
      </div>
      {/* Progress stepper */}
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
      {/* Status message */}
      <div className="h-12 bg-white/[0.03] rounded-xl mb-4" />
      {/* Main content — stacked on mobile, side-by-side on desktop */}
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
            <div className="border-t border-white/[0.06] pt-3 space-y-2">
              <div className="flex justify-between">
                <div className="h-3 w-16 bg-white/5 rounded" />
                <div className="h-3 w-16 bg-white/5 rounded" />
              </div>
              <div className="flex justify-between">
                <div className="h-4 w-12 bg-white/10 rounded" />
                <div className="h-4 w-20 bg-white/10 rounded" />
              </div>
            </div>
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

  const isCancelled = TERMINAL_STATUSES.includes(order.status)
  const isCompleted = order.status === 'COMPLETED'
  const mapSrc = getMapEmbedUrl(order)
  const vendorGroups = buildVendorGroups(order.orderItems)
  const isMultiVendor = vendorGroups.length > 1
  const anyVendorAccepted = order.vendorOrderStatuses?.some(vs =>
    ['ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'].includes(vs.status)
  ) ?? false
  const canCancel = isMultiVendor
    ? !anyVendorAccepted
    : order.status === 'PLACED'

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
                  #{order.id.slice(-8).toUpperCase()} ·{' '}
                  {isMultiVendor
                    ? `${vendorGroups.length} vendors`
                    : order.vendor.name}{' '}
                  · {formatDate(order.placedAt)}
                </p>
              </div>
              {!isMultiVendor && <StatusBadge status={order.status} />}
            </div>
          </div>
        </div>

        <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6">
          {/* Stepper / multi-vendor summary header */}
          <div className="mb-4">
            {isMultiVendor ? (
              <MultiVendorSummaryHeader
                vendorGroups={vendorGroups}
                vendorStatuses={order.vendorOrderStatuses ?? []}
              />
            ) : (
              <OrderStepper status={order.status} steps={steps} />
            )}
          </div>

          {/* Status banner */}
          <StatusBanner order={order} />

          {/* Two-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-5">

            {/* Left: map + items + actions */}
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
                    onClick={handleOrderAgain}
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
        order={order}
      />
    </>
  )
}
