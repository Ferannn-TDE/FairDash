import { NextRequest } from 'next/server'
import { expireVendorMenu } from '@/lib/menu/menu-cache'
import type { MenuRequest } from '@prisma/client'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth, requireVendorMayEditMenu } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'
import {
  MAX_BATCH_ITEMS,
  validateMenuRequestItem,
  type MenuRequestItemInput,
} from '@/lib/menu-requests/validate-item'
import { checkMenuRequestItemOwnership } from '@/lib/menu-requests/item-ownership'
import { fileMenuRequestItem } from '@/lib/menu-requests/file-item'
import { menuApproverLabel, type MenuApproverLabel } from '@/lib/menu-requests/approver-label'
import { randomUUID } from 'node:crypto'

/** Who this vendor's pending requests wait for: the fair's organizer, or FairSynq if it has none. */
async function vendorApprover(vendorId: string): Promise<MenuApproverLabel> {
  const v = await db.vendor.findUnique({ where: { id: vendorId }, select: { event: { select: { organizerId: true } } } })
  return menuApproverLabel(v?.event.organizerId)
}

// POST /api/menu-requests — submit menu changes. Removals, edits of live items, and restores that
// don't raise the price apply immediately; brand-new items and higher-priced restores wait for the
// approver (see the transaction below).
//
// TWO BODY SHAPES, ONE PATH:
//   { vendorId, type, name, ... }             one request, batchId null (standalone)
//   { vendorId, items: [ {...}, {...} ] }     one submission, every row sharing a batchId
//
// The single form is treated as a batch of one that is simply not given a batch id, so both
// shapes run the SAME validation, build the SAME row, and go through the SAME create. Two
// write paths with their own copies of those rules is how a price the single form refuses
// starts landing through the batch form with nothing reporting the disagreement.
//
// ATOMIC. A batch is written in one transaction: either every row lands or none does. A
// half-applied submission would leave the vendor looking at a menu they did not submit and the
// organizer approving items whose siblings silently vanished. Every item is validated BEFORE
// anything is written, so an invalid item 6 is refused while items 1-5 do not exist yet.
//
// Approval stays PER ITEM — this groups rows, it does not make them one decision.
export async function POST(req: NextRequest) {
  try {
    const clerkId = await requireAuth()
    const body = await req.json()
    const { vendorId, items } = body as { vendorId?: string; items?: unknown }

    if (!vendorId) return apiError('vendorId is required', 400, 'VALIDATION_ERROR')

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const isMember = await getVendorAuth(dbUser.id, vendorId, req)
    if (!isMember) return apiError('Vendor not found', 404, 'NOT_FOUND')
    await requireVendorMayEditMenu(dbUser.id, vendorId)

    const isBatchForm = Array.isArray(items)
    const inputs: MenuRequestItemInput[] = isBatchForm
      ? (items as MenuRequestItemInput[])
      : [body as MenuRequestItemInput]

    if (isBatchForm) {
      if (inputs.length === 0) {
        return apiError('items must contain at least one item', 400, 'VALIDATION_ERROR')
      }
      if (inputs.length > MAX_BATCH_ITEMS) {
        // Tell them what to DO. This bound exists to keep one transaction short, not to cap a
        // menu, so the way through is to send it as two submissions — each approved per item
        // exactly the same way.
        return apiError(
          `A submission may contain at most ${MAX_BATCH_ITEMS} items — please split this into two submissions`,
          400,
          'VALIDATION_ERROR',
        )
      }
    }

    // VALIDATE EVERYTHING FIRST. Not merely tidy: it is what makes "nothing landed" true for
    // the common rejection, rather than relying on the transaction to unwind writes that
    // should never have been attempted.
    for (let i = 0; i < inputs.length; i++) {
      const rejection = validateMenuRequestItem(inputs[i])
      if (rejection) {
        return apiError(
          isBatchForm ? `Item ${i + 1}: ${rejection.message}` : rejection.message,
          rejection.status,
          rejection.code,
        )
      }
    }

    // OWNERSHIP (audit H4). Every item an EDIT, DELETE or RESTORE names must be this vendor's
    // own, in the right removed state. Checked before anything is written, like validation.
    const ownership = await checkMenuRequestItemOwnership(vendorId, inputs)
    if (ownership) {
      return apiError(
        isBatchForm ? `Item ${ownership.index + 1}: ${ownership.message}` : ownership.message,
        ownership.status,
        ownership.code,
      )
    }

    // Opaque, server-minted, and never accepted from the client — a caller must not be able to
    // forge a batch id and graft rows onto someone else's submission.
    const batchId = isBatchForm ? `mrb_${randomUUID()}` : null

    // ONE TRANSACTION, items applied in submission order (audit H5, Step 2g). Each item is either
    // APPLIED NOW and written already APPROVED, or written PENDING for the approver:
    //   DELETE                            applied now: the item leaves the menu immediately
    //   EDIT of a live item               applied now, every field (a price move is audited)
    //   RESTORE, no price / same / lower  applied now: back on the menu (the price write audited)
    //   RESTORE, higher price             PENDING; the item stays removed at its old price
    //   ADD naming a removed item         becomes a RESTORE of that row, same price rule
    //   any other ADD (a brand-new item)  PENDING
    // A newer price change for an item replaces any older PENDING one (supersede.ts). Each item
    // goes through the same per-item code whichever body shape it arrived in, so the two forms
    // cannot diverge; if any write or audit row fails, the whole submission rolls back.
    const rows = await db.$transaction(
      async tx => {
        const written: MenuRequest[] = []
        for (const item of inputs) {
          written.push(await fileMenuRequestItem(tx, item, { vendorId, requestedBy: dbUser.id, batchId }))
        }
        return written
      },
      // A 50-item batch is a few hundred statements; the default 5 s would cut it off on a slow
      // connection. The cap on batch size (MAX_BATCH_ITEMS) is what bounds this.
      { timeout: 20_000 },
    )

    // The live menu changed only if something was applied now.
    if (rows.some(r => r.status === 'APPROVED')) expireVendorMenu(vendorId)

    // ONE AUDIT ENTRY PER ROW — never one per submission. The audit log is the per-decision
    // record: collapsing a batch of 8 into a single entry would lose seven of them, and the
    // batchId in the metadata is what lets a reader reassemble the submission afterwards.
    for (const row of rows) {
      logVendorAction(vendorId, dbUser.id, AUDIT_ACTIONS.MENU_CHANGE_REQUESTED, {
        requestType: row.type,
        menuItemId:  row.menuItemId,
        name:        row.name,
        requestId:   row.id,
        batchId:     row.batchId,
        status:      row.status,
      })
    }

    // Every row names who a PENDING request waits for: the organizer, or FairSynq when the fair has
    // none, so the vendor's screen can say so (lib/menu-requests/approver-label.ts).
    const approver = await vendorApprover(vendorId)
    const answered = rows.map(r => ({ ...r, approver }))

    // The batch form answers with the submission id alongside its rows; the single form keeps
    // its original bare-request shape, so every existing caller is untouched.
    return isBatchForm
      ? success({ batchId, requests: answered }, 201)
      : success(answered[0], 201)
  } catch (err) {
    return handleApiError(err)
  }
}

