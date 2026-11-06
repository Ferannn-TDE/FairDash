import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireApprovalsAdmin } from '@/lib/auth'
import { listPendingApplications } from '@/lib/approvals'
import { outboxStatus } from '@/lib/notifications'

// GET /api/admin/approvals — pending vendor, organizer and partner applications, plus the email
// outbox status line. Gate: admin | super_admin | platform_manager (item 9).
export async function GET(_req: NextRequest) {
  try {
    await requireApprovalsAdmin()
    const [applications, outbox] = await Promise.all([listPendingApplications(), outboxStatus()])
    return success({ ...applications, outbox })
  } catch (err) {
    return handleApiError(err)
  }
}
