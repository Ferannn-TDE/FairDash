import {
  ReceiptPercentIcon,
  ClockIcon,
  BuildingStorefrontIcon,
} from '@heroicons/react/24/outline'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import type { OrderItem, VendorGroup, Order } from './types'

export const STEPS = [
  { label: 'Order Placed', sublabel: 'Confirmed',   icon: ReceiptPercentIcon },
  { label: 'Preparing',    sublabel: 'In progress', icon: ClockIcon },
  { label: 'Ready',        sublabel: 'For pickup',  icon: BuildingStorefrontIcon },
  { label: 'Completed',    sublabel: 'All done!',   icon: CheckCircleIcon },
]

export const VENDOR_STEPS = ['Placed', 'Accepted', 'Preparing', 'Ready']

export const VENDOR_STATUS_TO_STEP: Record<string, number> = {
  PLACED:    0,
  ACCEPTED:  1,
  PREPARING: 2,
  READY:     3,
  COMPLETED: 4,
  DECLINED:  -1,
}

export const STATUS_TO_STEP: Record<string, number> = {
  PENDING_PAYMENT:  0,
  PLACED:           0,
  ACCEPTED:         1,
  PREPARING:        1,
  READY:            2,
  RUNNER_COLLECTED: 2,
  COMPLETED:        3,
  DELIVERED:        3,
}

export const TERMINAL_STATUSES = ['CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE']

export const STATUS_LABELS: Record<string, string> = {
  PLACED:        'Order Placed',
  ACCEPTED:      'Accepted',
  PREPARING:     'Preparing',
  READY:         'Ready for Pickup',
  COMPLETED:     'Completed',
  CANCELLED:     'Cancelled',
  UNCOLLECTED:   'Uncollected',
  UNDELIVERABLE: 'Undeliverable',
}

export const STATUS_COLORS: Record<string, string> = {
  PLACED:        'text-amber-400 bg-amber-400/10 border-amber-400/20',
  ACCEPTED:      'text-amber-400 bg-amber-400/10 border-amber-400/20',
  PREPARING:     'text-blue-400 bg-blue-400/10 border-blue-400/20',
  READY:         'text-[#FF0077] bg-[#FF0077]/10 border-[#FF0077]/20',
  COMPLETED:     'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  CANCELLED:     'text-red-400 bg-red-400/10 border-red-400/20',
  UNCOLLECTED:   'text-red-400 bg-red-400/10 border-red-400/20',
  UNDELIVERABLE: 'text-red-400 bg-red-400/10 border-red-400/20',
}

export const VENDOR_STATUS_STYLES: Record<string, string> = {
  PLACED:    'text-amber-400 bg-amber-400/10 border-amber-400/20',
  ACCEPTED:  'text-amber-400 bg-amber-400/10 border-amber-400/20',
  PREPARING: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  READY:     'text-[#FF0077] bg-[#FF0077]/10 border-[#FF0077]/20',
  COMPLETED: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  DECLINED:  'text-red-400 bg-red-500/15 border-red-400/20',
}

export const VENDOR_STATUS_LABELS: Record<string, string> = {
  PLACED:    'Waiting',
  ACCEPTED:  'Accepted',
  PREPARING: 'Preparing',
  READY:     'Ready',
  COMPLETED: 'Done',
  DECLINED:  'Cancelled',
}

export function buildVendorGroups(orderItems: OrderItem[]): VendorGroup[] {
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

export function getStepFromStatus(status: string): number {
  return STATUS_TO_STEP[status] ?? -1
}

// Returns the 0-based stepper index for a given order status.
// Defaults to 0 (Order Placed) for unknown/empty values so the stepper
// never renders all-gray on initial load.
export function getActiveStep(status: string): number {
  if (['PLACED', 'PENDING_PAYMENT'].includes(status))           return 0
  if (['ACCEPTED', 'PREPARING'].includes(status))               return 1
  if (['READY', 'RUNNER_COLLECTED'].includes(status))           return 2
  if (['COMPLETED', 'DELIVERED'].includes(status))              return 3
  return 0
}

export function canCancelOrder(order: Order, liveStatus: string, vendorGroups: VendorGroup[]): boolean {
  if (vendorGroups.length > 1) {
    const anyAccepted = order.vendorOrderStatuses?.some(vs =>
      ['ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'].includes(vs.status)
    ) ?? false
    return !anyAccepted
  }
  return liveStatus === 'PLACED'
}

export function getMapEmbedUrl(order: Order): string {
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

export function formatTime(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export function buildSteps(fulfillmentType: string) {
  return STEPS.map((s, i) =>
    i === 2
      ? {
          ...s,
          label: fulfillmentType === 'HOME_DELIVERY' ? 'Out for Delivery' : 'Ready for Pickup',
          sublabel: fulfillmentType === 'HOME_DELIVERY' ? 'On the way' : 'For pickup',
        }
      : s
  )
}
