// The latest approve/reject decision for each vendor, labelled for ONE viewer (Jordan, Nov 16).
// Reads ApprovalAction (written by lib/approvals.ts); the label rules live in lib/reviewer-label.ts,
// so a caller can only ever get the words its viewer is allowed to see, never the raw name.

import { db } from './db'
import { reviewerLabel, type ReviewViewer } from './reviewer-label'

export interface VendorReviewLine {
  decision: 'APPROVE' | 'REJECT'
  by: string
  at: Date
}

export async function latestVendorReviews(vendorIds: string[], viewer: ReviewViewer): Promise<Map<string, VendorReviewLine>> {
  const out = new Map<string, VendorReviewLine>()
  if (vendorIds.length === 0) return out
  const rows = await db.approvalAction.findMany({
    where: { applicationType: 'vendor', applicationId: { in: vendorIds }, action: { in: ['APPROVE', 'REJECT'] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { applicationId: true, action: true, actorType: true, actorName: true, detail: true, createdAt: true },
  })
  for (const r of rows) {
    if (out.has(r.applicationId)) continue // newest first: the first row per vendor is its latest decision
    out.set(r.applicationId, {
      decision: r.action === 'APPROVE' ? 'APPROVE' : 'REJECT',
      by: reviewerLabel(viewer, r),
      at: r.createdAt,
    })
  }
  return out
}
