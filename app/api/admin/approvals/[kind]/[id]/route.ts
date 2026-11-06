import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireApprovalsAdmin } from '@/lib/auth'
import { decide, type Decision } from '@/lib/approvals'
import type { ApplicationKind } from '@/lib/notifications'

// POST /api/admin/approvals/{vendor|organizer|partner}/{id}   body: { decision: 'approve'|'reject', reason? }
// One decision per application (lib/approvals.ts). Reject needs a reason: it's shown to the applicant.
const KINDS: ApplicationKind[] = ['vendor', 'organizer', 'partner']

export async function POST(req: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const actor = await requireApprovalsAdmin()
    const { kind, id } = await params
    if (!KINDS.includes(kind as ApplicationKind)) throw new ApiError('Unknown application type', 404, 'NOT_FOUND')
    const body = await req.json().catch(() => ({}))
    const decision = body?.decision as Decision
    if (decision !== 'approve' && decision !== 'reject') throw new ApiError('decision must be approve or reject', 400, 'VALIDATION_ERROR')
    const result = await decide(kind as ApplicationKind, id, decision, body?.reason, actor)
    if (kind === 'vendor') revalidateTag('vendors', 'default') // an approved booth becomes orderable
    return success(result)
  } catch (err) {
    return handleApiError(err)
  }
}
