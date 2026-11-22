// APPLY A MENU-REQUEST DECISION — the one place a pending menu request is approved or rejected.
//
// Moved out of the organizer route (audit H5, Step 2g) so the organizer route and the admin route
// run the SAME checks, the SAME transaction and the SAME audit rows. Two copies of an approval
// path drift; this codebase has found that more than once.
//
// WHO APPROVES (the approver rule):
//   - the event's organizer, when the event has one;
//   - a strict platform admin (admin | super_admin, never event_operator), ONLY when it has none.
// Each route proves its caller's identity (requireOrganizerAuth + resolveOwnedFair, or the strict
// admin gate) and passes it here as `approver`; mayApproveForEvent re-checks it against the event,
// so a route wired to the wrong gate still cannot approve. Refused callers get 404, the same
// answer as a request that does not exist.

import { revalidateTag } from 'next/cache'
import { expireVendorMenu } from '@/lib/menu/menu-cache'
import { db } from '../db'
import { ApiError } from '../api-error'
import { getRealtimeDb } from '../firebase-admin'
import { logVendorAction, AUDIT_ACTIONS } from '../vendor-audit'
import { logger } from '../logger'
import { assertNeverRequestType, type MenuRequestTypeInput } from './validate-item'
import { menuRequestTargetsOwnItem } from './item-ownership'
import { parseInPersonPrice } from '../menu/price'
import { priceChanged, recordMenuPriceChange, recordMenuItemRemoved } from '../menu/price-audit'
import type { MenuRequest } from '@prisma/client'
import { recordMenuDeleted } from '../menu-notify/record'
import { parseReviewReason } from './review-reason'
import { liveSizeGroupWhere, filedAsNewSize, lockVendorMenu } from './size-groups'
import { closeOrphanedNewSizes } from './supersede'

export const ORPHANED_NEW_SIZE_MESSAGE =
  "This new size's item is no longer on the menu, so it can't be added. Reject this request."

export type MenuApprover =
  | { kind: 'organizer'; organizerId: string }
  | { kind: 'admin' }

/** The approver rule. Pure, so it can be tested without a database. */
export function mayApproveForEvent(event: { organizerId: string | null }, approver: MenuApprover): boolean {
  if (event.organizerId) return approver.kind === 'organizer' && approver.organizerId === event.organizerId
  return approver.kind === 'admin'
}

export interface MenuRequestDecisionInput {
  requestId: string
  event: { id: string; organizerId: string | null }
  approver: MenuApprover
  /** DB User.id of the approver: written as reviewedBy and on the audit rows (foreign key). */
  reviewerUserId: string
  action: 'APPROVE' | 'REJECT'
  /** The approver's free text, as received: checked and cleaned by parseReviewReason. */
  reason?: unknown
}

export interface MenuRequestDecisionResult {
  id: string
  status: string
  reviewNote: string | null
  reviewedAt: Date | null
}

const notFound = () => new ApiError('Request not found', 404, 'NOT_FOUND')
const unprocessable = (message: string) => new ApiError(message, 422, 'UNPROCESSABLE')

/**
 * Approve or reject one PENDING menu request. Throws ApiError for every refusal; each refusal
 * leaves the request PENDING and the menu untouched.
 *
 * APPROVE applies the change, its audit rows and the status in ONE transaction. The status is
 * flipped with `updateMany ... where status = PENDING`, so two approvers acting at once cannot
 * both apply it: the second finds no PENDING row, throws 409, and its writes roll back.
 */
