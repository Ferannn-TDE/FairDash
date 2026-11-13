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
import { db } from '../db'
import { ApiError } from '../api-error'
import { getRealtimeDb } from '../firebase-admin'
import { logVendorAction, AUDIT_ACTIONS } from '../vendor-audit'
import { logger } from '../logger'
import { assertNeverRequestType, type MenuRequestTypeInput } from './validate-item'
import { menuRequestTargetsOwnItem } from './item-ownership'
import { parseInPersonPrice } from '../menu/price'
import { priceChanged, recordMenuPriceChange, recordMenuItemRemoved } from '../menu/price-audit'

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
  reason?: string | null
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
  const { requestId, event, approver, reviewerUserId, action } = input
  const reason = input.reason ?? null

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

  // ── Checks before anything is written ──────────────────────────────────────────────────
  // Each refusal returns 422 and leaves the request PENDING, so the approver can reject it.
  let approvedPrice: number | null = null
  if (action === 'APPROVE') {
    // OWNERSHIP RE-CHECK (audit H4, defence in depth). Filing now refuses another vendor's item,
    // but a row written before that check existed could still name one.
    if (requestType !== 'ADD') {
      if (!menuItemId) throw unprocessable(`${requestType} request missing menuItemId`)
      if (!(await menuRequestTargetsOwnItem(menuItemId, vendorId))) {
        throw unprocessable('This request names a menu item that does not belong to this vendor')
      }
    }
    if (requestType === 'ADD' && (!menuRequest.name || menuRequest.price === null || !menuRequest.category)) {
      throw unprocessable('Malformed ADD request — missing required fields')
    }
    // PRICE RE-CHECK (audit H5, 2f). A request filed before the $1.00–$10,000 rule (2a) can carry
    // a price the rule now refuses. A RESTORE carries a price since 2g, so it is checked too.
    if (requestType !== 'DELETE' && menuRequest.price !== null) {
      const parsed = parseInPersonPrice(menuRequest.price)
      if (!parsed.ok) {
        throw unprocessable(`This request's price can't be approved: ${parsed.message}. Reject it and ask the vendor to resubmit.`)
      }
      approvedPrice = parsed.value
    }
  }

  // ── One transaction: the menu change, its audit rows, and the review ──────────────────
  const updated = await db.$transaction(async tx => {
    const now = new Date()
    if (action === 'APPROVE') {
      // EXHAUSTIVE BY CONSTRUCTION: a fifth MenuRequestType fails `tsc` at assertNeverRequestType
      // instead of flipping to APPROVED having written nothing.
      switch (requestType) {
      case 'ADD': {
        const created = await tx.menuItem.create({
          data: {
            vendorId,
            name: menuRequest.name as string,
            description: menuRequest.description ?? undefined,
            price: approvedPrice as number,
            category: menuRequest.category as string,
            prepTime: menuRequest.prepTime ?? 15,
            imageUrl: menuRequest.imageUrl ?? undefined,
            isAvailable: true,
          },
        })
        await recordMenuPriceChange(tx, {
          vendorId, userId: reviewerUserId, menuItemId: created.id, name: created.name,
          previousPrice: null, newPrice: created.price, source: 'REQUEST_APPROVED_ADD', requestId,
        })
        break
      }
      case 'EDIT': {
        // Reachable only for an EDIT filed before 2g: since then a vendor's EDIT of a live item
        // applies at once and is written already APPROVED.
        const itemId = menuItemId as string // checked above
        // The price as it is NOW, read inside the transaction. If the live price dropped while
        // this increase waited, the audit row records that real starting point.
        const before = await tx.menuItem.findUniqueOrThrow({ where: { id: itemId }, select: { price: true } })
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
          where: { id: menuItemId as string }, select: { name: true, price: true, removedAt: true },
        })
        if (item.removedAt !== null) {
          throw new ApiError('This item is already removed from the menu. Reject this request.', 409, 'CONFLICT')
        }
        await tx.menuItem.update({
          where: { id: menuItemId as string },
          data: { removedAt: now },
        })
        await recordMenuItemRemoved(tx, {
          vendorId, userId: reviewerUserId, menuItemId: menuItemId as string,
          name: item.name, price: item.price, requestId,
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

    // Only a row that is STILL PENDING flips. A concurrent decision already flipped it: throw, and
    // everything this transaction wrote rolls back.
    const flipped = await tx.menuRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: newStatus, reviewedBy: reviewerUserId, reviewedAt: now, reviewNote: reason },
    })
    if (flipped.count === 0) throw new ApiError('Request already reviewed', 409, 'CONFLICT')
    return tx.menuRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { id: true, status: true, reviewNote: true, reviewedAt: true },
    })
  })

  // Cache busts only after the commit, so they never advertise a change that rolled back.
  if (action === 'APPROVE') revalidateTag(`vendor-menu-${vendorId}`, 'default')
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

  logVendorAction(vendorId, reviewerUserId, AUDIT_ACTIONS.MENU_CHANGE_REVIEWED, {
    requestId,
    requestType: menuRequest.type,
    action,
    approver: approver.kind,
    itemName: menuRequest.name ?? null,
    menuItemId: menuRequest.menuItemId ?? null,
    reason,
  })

  return updated
}
