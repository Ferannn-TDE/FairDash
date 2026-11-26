import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireApprovalsAdmin } from '@/lib/auth'
import { countPendingApplications } from '@/lib/approvals'

// GET /api/admin/approvals/count — how many applications are waiting on the Approvals page
// (vendor booths on live fairs, organizers, partners). It feeds the admin sidebar's Approvals
// badge (Approvals front door, Jordan, Nov 25). Same gate as the page and GET /api/admin/approvals:
// admin | super_admin | platform_manager.
export async function GET(_req: NextRequest) {
  try {
    await requireApprovalsAdmin()
    return success({ pending: await countPendingApplications() })
  } catch (err) {
    return handleApiError(err)
  }
}
