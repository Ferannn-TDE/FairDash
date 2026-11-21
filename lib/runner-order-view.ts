import type { Prisma } from '@prisma/client'

/**
 * Every column the runner order routes load (audit H3). The customer columns below are read
 * for every row but leave the server ONLY through toRunnerOrderView, and only for the runner
 * the order is assigned to. Never return a row of this shape directly.
 */
export const RUNNER_ORDER_SELECT = {
  // ── Sent for every order, before and after claim ──
  id: true,
  status: true,
  runnerId: true,
  fulfillmentType: true,
  readyAt: true,
  collectedAt: true,
  returnRequestedAt: true,
  deliveryFee: true,
  tip: true,
  vendor: { select: { name: true, boothNumber: true } },
  orderItems: { select: { id: true, quantity: true, menuItem: { select: { name: true } } } },
  // ── Sent only to the assigned runner, by fulfillment type ──
  customerName: true,
  customerPhone: true,
  vehicleMake: true,
  vehicleColor: true,
  vehiclePlate: true,
  pickupLocation: true,
  deliveryStreet: true,
  deliveryUnit: true,
  deliveryCity: true,
  deliveryState: true,
  deliveryZip: true,
  deliveryGeoPrecision: true,
} satisfies Prisma.OrderSelect

export type RunnerOrderRow = Prisma.OrderGetPayload<{ select: typeof RUNNER_ORDER_SELECT }>

/** "Jane Doe" → "Jane D."; "Cher" → "Cher"; blank → null. Splits on any whitespace. */
export function customerDisplayName(full: string | null | undefined): string | null {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  const initial = Array.from(parts[parts.length - 1])[0].toUpperCase()
  return `${parts[0]} ${initial}.`
}

/** What a runner may see of one order. Customer data only on their own order. */
export function toRunnerOrderView(o: RunnerOrderRow, runnerId: string) {
  const base = {
    id: o.id,
    status: o.status,
    runnerId: o.runnerId,
    fulfillmentType: o.fulfillmentType,
    readyAt: o.readyAt,
    collectedAt: o.collectedAt,
    returnRequestedAt: o.returnRequestedAt,
    deliveryFee: o.deliveryFee,
    tip: o.tip,
    vendor: { name: o.vendor.name, boothNumber: o.vendor.boothNumber },
    orderItems: o.orderItems.map(i => ({
      id: i.id,
      quantity: i.quantity,
      menuItem: { name: i.menuItem.name },
    })),
  }
  if (o.runnerId !== runnerId) return base

  if (o.fulfillmentType === 'CURBSIDE') {
    return {
      ...base,
      customerName: customerDisplayName(o.customerName),
      customerPhone: o.customerPhone,
      vehicleMake: o.vehicleMake,
      vehicleColor: o.vehicleColor,
      vehiclePlate: o.vehiclePlate,
      pickupLocation: o.pickupLocation,
    }
  }
  if (o.fulfillmentType === 'HOME_DELIVERY') {
    return {
      ...base,
      customerPhone: o.customerPhone,
      deliveryStreet: o.deliveryStreet,
      deliveryUnit: o.deliveryUnit,
      deliveryCity: o.deliveryCity,
      deliveryState: o.deliveryState,
      deliveryZip: o.deliveryZip,
      deliveryGeoPrecision: o.deliveryGeoPrecision,
    }
  }
  return base
}
