import { computeVendorOrderEarnings, type EarningsStatus } from './vendor-earnings'

/**
 * THE /api/vendors/:id/orders/active response contract — one type, one mapper, shared by the
 * route (producer) and the vendor dashboard (consumer).
 *
 * Third instance of the partial-rows class forced this: the route returned a subset while the
 * dashboard's hand-written interface PROMISED customerName/phone, delivery address, and vehicle
 * fields — so home-delivery cards rendered "undefined, undefined" (street, city), exactly like
 * bf981f2's vacuous ready-lane gate (missing fulfillmentType) before it. A hand-written
 * consumer interface is a hope, not a contract.
 *
 * The contract is enforced in BOTH directions at compile time (next build / tsc):
 *   - route → mapper: the prisma SELECT must produce VendorActiveOrderRow, or the
 *     toVendorActiveOrder(o, …) call is a type error (drop a field from the select and the
 *     build fails — it can no longer become "undefined" on screen).
 *   - dashboard: imports VendorActiveOrder instead of declaring its own interface, so a UI
 *     read of a field the route doesn't return is a type error too.
 * active-shape-guard pins the wiring (imports present, no local re-declarations) at gate time.
 */

export type VendorFulfillmentType = 'BOOTH_PICKUP' | 'CURBSIDE' | 'HOME_DELIVERY'

/** What the mapper READS — the route's select must satisfy this. */
export interface VendorActiveOrderRow {
  id: string
  status: string
  placedAt: Date | string
  total: number
  fulfillmentType: VendorFulfillmentType
  customerName: string
  customerPhone: string
  vehicleMake: string | null
  vehicleColor: string | null
  vehiclePlate: string | null
  deliveryStreet: string | null
  deliveryCity: string | null
  // Custody: a collected order (runner physically has the bag) drops off the vendor's Ready
  // lane until a confirmed return nulls this — the vendor's work on it is done.
  collectedAt: Date | string | null
  vendorOrderStatuses: { vendorId: string; status: string; version: number }[]
  payouts: { vendorId: string; netAmount: number; reversedAt: Date | null }[]
  refunds: { vendorId: string; status: string; amountCents: number }[]
  orderItems: { id: string; quantity: number; unitPrice: number; subtotal: number; itemName: string; vendorId: string }[]
}

export interface VendorActiveOrderItem {
  id: string
  quantity: number
  unitPrice: number
  itemName: string
}

/** What the consumers RENDER — every field here is guaranteed present in the response. */
export interface VendorActiveOrder {
  id: string
  status: string
  fulfillmentType: VendorFulfillmentType
  customerName: string
  customerPhone: string
  vehicleMake: string | null
  vehicleColor: string | null
  vehiclePlate: string | null
  deliveryStreet: string | null
  deliveryCity: string | null
  /** Set once the runner physically collects — the Ready lane gates on `!collectedAt`. */
  collectedAt: Date | string | null
  /** This vendor's gross slice (their items only) — never the full order total. */
  vendorSubtotal: number
  /** Take-home via the one shared earnings helper (estimate pre-payout). */
  earnings: number
  earningsStatus: EarningsStatus
  placedAt: Date | string
  /** VOS version for stale-push rejection on the live feed. */
  version?: number
  orderItems: VendorActiveOrderItem[]
}

export function toVendorActiveOrder(o: VendorActiveOrderRow, vendorId: string): VendorActiveOrder {
  const myItems = o.orderItems.filter(i => i.vendorId === vendorId)
  const earn = computeVendorOrderEarnings(o, vendorId)
  const vos = o.vendorOrderStatuses.find(s => s.vendorId === vendorId)
  return {
    id: o.id,
    status: vos?.status ?? o.status,
    fulfillmentType: o.fulfillmentType,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    vehicleMake: o.vehicleMake,
    vehicleColor: o.vehicleColor,
    vehiclePlate: o.vehiclePlate,
    deliveryStreet: o.deliveryStreet,
    deliveryCity: o.deliveryCity,
    collectedAt: o.collectedAt,
    vendorSubtotal: parseFloat(myItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0).toFixed(2)),
    earnings: parseFloat((earn.cents / 100).toFixed(2)),
    earningsStatus: earn.status,
    placedAt: o.placedAt,
    version: vos?.version,
    orderItems: myItems.map(i => ({ id: i.id, quantity: i.quantity, unitPrice: i.unitPrice, itemName: i.itemName })),
  }
}
