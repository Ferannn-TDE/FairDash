import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { resolveOwnedFair } from '@/lib/organizer-fair-context'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { getRealtimeDb } from '@/lib/firebase-admin'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'
import { logger } from '@/lib/logger'
import { assertNeverRequestType, type MenuRequestTypeInput } from '@/lib/menu-requests/validate-item'
import { menuRequestTargetsOwnItem } from '@/lib/menu-requests/item-ownership'
import { parseInPersonPrice } from '@/lib/menu/price'
import { priceChanged, recordMenuPriceChange } from '@/lib/menu/price-audit'

// PATCH /api/organizer/fairs/[fairSlug]/menu-requests/[id]
// { action: 'APPROVE' | 'REJECT', reason?: string }
// APPROVE: applies the menu change live and revalidates vendor-menu cache.
// REJECT: marks rejected with optional reason.
// Both: writes Firebase vendor notification + audit log entry.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string; id: string }> }
) {
  try {
    const { organizerId, clerkId } = await requireOrganizerAuth()
    const { fairSlug, id: requestId } = await params

    // Verify fair ownership
    const event = await resolveOwnedFair(fairSlug, organizerId)

    const body = await req.json() as { action?: string; reason?: string }
    const { action, reason } = body

    if (!action || !['APPROVE', 'REJECT'].includes(action)) {
      return apiError('action must be APPROVE or REJECT', 400, 'VALIDATION_ERROR')
    }

    const menuRequest = await db.menuRequest.findUnique({
      where: { id: requestId },
      include: { vendor: { select: { id: true, name: true, eventId: true } } },
    })
    if (!menuRequest) return apiError('Request not found', 404, 'NOT_FOUND')
    if (menuRequest.vendor.eventId !== event.id) return apiError('Request not in this fair', 403, 'FORBIDDEN')
    if (menuRequest.status !== 'PENDING') return apiError('Request already reviewed', 409, 'CONFLICT')

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const vendorId = menuRequest.vendor.id
    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    const requestType: MenuRequestTypeInput = menuRequest.type
    const menuItemId = menuRequest.menuItemId

    // ── Checks before anything is written ────────────────────────────────────────────────
    // Each refusal returns 422 and leaves the request PENDING, so the organizer can reject it.
    let approvedPrice: number | null = null
    if (action === 'APPROVE') {
      // OWNERSHIP RE-CHECK (audit H4, defence in depth). Filing now refuses another vendor's
      // item, but a row written before that check existed could still name one. Refuse to apply
      // it; the request stays PENDING so the organizer can reject it.
      if (requestType !== 'ADD') {
        if (!menuItemId) {
          return apiError(`${requestType} request missing menuItemId`, 422, 'UNPROCESSABLE')
        }
        if (!(await menuRequestTargetsOwnItem(menuItemId, vendorId))) {
          return apiError('This request names a menu item that does not belong to this vendor', 422, 'UNPROCESSABLE')
        }
      }
      if (requestType === 'ADD' && (!menuRequest.name || menuRequest.price === null || !menuRequest.category)) {
        return apiError('Malformed ADD request — missing required fields', 422, 'UNPROCESSABLE')
      }
      // PRICE RE-CHECK (audit H5, 2f). A request filed before the $1.00–$10,000 rule (2a) can
      // carry a price the rule now refuses; approving it would put that price on the menu. The
      // same rule every write path uses (lib/menu/price.ts).
      if ((requestType === 'ADD' || requestType === 'EDIT') && menuRequest.price !== null) {
        const parsed = parseInPersonPrice(menuRequest.price)
        if (!parsed.ok) {
          return apiError(`This request's price can't be approved: ${parsed.message}. Reject it and ask the vendor to resubmit.`, 422, 'UNPROCESSABLE')
        }
        approvedPrice = parsed.value
      }
    }

    // ── One transaction: the menu change, its price audit row, and the review ────────────
    // ATOMIC (audit H5, 2f). The item write and the request's status used to be two separate
    // writes: if the second failed, the change was live but the request still read PENDING, and
    // approving an ADD again created a duplicate item. Now both commit or neither does, and the
    // price audit row (lib/menu/price-audit.ts) is in the same transaction, so a price change
    // that cannot be recorded does not happen.
    const updated = await db.$transaction(async tx => {
      // Apply change if approved.
      //
      // EXHAUSTIVE BY CONSTRUCTION. This was an if/else-if chain over ADD/EDIT/DELETE, and adding
      // a fourth type left RESTORE matching nothing: the request would flip to APPROVED having
      // written NOTHING, and organizer and vendor would both believe the change had happened.
      // The chain is now a switch closed by assertNeverRequestType, so a FIFTH type fails `tsc`
      // here rather than falling through to approval theatre at runtime.
      if (action === 'APPROVE') {
        switch (requestType) {
        case 'ADD': {
          // name, category and approvedPrice were checked above.
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
            vendorId, userId: dbUser.id, menuItemId: created.id, name: created.name,
            previousPrice: null, newPrice: created.price, source: 'REQUEST_APPROVED_ADD', requestId,
          })
          break
        }
        case 'EDIT': {
          const itemId = menuItemId as string // checked above
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
              vendorId, userId: dbUser.id, menuItemId: itemId, name: after.name,
              previousPrice: before.price, newPrice: after.price, source: 'REQUEST_APPROVED_EDIT', requestId,
            })
          }
          break
        }
        case 'DELETE': {
          // REMOVED, not sold out. This used to write `isAvailable: false`, which is the
          // sold-out flag — so approving a removal produced an item that read as temporarily
          // unavailable and stayed on the menu. removedAt is the state that actually means
          // "taken off the menu", and it is reversible (removedAt = null restores).
          //
          // The row is kept deliberately: OrderItem's FK to MenuItem is RESTRICT, so an ordered
          // item cannot be deleted at all, and a hard delete would SET NULL the MenuRequest that
          // minted it, severing this very audit trail.
          await tx.menuItem.update({
            where: { id: menuItemId as string },
            data: { removedAt: new Date() },
          })
          break
        }
        case 'RESTORE': {
          // BACK ON THE MENU. Only removedAt is cleared — isAvailable is deliberately untouched,
          // so an item that was SOLD OUT when it was removed comes back sold out rather than
          // being silently put back on sale. Removal and the sold-out flag are different axes.
          //
          // This write lives HERE, behind requireOrganizerAuth, and nowhere else: removal is an
          // organizer decision, so undoing it has to be one too. The vendor-direct availability
          // route may write isAvailable and must never touch removedAt.
          //
          // History APPENDS. This does not reopen or edit the DELETE request that removed the
          // item — that row stays APPROVED forever, and this RESTORE is a separate row, so the
          // trail reads "removed (approved) → restored (approved)": two events, and the fact of
          // the removal is never rewritten.
          await tx.menuItem.update({
            where: { id: menuItemId as string },
            data: { removedAt: null },
          })
          break
        }
        default:
          // Unreachable while the switch is exhaustive. If a fifth MenuRequestType is ever added
          // without a case here, THIS line fails to compile — which is the whole point.
          assertNeverRequestType(requestType)
        }
      }

      return tx.menuRequest.update({
        where: { id: requestId },
        data: {
          status: newStatus,
          reviewedBy: dbUser.id,
          reviewedAt: new Date(),
          reviewNote: reason ?? null,
        },
      })
    })

    // Cache busts only after the transaction committed, so they never advertise a change that
    // rolled back.
    if (action === 'APPROVE') revalidateTag(`vendor-menu-${vendorId}`, 'default')
    revalidateTag(`event-badges-${event.id}`, 'default')

    // Fire-and-forget: Firebase vendor notification + audit log
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
            reason: reason ?? null,
            ts: Date.now(),
          })
        }
      } catch (err) {
        logger.warn('[MenuRequest] Firebase notification failed', { requestId, error: String(err) })
      }
    })()

    logVendorAction(vendorId, dbUser.id, AUDIT_ACTIONS.MENU_CHANGE_REVIEWED, {
      requestId,
      requestType: menuRequest.type,
      action,
      itemName: menuRequest.name ?? null,
      menuItemId: menuRequest.menuItemId ?? null,
      reason: reason ?? null,
    })

    return success({
      id: updated.id,
      status: updated.status,
      reviewNote: updated.reviewNote,
      reviewedAt: updated.reviewedAt,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