export async function applyMenuRequestDecision(input: MenuRequestDecisionInput): Promise<MenuRequestDecisionResult> {
  // THE REASON FIRST (review F16; Jordan, Nov 17; lib/menu-requests/review-reason.ts): bounded,
  // single-line text, checked before any database read. A refusal is a clean 400 and changes nothing.
  const parsedReason = parseReviewReason(input.reason)
  if (!parsedReason.ok) throw new ApiError(parsedReason.message, 400, 'VALIDATION_ERROR')
  const reason = parsedReason.reason

  const { requestId, event, approver, reviewerUserId, action } = input

  const menuRequest = await db.menuRequest.findUnique({
    where: { id: requestId },
    include: { vendor: { select: { id: true, name: true, eventId: true } } },
  })
  // A request in another fair, and a caller who may not approve for this fair, both answer the
  // same 404 as a request that does not exist.
  if (!menuRequest || menuRequest.vendor.eventId !== event.id) throw notFound()
  if (!mayApproveForEvent(event, approver)) throw notFound()
  if (menuRequest.status !== 'PENDING') throw new ApiError('Request already reviewed', 409, 'CONFLICT')

  const vendorId = menuRequest.vendor.id
  const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
  const requestType: MenuRequestTypeInput = menuRequest.type
  const menuItemId = menuRequest.menuItemId

  // OWNERSHIP RE-CHECK (audit H4, defence in depth). Filing now refuses another vendor's item, but a
  // row written before that check existed could still name one. Refused with 409
  // ITEM_VENDOR_MISMATCH, the code and wording scripts/menu-ownership-boundary-proof.ts [4] pins
  // (merge decision D3, 2026-11-21); the request stays PENDING. Read-only, and an item's vendor never
  // changes, so it stays before the lock.
  if (action === 'APPROVE' && requestType !== 'ADD') {
    if (!menuItemId) throw unprocessable(`${requestType} request missing menuItemId`)
    if (!(await menuRequestTargetsOwnItem(menuItemId, vendorId))) {
      throw new ApiError("This change no longer matches the vendor's menu and can't be applied.", 409, 'ITEM_VENDOR_MISMATCH')
    }
  }
  const sizedAdd = requestType === 'ADD' && menuRequest.variantGroup !== null
  // PRICE RE-CHECK (audit H5, 2f). A request filed before the $1.00–$10,000 rule (2a) can carry a
  // price the rule now refuses. A RESTORE carries a price since 2g, so it is checked too. It reads
  // only the request's own price, so it stays before the transaction (scripts/menu-price-audit-test.ts
  // pins that); a refusal is a 422 and the request stays PENDING.
  let approvedPrice: number | null = null
  if (action === 'APPROVE' && requestType !== 'DELETE' && menuRequest.price !== null) {
    const parsed = parseInPersonPrice(menuRequest.price)
    if (!parsed.ok) {
      throw unprocessable(`This request's price can't be approved: ${parsed.message}. Reject it and ask the vendor to resubmit.`)
    }
    approvedPrice = parsed.value
  }

  // ── One transaction: the decision, the menu change, its audit rows, and the review ────────
  // THE WHOLE DECISION HAPPENS UNDER THE LOCK (Step 12 finding 5, 2026-11-22). Every read that
  // depends on the vendor's menu as it is now (is the size group live? was this filed as a new
  // size? which sizes are decided together?) and every refusal built on it runs after
  // lockVendorMenu, through `tx`, so no filing or approval for the same vendor can change the answer
  // between the read and the write. A refusal thrown here rolls back and leaves the request PENDING.
  //
  // timeout 20 s (Step 12 finding 2): longer than the lock's 8 s wait plus this work, so a long wait
  // ends in 503 MENU_BUSY, never in Prisma's default 5 s transaction timeout.
  const { updated, group } = await db.$transaction(async tx => {
    // One vendor's menu changes run one at a time (size-groups.ts lockVendorMenu; P7 finding 4).
    await lockVendorMenu(tx, vendorId)

    // SIZES ARE PART OF THE ITEM (Nov 12). A brand-new item's sizes are PENDING ADDs sharing a
    // variantGroup; deciding one decides them all, in this one transaction. A new size of an item
    // that is already LIVE (F4, Nov 13) is decided on its own: approving "Large" must not also
    // approve an "XL" the vendor filed separately. Every other request is decided on its own.
    const isNewSizeOfLiveItem = sizedAdd
      && (await tx.menuItem.count({ where: liveSizeGroupWhere(vendorId, menuRequest.variantGroup as string) })) > 0
    // WAS IT FILED AS A NEW SIZE? (size-groups.ts filedAsNewSize.) Asked only when the answer can
    // matter (ultrareview P7 finding 7): a sized ADD whose group has NO live row. In a live group the
    // request is a new size anyway and is decided on its own.
    const orphanedNewSize = sizedAdd && !isNewSizeOfLiveItem
      && (await filedAsNewSize(tx, [requestId])).has(requestId)
    // SAFETY NET (ultrareview finding 1, 2026-11-21). Removing the last live row of a group closes
    // its waiting new sizes (supersede.ts closeOrphanedNewSizes). Should one still be PENDING, it must
    // not be approved as if it were a brand-new item: refused here, before anything is written, so
    // it stays PENDING for the approver to reject.
    if (action === 'APPROVE' && orphanedNewSize) {
      throw new ApiError(ORPHANED_NEW_SIZE_MESSAGE, 409, 'CONFLICT')
    }
    let group: MenuRequest[] = [menuRequest]
    if (sizedAdd && !isNewSizeOfLiveItem && !orphanedNewSize) {
      // A brand-new item: all its pending sizes are decided together. Requests filed as new sizes of
      // a removed item that share the group name are never swept in (ultrareview P7 finding 5).
      const pending = await tx.menuRequest.findMany({
        where: { vendorId, type: 'ADD', status: 'PENDING', variantGroup: menuRequest.variantGroup },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      const orphans = await filedAsNewSize(tx, pending.map(r => r.id))
      group = pending.filter(r => !orphans.has(r.id))
    }
    const groupIds = group.map(r => r.id)
    // DECIDED WHILE THIS ONE WAITED (Step 12, Jordan, 2026-11-22). Two approvals of a brand-new
    // item's sizes at once: the second waits on the lock, then finds none of the sizes PENDING, so the
    // group is empty and the flip below would pass 0 === 0, answering success having decided nothing.
    // This request must be one of the rows this transaction decides.
    if (!groupIds.includes(requestId)) throw new ApiError('Request already reviewed', 409, 'CONFLICT')

    // ── Checks before anything is written ────────────────────────────────────────────────
    // Each refusal leaves the request PENDING, so the approver can reject it. All return 422.
    /** ADD only: each size's price after the rule check, by request id. */
    const addPrices = new Map<string, number>()
    if (action === 'APPROVE' && requestType === 'ADD') {
      // Every size of the item must be well-formed and within the price rule, or none is applied.
      for (const r of group) {
        if (!r.name || r.price === null || !r.category) throw unprocessable('Malformed ADD request — missing required fields')
        const parsed = parseInPersonPrice(r.price)
        if (!parsed.ok) {
          const which = group.length > 1 ? ` (size ${r.variantLabel ?? r.name})` : ''
          throw unprocessable(`This request's price can't be approved${which}: ${parsed.message}. Reject it and ask the vendor to resubmit.`)
        }
        addPrices.set(r.id, parsed.value)
      }
    }

    const now = new Date()
    if (action === 'APPROVE') {
      // EXHAUSTIVE BY CONSTRUCTION: a fifth MenuRequestType fails `tsc` at assertNeverRequestType
      // instead of flipping to APPROVED having written nothing.
      switch (requestType) {
      case 'ADD': {
        // One row per size (one row when the item has no sizes), each with its own audit row.
        for (const r of group) {
          const created = await tx.menuItem.create({
            data: {
              vendorId,
              name: r.name as string,
              description: r.description ?? undefined,
              price: addPrices.get(r.id) as number, // checked above for every size
              category: r.category as string,
              prepTime: r.prepTime ?? 15,
              imageUrl: r.imageUrl ?? undefined,
              variantGroup: r.variantGroup,
              variantLabel: r.variantLabel,
              isAvailable: true,
            },
          })
          await recordMenuPriceChange(tx, {
            vendorId, userId: reviewerUserId, menuItemId: created.id, name: created.name,
            previousPrice: null, newPrice: created.price,
            source: isNewSizeOfLiveItem ? 'REQUEST_APPROVED_SIZE' : 'REQUEST_APPROVED_ADD', requestId: r.id,
          })
        }
        break
      }
      case 'EDIT': {
        // A live price increase (F2, Nov 13): file-item.ts writes it PENDING carrying the price
        // only, while the item keeps selling at its old price. (An EDIT filed before 2g may also
        // carry other fields; they are applied with it, as before.)
        const itemId = menuItemId as string // checked above
        // The price as it is NOW, read inside the transaction. If the live price dropped while
        // this increase waited, the audit row records that real starting point.
        const before = await tx.menuItem.findUniqueOrThrow({ where: { id: itemId }, select: { price: true, removedAt: true } })
        // Removed while the increase waited: nothing to raise. Refused, so the request stays
        // PENDING and the approver rejects it.
        if (before.removedAt !== null) {
          throw new ApiError('This item is removed from the menu. Reject this request.', 409, 'CONFLICT')
        }
        const after = await tx.menuItem.update({
          where: { id: itemId },
          data: {
            ...(menuRequest.name        !== null && { name: menuRequest.name }),
            ...(menuRequest.description !== null && { description: menuRequest.description }),
            ...(approvedPrice           !== null && { price: approvedPrice }),
            ...(menuRequest.category    !== null && { category: menuRequest.category }),
            ...(menuRequest.prepTime    !== null && { prepTime: menuRequest.prepTime }),
            ...(menuRequest.imageUrl    !== null && { imageUrl: menuRequest.imageUrl }),
          },
        })
        if (approvedPrice !== null && priceChanged(before.price, approvedPrice)) {
          await recordMenuPriceChange(tx, {
            vendorId, userId: reviewerUserId, menuItemId: itemId, name: after.name,
            previousPrice: before.price, newPrice: after.price, source: 'REQUEST_APPROVED_EDIT', requestId,
          })
        }
        break
      }
      case 'DELETE': {
        // Reachable only for a DELETE filed before 2g: since then a vendor's removal applies at
        // once and is written already APPROVED. REMOVED, not deleted: OrderItem's FK to MenuItem
        // is RESTRICT, and a hard delete would SET NULL the request trail.
        const item = await tx.menuItem.findUniqueOrThrow({
          where: { id: menuItemId as string }, select: { name: true, price: true, removedAt: true, variantGroup: true },
        })
        if (item.removedAt !== null) {
          throw new ApiError('This item is already removed from the menu. Reject this request.', 409, 'CONFLICT')
        }
        await tx.menuItem.update({
          where: { id: menuItemId as string },
          data: { removedAt: now },
        })
        // The last live row of its size group gone: the group's waiting new sizes close (F4).
        await closeOrphanedNewSizes(tx, { vendorId, variantGroup: item.variantGroup, closedBy: reviewerUserId, now })
        await recordMenuItemRemoved(tx, {
          vendorId, userId: reviewerUserId, menuItemId: menuItemId as string,
          name: item.name, price: item.price, requestId,
        })
        // The approvers are told, grouped with the vendor's other deletes (audit H5, step 3).
        await recordMenuDeleted(tx, {
          vendorId, menuItemId: menuItemId as string, name: item.name, price: item.price, menuRequestId: requestId,
        })
        break
      }
      case 'RESTORE': {
        // BACK ON THE MENU, at the requested price when the request carries one (a pending
        // RESTORE since 2g is one whose price is higher than the item's last recorded price).
        // Only removedAt and the price change: isAvailable is deliberately untouched, so an item
        // that was sold out when it was removed comes back sold out.
        //
        // History APPENDS: the DELETE that removed the item stays APPROVED, and this is a
        // separate row, so the trail reads "removed → restored".
        const item = await tx.menuItem.findUniqueOrThrow({
          where: { id: menuItemId as string }, select: { name: true, price: true, removedAt: true },
        })
        if (item.removedAt === null) {
          throw new ApiError('This item is already back on the menu. Reject this request.', 409, 'CONFLICT')
        }
        // A restore filed from a re-add by name carries the description, category, prep time and
        // photo the vendor typed; they arrive with it. The stored name is kept.
        await tx.menuItem.update({
          where: { id: menuItemId as string },
          data: {
            removedAt: null,
            ...(approvedPrice           !== null && { price: approvedPrice }),
            ...(menuRequest.description !== null && { description: menuRequest.description }),
            ...(menuRequest.category    !== null && { category: menuRequest.category }),
            ...(menuRequest.prepTime    !== null && { prepTime: menuRequest.prepTime }),
            ...(menuRequest.imageUrl    !== null && { imageUrl: menuRequest.imageUrl }),
          },
        })
        if (approvedPrice !== null && priceChanged(item.price, approvedPrice)) {
          await recordMenuPriceChange(tx, {
            vendorId, userId: reviewerUserId, menuItemId: menuItemId as string, name: item.name,
            previousPrice: item.price, newPrice: approvedPrice, source: 'REQUEST_APPROVED_RESTORE', requestId,
          })
        }
        break
      }
      default:
        assertNeverRequestType(requestType)
      }
    }

    // Only rows that are STILL PENDING flip: this request, or every size of a brand-new item. If a
    // concurrent decision already flipped any of them, throw, and everything this transaction wrote
    // rolls back.
    const flipped = await tx.menuRequest.updateMany({
      where: { id: { in: groupIds }, status: 'PENDING' },
      data: { status: newStatus, reviewedBy: reviewerUserId, reviewedAt: now, reviewNote: reason },
    })
    if (flipped.count !== groupIds.length) throw new ApiError('Request already reviewed', 409, 'CONFLICT')
    const updated = await tx.menuRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { id: true, status: true, reviewNote: true, reviewedAt: true },
    })
    // The decided group goes out with the answer, for the activity-log entries after the commit.
    return { updated, group }
  }, { timeout: 20_000 })

  // Cache busts only after the commit, so they never advertise a change that rolled back.
  if (action === 'APPROVE') expireVendorMenu(vendorId)
  revalidateTag(`event-badges-${event.id}`, 'default')

  // Fire-and-forget: Firebase vendor notification + review log.
  void (async () => {
    try {
      const rtdb = getRealtimeDb()
      if (rtdb) {
        await rtdb.ref(`vendors/${vendorId}/notifications`).push({
          type: 'MENU_REQUEST_REVIEWED',
          requestId,
          requestType: menuRequest.type,
          itemName: menuRequest.name ?? null,
          status: newStatus,
          reason,
          ts: Date.now(),
        })
      }
    } catch (err) {
      logger.warn('[MenuRequest] Firebase notification failed', { requestId, error: String(err) })
    }
  })()

  // One review entry per request row, so each size of a brand-new item is recorded as decided.
  for (const r of group) {
    logVendorAction(vendorId, reviewerUserId, AUDIT_ACTIONS.MENU_CHANGE_REVIEWED, {
      requestId: r.id,
      requestType: r.type,
      action,
      approver: approver.kind,
      itemName: r.name ?? null,
      menuItemId: r.menuItemId ?? null,
      variantGroup: r.variantGroup,
      variantLabel: r.variantLabel,
      reason,
    })
  }

  return updated
}
