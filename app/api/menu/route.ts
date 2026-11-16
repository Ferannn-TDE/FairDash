import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth, requireVendorMayEditMenu } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { revalidateTag } from 'next/cache'
import { getGroupedMenuItemsByEvent } from '@/lib/menu/getGroupedMenuItems'
import { validateMenuRequestItem } from '@/lib/menu-requests/validate-item'
import { clientPriceKey, CLIENT_PRICE_MESSAGE } from '@/lib/menu/price'
import { fileMenuRequestItem } from '@/lib/menu-requests/file-item'
import { menuApproverLabel } from '@/lib/menu-requests/approver-label'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'

// GET /api/menu?eventSlug=&vendorId=
// Public. Returns pre-grouped menu items for a fair; vendorId narrows to one booth.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const eventSlug = searchParams.get('eventSlug')
    const vendorId = searchParams.get('vendorId')

    if (!eventSlug) return apiError('eventSlug is required', 400, 'VALIDATION_ERROR')

    const grouped = await getGroupedMenuItemsByEvent(eventSlug)

    const data = vendorId
      ? grouped.filter((g) => g.vendorId === vendorId)
      : grouped

    return success(data)
  } catch (err) {
    return handleApiError(err)
  }
}

// POST /api/menu
// Adds a menu item, through the SAME filing path as POST /api/menu-requests (H5 Fix B), so the
// direct API can no longer publish a brand-new item that the vendor screen would send for approval:
//   - brand-new item (with or without sizes)       → 202 { requiresApproval, request, approver };
//                                                     nothing is created until it is approved
//   - a new size of an item that is already live   → 201 with the created item (a live edit)
//   - the name of a removed item, same/lower price → 201 with the restored item
//   - the name of a removed item, higher price     → 202 (the restore waits for the approver)
// The caller must be a member of this vendor (404 otherwise, the same answer as a vendor that
// doesn't exist), and the booth and operator must be allowed to edit.
export async function POST(req: Request) {
  try {
    const clerkId = await requireAuth()
    const body = await req.json()
    // The online price is worked out by FairSynq (audit H5, 2h): refuse a body that sends one.
    if (clientPriceKey(body)) return apiError(CLIENT_PRICE_MESSAGE, 400, 'CLIENT_PRICE_NOT_ACCEPTED')
    const { vendorId, name, description, price, category, imageUrl, prepTime, variantGroup, variantLabel } = body

    if (typeof vendorId !== 'string' || !vendorId || !name || price == null || !category) {
      return apiError('vendorId, name, price, and category are required', 400, 'VALIDATION_ERROR')
    }
    // The same per-item rules as the request path (lib/menu-requests/validate-item.ts): the
    // $1.00–$10,000 price rule, a safe image link, and sizes (group and label together).
    const item = { type: 'ADD', name, description, price, category, imageUrl, prepTime, variantGroup, variantLabel }
    const rejection = validateMenuRequestItem(item)
    if (rejection) return apiError(rejection.message, rejection.status, rejection.code)

    // Authorize against THIS vendor. getVendorAuth returns null both for a vendor the caller
    // doesn't belong to and for one that doesn't exist, so both answer the same 404.
    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('Vendor not found', 404, 'NOT_FOUND')
    const isMember = await getVendorAuth(dbUser.id, vendorId, req)
    if (!isMember) return apiError('Vendor not found', 404, 'NOT_FOUND')
    await requireVendorMayEditMenu(dbUser.id, vendorId)

    // One transaction: the request row and, when it applies at once, the menu write and its audit
    // row (lib/menu-requests/file-item.ts).
    const row = await db.$transaction(tx =>
      fileMenuRequestItem(tx, item, { vendorId, requestedBy: dbUser.id, batchId: null }))

    const v = await db.vendor.findUnique({ where: { id: vendorId }, select: { event: { select: { organizerId: true } } } })
    const approver = menuApproverLabel(v?.event.organizerId)
    logVendorAction(vendorId, dbUser.id, AUDIT_ACTIONS.MENU_CHANGE_REQUESTED, {
      requestType: row.type, menuItemId: row.menuItemId, name: row.name, requestId: row.id, batchId: null, status: row.status,
    })

    if (row.status === 'PENDING') {
      return success({ requiresApproval: true, request: { ...row, approver }, approver }, 202)
    }
    revalidateTag(`vendor-menu-${vendorId}`, 'default')
    const live = await db.menuItem.findUniqueOrThrow({ where: { id: row.menuItemId as string } })
    return success(live, 201)
  } catch (err) {
    return handleApiError(err)
  }
}
