import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorMembershipById } from '@/lib/auth'
import { listReturnsForVendor } from '@/lib/strand-escalation'

// GET /api/vendors/:id/returns  — Commit 2, U5 (vendor returns surface)
//
// Orders awaiting THIS vendor's return-confirm (a runner has the bag and asked to hand it back).
// Keyed on returnRequestedAt, VOS-independent — this is a NEW query, not a filter on the kitchen
// lanes (which hide RUNNER_COLLECTED). The vendor confirms via POST /api/orders/:id/confirm-return.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const vendorId = (await params).id
    await requireVendorMembershipById(vendorId, req)
    const returns = await listReturnsForVendor(vendorId)
    return success({ returns })
  } catch (err) {
    return handleApiError(err)
  }
}
