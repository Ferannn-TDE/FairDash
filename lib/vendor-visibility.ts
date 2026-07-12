import { db } from './db'
import { getVendorAuth } from './vendor-auth-cache'

/**
 * May this caller view a NON-ACTIVE vendor's public detail page?
 *
 * The status gate on GET /api/vendors/[id] hides a non-ACTIVE vendor (PENDING / PAUSED /
 * SUSPENDED / REJECTED) from CUSTOMERS — but not from themselves. This is the decision that
 * carves the exception, factored out so the authorization can be proven against a real
 * database without the Next-handler / Clerk-env fragility of driving the whole route.
 *
 * Allowed:  the vendor's OWNER (a member), or a platform ADMIN.
 * Refused:  anonymous, and any signed-in stranger.
 * (Organizers review via their own route, /api/organizer/vendors/[id], so they are not a
 * case here.)
 *
 * `isAdmin` is passed in already-resolved (the route computes it from Clerk) so this stays a
 * pure DB question — the caller identity is not trusted from the request beyond the userId
 * the session already proved.
 */
export async function callerMayViewInactiveVendor(
  vendorId: string,
  callerUserId: string | null,
  isAdmin: boolean,
  req?: Request,
): Promise<boolean> {
  if (isAdmin) return true
  if (!callerUserId) return false
  return !!(await getVendorAuth(callerUserId, vendorId, req as never))
}
