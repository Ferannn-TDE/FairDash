import { db } from './db'
import { StrandedReason } from '@prisma/client'

/**
 * Read models for the U5 operational surfaces — the HANDLES for a strand, not just the strand.
 * Each strand reason names a human action (Pattern V); these views carry the party + the action
 * so the surface can present the resolution, never a list of problems without handles.
 *
 *   CLAIMED_NOT_COLLECTED        → the runner; action = release back to the pool
 *   RUNNER_UNREACHABLE_WITH_FOOD → the runner's CONTACT; action = deliberate refund (admin money)
 *   AWAITING_VENDOR_CONFIRMATION → the vendor; action = the vendor confirms the return (their surface)
 */

export type StrandAction = 'release' | 'refund' | 'await_vendor'
const ACTION_FOR: Record<StrandedReason, StrandAction> = {
  CLAIMED_NOT_COLLECTED:        'release',
  RUNNER_UNREACHABLE_WITH_FOOD: 'refund',
  AWAITING_VENDOR_CONFIRMATION: 'await_vendor',
}

export interface StrandedRow {
  orderId: string
  reason: StrandedReason
  strandedAt: string
  ageMin: number
  action: StrandAction
  runner: { id: string; name: string | null; phone: string | null } | null
  vendor: { id: string; name: string } | null
}

/** Stranded orders for one event (voided excluded — the reconciler never strands those).
 *  Order has no `runner` relation (runnerId is a scalar FK), so runners are fetched separately. */
export async function listStrandedForEvent(eventId: string, nowMs = Date.now()): Promise<StrandedRow[]> {
  const rows = await db.order.findMany({
    where: { eventId, voidedAt: null, strandedAt: { not: null }, strandedReason: { not: null } },
    select: {
      id: true, strandedAt: true, strandedReason: true, runnerId: true,
      vendor: { select: { id: true, name: true } },
    },
    orderBy: { strandedAt: 'asc' }, // oldest strand first — most urgent at the top
  })

  const runnerIds = [...new Set(rows.map(r => r.runnerId).filter((x): x is string => !!x))]
  const runners = runnerIds.length
    ? await db.runner.findMany({ where: { id: { in: runnerIds } }, select: { id: true, user: { select: { name: true, phone: true } } } })
    : []
  const runnerById = new Map(runners.map(r => [r.id, { id: r.id, name: r.user?.name ?? null, phone: r.user?.phone ?? null }]))

  return rows.map(r => ({
    orderId: r.id,
    reason: r.strandedReason as StrandedReason,
    strandedAt: r.strandedAt!.toISOString(),
    ageMin: Math.floor((nowMs - r.strandedAt!.getTime()) / 60_000),
    action: ACTION_FOR[r.strandedReason as StrandedReason],
    runner: r.runnerId ? runnerById.get(r.runnerId) ?? null : null,
    vendor: r.vendor ? { id: r.vendor.id, name: r.vendor.name } : null,
  }))
}

export interface ReturnRow {
  orderId: string
  returnRequestedAt: string
  ageMin: number
  customerName: string | null
  items: { quantity: number; name: string | null }[]
}

/**
 * Orders awaiting THIS vendor's return-confirm. Keyed on returnRequestedAt, VOS-INDEPENDENT —
 * the vendor's COMPLETED path is gated off for runner-fulfilled orders (bf981f2) and the lanes
 * hide RUNNER_COLLECTED, so this is a NEW query, not a filter on the existing lanes. Scoped to
 * orders that actually include this vendor (a VendorOrderStatus row).
 */
export async function listReturnsForVendor(vendorId: string, nowMs = Date.now()): Promise<ReturnRow[]> {
  const rows = await db.order.findMany({
    where: {
      voidedAt: null,
      returnRequestedAt: { not: null },
      status: 'RUNNER_COLLECTED',
      vendorOrderStatuses: { some: { vendorId } },
    },
    select: {
      id: true, returnRequestedAt: true, customerName: true,
      orderItems: { select: { quantity: true, menuItem: { select: { name: true } } } },
    },
    orderBy: { returnRequestedAt: 'asc' },
  })
  return rows.map(r => ({
    orderId: r.id,
    returnRequestedAt: r.returnRequestedAt!.toISOString(),
    ageMin: Math.floor((nowMs - r.returnRequestedAt!.getTime()) / 60_000),
    customerName: r.customerName,
    items: r.orderItems.map(i => ({ quantity: i.quantity, name: i.menuItem?.name ?? null })),
  }))
}