// GET /api/menu-requests?vendorId=xxx — list requests for a vendor (vendor auth)
// GET /api/menu-requests?eventId=xxx — list pending requests for an event (organizer auth)
export async function GET(req: NextRequest) {
  try {
    const clerkId = await requireAuth()
    const vendorId = req.nextUrl.searchParams.get('vendorId')
    const eventId = req.nextUrl.searchParams.get('eventId')

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    if (vendorId) {
      const isMember = await getVendorAuth(dbUser.id, vendorId, req)
      if (!isMember) return apiError('Vendor not found', 404, 'NOT_FOUND')

      const requests = await db.menuRequest.findMany({
        where: { vendorId },
        orderBy: { createdAt: 'desc' },
        include: { menuItem: { select: { name: true } } },
      })
      // Same per-row approver label as POST; the response stays a flat array for every caller.
      const approver = await vendorApprover(vendorId)
      return success(requests.map(r => ({ ...r, approver })))
    }

    if (eventId) {
      // Verify organizer membership
      // Soft-deleted fair's menu-requests are not accessible.
      const event = await db.event.findFirst({ where: { id: eventId, archivedAt: null }, select: { organizerId: true } })
      if (!event) return apiError('Event not found', 404, 'NOT_FOUND')
      // A fair with NO organizer is decided by platform admins, through
      // /api/admin/events/[id]/menu-requests. This branch used to skip the membership check for
      // such a fair, so any signed-in user could list its requests (audit H5, 2g).
      if (!event.organizerId) return apiError('Event not found', 404, 'NOT_FOUND')
      const isOrg = await db.orgMember.findFirst({ where: { organizerId: event.organizerId, userId: dbUser.id } })
      // Same answer as a fair that doesn't exist, so fair ids can't be probed.
      if (!isOrg) return apiError('Event not found', 404, 'NOT_FOUND')

      const requests = await db.menuRequest.findMany({
        where: { vendor: { eventId } },
        orderBy: { createdAt: 'desc' },
        include: {
          menuItem: { select: { name: true } },
          vendor: { select: { name: true } },
        },
      })
      return success(requests)
    }

    return apiError('vendorId or eventId is required', 400, 'VALIDATION_ERROR')
  } catch (err) {
    return handleApiError(err)
  }
}
