import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'
import {
  MAX_BATCH_ITEMS,
  buildMenuRequestData,
  validateMenuRequestItem,
  type MenuRequestItemInput,
} from '@/lib/menu-requests/validate-item'
import { randomUUID } from 'node:crypto'

// POST /api/menu-requests — submit menu change requests for organizer approval.
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
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

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

    // Opaque, server-minted, and never accepted from the client — a caller must not be able to
    // forge a batch id and graft rows onto someone else's submission.
    const batchId = isBatchForm ? `mrb_${randomUUID()}` : null

    // N creates in ONE transaction, using the same `create` the single form uses rather than
    // createMany: createMany is a different query path in Prisma, and the point of this refactor
    // is that the two forms cannot diverge. (There is no Prisma middleware on this client — the
    // only $extends in the repo is the scripts-only prod-write-guard — so nothing per-row is
    // skipped at the ORM layer either way. The one per-row side effect is the audit write
    // below, which is fanned out deliberately.)
    const rows = await db.$transaction(
      inputs.map(item =>
        db.menuRequest.create({
          data: buildMenuRequestData(item, { vendorId, requestedBy: dbUser.id, batchId }),
        }),
      ),
    )

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
      })
    }

    // The batch form answers with the submission id alongside its rows; the single form keeps
    // its original bare-request shape, so every existing caller is untouched.
    return isBatchForm
      ? success({ batchId, requests: rows }, 201)
      : success(rows[0], 201)
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
      if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

      const requests = await db.menuRequest.findMany({
        where: { vendorId },
        orderBy: { createdAt: 'desc' },
        include: { menuItem: { select: { name: true } } },
      })
      return success(requests)
    }

    if (eventId) {
      // Verify organizer membership
      // Soft-deleted fair's menu-requests are not accessible.
      const event = await db.event.findFirst({ where: { id: eventId, archivedAt: null }, select: { organizerId: true } })
      if (!event) return apiError('Event not found', 404, 'NOT_FOUND')
      if (event.organizerId) {
        const isOrg = await db.orgMember.findFirst({ where: { organizerId: event.organizerId, userId: dbUser.id } })
        if (!isOrg) return apiError('Access denied', 403, 'FORBIDDEN')
      }

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
