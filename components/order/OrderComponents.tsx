'use client'

import {
  CheckIcon,
  ClockIcon,
  MapPinIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  ChatBubbleLeftEllipsisIcon,
  EnvelopeIcon,
  BuildingStorefrontIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import type { Order, VendorGroup, VendorOrderStatus } from './types'
import {
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_TO_STEP,
  TERMINAL_STATUSES,
  VENDOR_STATUS_TO_STEP,
  VENDOR_STEPS,
  STEPS,
  buildVendorGroups,
} from './helpers'
import { StatusPill } from '@/components/ui/StatusPill'
import { getStatusConfig } from '@/lib/order-status-config'

// ─── StatusBadge ──────────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_COLORS[status] ?? 'text-[#A1A1A1] bg-white/5 border-white/10'}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

// ─── OrderStepper ─────────────────────────────────────────────────────────────

export function OrderStepper({
  activeStep,
  cancelledStatus,
  steps,
}: {
  activeStep: number
  cancelledStatus?: string | null
  steps: typeof STEPS
}) {
  const currentStep = activeStep

  if (cancelledStatus) {
    return (
      <div className="bg-[#1A1A1A] border border-red-500/20 rounded-2xl p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
          <XMarkIcon className="w-5 h-5 text-red-400" />
        </div>
        <div>
          <p className="text-white font-semibold text-sm">Order {STATUS_LABELS[cancelledStatus]}</p>
          <p className="text-[#A1A1A1] text-xs mt-0.5">
            {cancelledStatus === 'CANCELLED'     ? 'This order was cancelled.' :
             cancelledStatus === 'UNCOLLECTED'   ? 'This order was not collected in time.' :
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

// ─── Vendor-level sub-components ──────────────────────────────────────────────

export function VendorStatusBadge({ status }: { status: string }) {
  return <StatusPill status={status} />
}

export function VendorProgressSteps({ status }: { status: string }) {
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

export function VendorStatusMessage({ status, boothNumber }: { status: string; boothNumber?: string | null }) {
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

// ─── MultiVendorSummaryHeader ─────────────────────────────────────────────────

export function MultiVendorSummaryHeader({
  vendorGroups,
  vendorStatuses,
}: {
  vendorGroups: VendorGroup[]
  vendorStatuses: VendorOrderStatus[]
}) {
  const getStatus = (vid: string) => vendorStatuses.find(s => s.vendorId === vid)?.status ?? 'PLACED'
  const statuses = vendorGroups.map(g => getStatus(g.vendorId))

  const allCompleted = statuses.every(s => s === 'COMPLETED')
  const allDeclined  = statuses.every(s => s === 'DECLINED')
  const allTerminal  = statuses.every(s => ['COMPLETED', 'DECLINED'].includes(s))
  const readyCount   = statuses.filter(s => ['READY', 'COMPLETED'].includes(s)).length
  const hasReady     = statuses.some(s => s === 'READY')

  const aggregateLabel =
    allCompleted  ? 'All Done' :
    allDeclined   ? 'Cancelled' :
    allTerminal   ? 'Partially Done' :
    readyCount > 0 && readyCount < vendorGroups.length ? `${readyCount} of ${vendorGroups.length} Ready` :
    hasReady      ? 'Ready' :
    'In Progress'

  const aggregateColor =
    allCompleted                 ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
    allDeclined                  ? 'text-red-400 bg-red-400/10 border-red-400/20' :
    allTerminal                  ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
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
          const dotColor = getStatusConfig(vs).dotColor

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

// ─── SingleVendorProgress ────────────────────────────────────────────────────
// Same dot + name + pill + bar style as the multi-vendor rows, but for a single
// vendor. Uses a continuous fill bar (with %) instead of equal-width segments
// so the bar position communicates stage rather than counting discrete steps.

const PROGRESS_WIDTH: Record<string, string> = {
  PENDING_PAYMENT: '10%',
  PLACED:          '10%',
  ACCEPTED:        '33%',
  PREPARING:       '55%',
  READY:           '80%',
  RUNNER_COLLECTED:'80%',
  COMPLETED:       '100%',
  DELIVERED:       '100%',
}

export function SingleVendorProgress({
  vendorName,
  status,
  progressWidth,
}: {
  vendorName: string
  status: string
  progressWidth?: string
}) {
  const isCompleted = status === 'COMPLETED' || status === 'DELIVERED'
  const isDeclined  = status === 'CANCELLED' || status === 'DECLINED'
  // Caller can pass a pre-computed width (same liveStatus variable as the badge)
  // so both elements are guaranteed to be in sync with a single source of truth.
  const fillWidth   = progressWidth ?? PROGRESS_WIDTH[status] ?? '10%'

  const dotColor = getStatusConfig(status).dotColor

  return (
    <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl p-5">
      <div className="flex items-center gap-3">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-white text-sm font-medium truncate">{vendorName}</span>
            <VendorStatusBadge status={status} />
          </div>
          {isDeclined ? (
            <div className="mt-1.5 h-0.5 rounded-full bg-red-400/20" />
          ) : (
            <div className="relative mt-1.5 h-0.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[#FF0077] transition-all duration-700"
                style={{ width: fillWidth }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── OrderItemsCard ───────────────────────────────────────────────────────────

export function OrderItemsCard({ order, isMultiVendor }: { order: Order; isMultiVendor: boolean }) {
  const groups = buildVendorGroups(order.orderItems)

  return (
    <div className="space-y-3">
      {groups.map(group => {
        const vendorStatus = order.vendorOrderStatuses?.find(
          s => s.vendorId === group.vendorId
        )?.status ?? order.status

        return (
          <div key={group.vendorId} className="bg-[#1A1A1A] border border-white/5 rounded-2xl overflow-hidden">
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
                    <p className="text-white text-sm font-medium">${(item.subtotal ?? 0).toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
            {isMultiVendor && (
              <div className="px-5 py-3 border-t border-white/5 flex justify-between bg-white/[0.01]">
                <span className="text-[#A1A1A1] text-xs">
                  {group.items.length} item{group.items.length !== 1 ? 's' : ''} · vendor subtotal
                </span>
                <span className="text-white text-sm font-medium">${(group.subtotal ?? 0).toFixed(2)}</span>
              </div>
            )}
          </div>
        )
      })}

      <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl px-5 py-4 space-y-2">
        {!isMultiVendor && (
          <p className="text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold mb-3">Order Total</p>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-[#A1A1A1]">Subtotal</span>
          <span className="text-white">${(order.subtotal ?? 0).toFixed(2)}</span>
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
            <span className="text-[#A1A1A1]">Service Fee</span>
            <span className="text-white/60">${(order.fairSynqFee ?? 0).toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold border-t border-white/5 pt-2 mt-1">
          <span className="text-white">Total</span>
          <span className="text-[#FF0077] text-base [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
            ${(order.total ?? 0).toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── TimelineRow ──────────────────────────────────────────────────────────────

export function TimelineRow({
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

// ─── OrderMetaCard ────────────────────────────────────────────────────────────

export function OrderMetaCard({ order, isMultiVendor }: { order: Order; isMultiVendor: boolean }) {
  const isDelivery = order.fulfillmentType === 'HOME_DELIVERY'
  const isCurbside = order.fulfillmentType === 'CURBSIDE'
  const hasAddress = isDelivery && order.deliveryStreet
  const vendorGroups = buildVendorGroups(order.orderItems)

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
            <TimelineRow label="Order Placed" time={order.placedAt} />
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
              {/* Runner custody leg — same columns the escape path keys on, so the
                  timeline finally covers transit instead of going dark after Ready. */}
              {(order.dispatchedAt || order.collectedAt) && (
                <div>
                  <p className="text-white/30 text-[0.625rem] uppercase tracking-wider mb-1.5">Runner</p>
                  <div className="ml-3 pl-3 border-l border-white/[0.08] space-y-1.5">
                    {order.dispatchedAt && <TimelineRow label="Runner claimed" time={order.dispatchedAt} small />}
                    {order.collectedAt && <TimelineRow label="Picked up from booth" time={order.collectedAt} small />}
                    {/* Delivered keys on STATUS (like the progress bar), not on completedAt —
                        which is null on DELIVERED orders on purpose. Timestamp = the
                        RunnerEarning accrual time (the honest delivery time); if that's absent
                        (legacy rows with no earning), the milestone still shows, untimed. */}
                    {order.status === 'DELIVERED' && (
                      order.runnerEarning?.createdAt
                        ? <TimelineRow label="Delivered" time={order.runnerEarning.createdAt} small green />
                        : <p className="text-[0.6875rem] text-emerald-400">Delivered</p>
                    )}
                  </div>
                </div>
              )}
              {order.cancelledAt && (
                <TimelineRow label="Order Cancelled" time={order.cancelledAt} red />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── StatusBanner ─────────────────────────────────────────────────────────────

export function StatusBanner({ order, status }: { order: Order; status: string }) {
  const { fulfillmentType, estimatedReadyAt, vendor, vehicleColor, vehicleMake } = order

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

// ─── CancelModal ──────────────────────────────────────────────────────────────

export function CancelModal({
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

// ─── SupportModal ─────────────────────────────────────────────────────────────

export function SupportModal({ isOpen, onClose, order, vendors }: {
  isOpen: boolean
  onClose: () => void
  order: Order
  vendors?: { name: string; status: string }[]
}) {
  if (!isOpen) return null

  const shortId = order.id.slice(-8).toUpperCase()
  const isMulti = vendors && vendors.length > 1
  const vendorNames = isMulti
    ? vendors!.map(v => v.name).join(', ')
    : order.vendor.name
  const subject = encodeURIComponent(`Order #${shortId} — Support Request`)
  const body = encodeURIComponent(
    `Hi FairSynq Support,\n\nI need help with Order #${shortId}.\n\nOrder ID: ${order.id}\nVendor(s): ${vendorNames}\nStatus: ${order.status}\nTotal: $${(order.total ?? 0).toFixed(2)}\n\nDescription of issue:\n`
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
        <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-3.5 mb-5 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-[#A1A1A1]">Order</span>
            <span className="text-white">#{shortId}</span>
          </div>

          {isMulti ? (
            // Multi-vendor: one row per vendor with their individual status
            <div>
              <span className="text-[#A1A1A1] text-sm">Vendors</span>
              <div className="mt-1.5 space-y-1">
                {vendors!.map(v => (
                  <div key={v.name} className="flex items-center justify-between gap-2 pl-1">
                    <span className="text-white text-sm truncate">{v.name}</span>
                    <span className="text-[#A1A1A1] text-xs flex-shrink-0">
                      {v.status.charAt(0) + v.status.slice(1).toLowerCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex justify-between text-sm">
              <span className="text-[#A1A1A1]">Vendor</span>
              <span className="text-white">{order.vendor.name}</span>
            </div>
          )}

          <div className="flex justify-between text-sm">
            <span className="text-[#A1A1A1]">Status</span>
            <span className="text-white">{order.status.charAt(0) + order.status.slice(1).toLowerCase()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#A1A1A1]">Total</span>
            <span className="text-[#FF0077] font-semibold">${(order.total ?? 0).toFixed(2)}</span>
          </div>
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
