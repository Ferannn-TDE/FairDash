// VENDOR GO-LIVE CHECK — the one rule for moving a booth INTO ACTIVE (audit M1, Fix B).
//
// Decisions (Jordan, Nov 12):
//   - The event's organizer approves vendors for their own event; FairSynq approves only when the
//     event has no organizer. ONE approval: there is no separate FairSynq account approval.
//   - A vendor goes live only when approval, documents, menu, payouts and booth number are done.
//   - Organizers can suspend or remove a vendor, and lift their own suspension.
//
// THE HOLE (M1). The organizer status route checked approval and documents only on
// PENDING → ACTIVE, so PENDING → PAUSED → ACTIVE, or REJECTED → ACTIVE, put a booth that was never
// approved live. This check runs on EVERY organizer or admin move into ACTIVE: approving, lifting
// a pause, lifting a suspension. Both doors (the organizer route and decideVendor) call it, so the
// checklist cannot drift between them.
//
// NOT A VENDOR GATE. A vendor's own pause is isBusy/busyUntil or isOffline
// (app/api/vendors/[id]/route.ts); neither touches Vendor.status, and vendors cannot change their
// status at all. Nothing here runs on those paths, so a vendor's pause and auto-resume are never
// blocked by it.

import type { Prisma } from '@prisma/client'
import { db } from './db'
import { vendorDocsComplete, type VendorDocPaths } from './vendor-documents'
import { SELLABLE } from './menu/on-menu'

/**
 * THE SWITCH for the "two approvals" question, kept in one place in case it changes.
 * Decided Nov 12: false. The event's approver (its organizer, or FairSynq when there is none) is
 * enough. When true, a booth also needs a FairSynq approval record (an ApprovalAction APPROVE)
 * before it can go live, however the event approved it.
 */
export const REQUIRE_PLATFORM_ACCOUNT_APPROVAL = false

type Client = Prisma.TransactionClient | typeof db

/** Wording shared with the vendor readiness checklist (lib/vendor-readiness.ts). */
export const GO_LIVE_LABELS = {
  approval: 'Application approved',
  documents: 'Upload documents',
  menu: 'Add your menu',
  payouts: 'Connect payouts',
  booth: 'Set booth number',
} as const

export type GoLiveItem = keyof typeof GO_LIVE_LABELS

export interface GoLiveRefusal {
  code: 'VENDOR_NOT_READY_TO_GO_LIVE'
  message: string
  missing: GoLiveItem[]
  missingLabels: string[]
}

/**
 * Has this booth been approved for its event?
 *
 * Read from the records that exist today: an ApprovalAction APPROVE (every FairSynq approval
 * through decideVendor, lib/approvals.ts, writes one), or an organizer-logged status change from
 * PENDING to ACTIVE (VendorAuditLog VENDOR_STATUS_CHANGED). The vendor owner's
 * VendorMember.approvalStatus is NOT used: the Aug 4 grandfather backfill approved operators of
 * booths that were still PENDING. A booth with neither record must be approved again before it
 * can be moved into ACTIVE (decided Nov 12).
 *
 * Later: the organizer portal build adds a per-event approval date, Vendor.eventApprovedAt; this
 * then reads that column instead of reconstructing approval from these two records.
 */
export async function vendorApprovedForEvent(
  client: Client,
  vendorId: string,
  opts: { requirePlatformAccountApproval?: boolean } = {},
): Promise<boolean> {
  const requirePlatform = opts.requirePlatformAccountApproval ?? REQUIRE_PLATFORM_ACCOUNT_APPROVAL
  const platformApprovals = await client.approvalAction.count({
    where: { applicationType: 'vendor', applicationId: vendorId, action: 'APPROVE' },
  })
  if (platformApprovals > 0) return true
  if (requirePlatform) return false
  const changes = await client.vendorAuditLog.findMany({
    where: { vendorId, action: 'VENDOR_STATUS_CHANGED' },
    select: { metadata: true },
  })
  return changes.some(c => {
    const m = c.metadata as { previousStatus?: unknown; newStatus?: unknown } | null
    return m?.previousStatus === 'PENDING' && m?.newStatus === 'ACTIVE'
  })
}

export interface GoLiveVendor extends VendorDocPaths {
  id: string
  name: string
  stripeVerified: boolean
  boothNumber: string | null
  /** A demo booth needs no payouts (lib/demo-vendor.ts); everything else still applies. */
  isDemo?: boolean
}

/** The columns vendorGoLiveRefusal reads, for callers' selects. */
export const GO_LIVE_VENDOR_SELECT = {
  id: true,
  name: true,
  stripeVerified: true,
  isDemo: true,
  boothNumber: true,
  foodHandlerPermitPath: true,
  insurancePath: true,
  businessLicensePath: true,
} as const

/**
 * Why this booth may NOT be moved into ACTIVE, or null when it may.
 *
 * `approving: true` when this call IS the approval (FairSynq's approve, or an organizer approving
 * a PENDING booth once that is switched on): the approval itself is what's being granted, so only
 * the checklist is checked. Every other move into ACTIVE (lifting a pause or suspension,
 * re-activating a rejected booth) also needs the booth to have been approved for the event.
 */
export async function vendorGoLiveRefusal(
  client: Client,
  vendor: GoLiveVendor,
  opts: { approving?: boolean; requirePlatformAccountApproval?: boolean } = {},
): Promise<GoLiveRefusal | null> {
  const missing: GoLiveItem[] = []
  if (!opts.approving && !(await vendorApprovedForEvent(client, vendor.id, opts))) missing.push('approval')
  if (!vendorDocsComplete(vendor)) missing.push('documents')
  const sellable = await client.menuItem.count({ where: { vendorId: vendor.id, ...SELLABLE } })
  if (sellable === 0) missing.push('menu')
  // A demo booth takes no real money, so it needs no payouts (Jordan, Nov 16; lib/demo-vendor.ts).
  if (!vendor.stripeVerified && !vendor.isDemo) missing.push('payouts')
  if (!vendor.boothNumber || vendor.boothNumber.trim() === '') missing.push('booth')
  if (missing.length === 0) return null
  const missingLabels = missing.map(m => GO_LIVE_LABELS[m])
  return {
    code: 'VENDOR_NOT_READY_TO_GO_LIVE',
    message: `${vendor.name} can't go live yet. Still needed: ${missingLabels.join(', ')}.`,
    missing,
    missingLabels,
  }
}
