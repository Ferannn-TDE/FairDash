// RECORD A MENU CHANGE FOR THE APPROVERS' ALERTS (audit H5, step 3).
//
// Each call writes one MenuChangeEvent row through the caller's transaction client, so a delete or
// a pending price increase and its alert commit together or not at all: nothing is announced that
// rolled back, and nothing that committed goes unannounced. The worker (digest.ts) groups the rows
// and turns each group into one notification. Callers must pass the `tx` of the transaction that
// makes the change, never the global `db`.
//
// Item name and prices are copied into the payload, so a later rename or price change can't alter
// what the alert says happened. No vendor contact details or Stripe ids are ever written here.

import type { Prisma } from '@prisma/client'
import { CHANGE_KIND, type PricePendingReason } from './constants'

export interface MenuDeletedRecord {
  vendorId: string
  menuItemId: string
  name: string
  /** The price the item had when it left the menu. */
  price: number
  /** The APPROVED or approved DELETE request, or null for DELETE /api/menu/[id] (no request). */
  menuRequestId: string | null
}

export interface PriceChangePendingRecord {
  vendorId: string
  menuItemId: string
  /** The PENDING request the approver will decide. */
  menuRequestId: string
  /** One vendor submission: rows sharing it become one notification. Null = on its own. */
  batchId: string | null
  name: string
  /** The item's price now (for a removed item, its last recorded price); null for a new size. */
  previousPrice: number | null
  requestedPrice: number
  reason: PricePendingReason
}

async function eventIdOf(tx: Prisma.TransactionClient, vendorId: string): Promise<string> {
  const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: vendorId }, select: { eventId: true } })
  return vendor.eventId
}

/** A menu item left the menu. Grouped with the vendor's other deletes for 10 minutes. */
export async function recordMenuDeleted(tx: Prisma.TransactionClient, r: MenuDeletedRecord): Promise<void> {
  await tx.menuChangeEvent.create({
    data: {
      kind: CHANGE_KIND.DELETE,
      vendorId: r.vendorId,
      eventId: await eventIdOf(tx, r.vendorId),
      menuItemId: r.menuItemId,
      menuRequestId: r.menuRequestId,
      batchId: null,
      payload: { name: r.name, price: r.price },
    },
  })
}

/** A price increase is waiting for the approver. Sent on the worker's next tick. */
export async function recordPriceChangePending(tx: Prisma.TransactionClient, r: PriceChangePendingRecord): Promise<void> {
  await tx.menuChangeEvent.create({
    data: {
      kind: CHANGE_KIND.PRICE_PENDING,
      vendorId: r.vendorId,
      eventId: await eventIdOf(tx, r.vendorId),
      menuItemId: r.menuItemId,
      menuRequestId: r.menuRequestId,
      batchId: r.batchId,
      payload: { name: r.name, previousPrice: r.previousPrice, requestedPrice: r.requestedPrice, reason: r.reason },
    },
  })
}
