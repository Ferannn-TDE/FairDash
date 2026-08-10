import {
  ReceiptPercentIcon,
  ClockIcon,
  BuildingStorefrontIcon,
} from '@heroicons/react/24/outline'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { FAILED_STATUSES } from '@/lib/order-status'
import type { OrderItem, VendorGroup, Order } from './types'

export const STEPS = [
  { label: 'Order Placed', sublabel: 'Confirmed',   icon: ReceiptPercentIcon },
  { label: 'Preparing',    sublabel: 'In progress', icon: ClockIcon },
  { label: 'Ready',        sublabel: 'For pickup',  icon: BuildingStorefrontIcon },
  { label: 'Completed',    sublabel: 'All done!',   icon: CheckCircleIcon },
]

export const VENDOR_STEPS = ['Placed', 'Accepted', 'Preparing', 'Ready']

// VENDOR_STATUS_TO_STEP moved to lib/order-view.ts (VENDOR_LANE_STEP): it is a derivation
// over status, not a label map, so it belongs with the other status derivations where
// order-view-guard can see it. Components read `lane.step` off the derived view instead.
//
// STATUS_TO_STEP / getStepFromStatus / getActiveStep / buildSteps / canCancelOrder were
// DELETED here — all five had zero call sites. canCancelOrder is the telling one: a shared
// cancel-eligibility helper existed and both tracking views ignored it to inline their own
// (differing) rule. That rule now lives in deriveOrderView, with callers.

// Terminal-FAILED statuses (drives isCancelled on the tracking surfaces; COMPLETED/DELIVERED
// are handled separately by isCompleted). DERIVED from the one canonical list — this used to be
// a local copy missing REFUNDED and DECLINED, so a refunded order rendered
// "Cannot cancel — vendor is preparing". Never re-inline it (cancel-label-guard pins this).
export const TERMINAL_STATUSES: readonly string[] = FAILED_STATUSES

export const STATUS_LABELS: Record<string, string> = {
  PLACED:        'Order Placed',
  ACCEPTED:      'Accepted',
  PREPARING:     'Preparing',
  READY:         'Ready for Pickup',
  COMPLETED:     'Completed',
  CANCELLED:     'Cancelled',
  UNCOLLECTED:   'Uncollected',
  UNDELIVERABLE: 'Undeliverable',
  REFUNDED:      'Refunded',
  DECLINED:      'Declined',
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
  REFUNDED:      'text-red-400 bg-red-400/10 border-red-400/20',
  DECLINED:      'text-red-400 bg-red-400/10 border-red-400/20',
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

