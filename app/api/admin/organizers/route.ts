import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireStrictAdminAuth } from '@/lib/auth'

// GET /api/admin/organizers
// The Organizers panel's backing list — the READ half of the approval gate (#7) and the A6
// kill-switch, which until now were API-only with no surface.
//
// STRICT GATE (admin | super_admin, NOT event_operator) — the same gate as the approve /
// reject / suspend writes it feeds. Reading who is pending, who was rejected and why, and who
// we have suspended is exactly as sensitive as making those decisions, so the read does not
// get a weaker gate than the write. An organizer is PLATFORM-level (they own many fairs), so
// this deliberately does NOT ride the fair-scoped chokepoint — same scoping call as slice 2.
//
// Like /api/admin/fairs, this is an unscoped findMany BY DESIGN (an admin oversees organizers
// it does not own, so the list cannot be derived from ownership). It resolves a FairOrganizer,
// not an Event, and is a list — so the admin grep invariant (no unscoped single-resource
// event.findFirst/findUnique under app/api/admin) is untouched.
//
// TWO INDEPENDENT FACTS, SHIPPED SEPARATELY: approvalStatus ("may you operate at all") and
// suspendedAt ("you were approved, but we stopped you") are returned as distinct fields and
// are NEVER merged into a single status here. The panel derives its two badges from them via
// lib/organizer-admin-view — collapsing them server-side would destroy the distinction before
// the UI ever saw it.
export async function GET(_req: NextRequest) {
  try {
    await requireStrictAdminAuth()

    const organizers = await db.fairOrganizer.findMany({
      orderBy: [
        // Pending first — this panel is a work queue before it is a directory.
        { approvalStatus: 'asc' }, // APPROVED | PENDING | REJECTED → enum order; re-sorted below
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        name: true,
        contactEmail: true,
        contactPhone: true,
        website: true,
        createdAt: true, // "applied at" — how long has this application been waiting?

        // The approval axis (#7) + its audit trail. The rejection reason is the organizer's
        // explanation (the gate surfaces it to them), so the admin must see what was said.
        approvalStatus: true,
        approvedAt: true,
        approvedBy: true,
        rejectionReason: true,

        // The suspension axis (A6) — a DIFFERENT fact from approval, kept separate.
        suspendedAt: true,
        suspendedReason: true,

        // Decision-relevant: can this organizer actually be paid? An approved organizer with
        // no Connect account cannot receive a batch payout, which an admin wants to see at
        // the moment they approve.
        stripeAccountId: true,
        stripeVerified: true,
        stripeConnectedAt: true,

        // Their fairs. Rendered so Option A's payoff is VISIBLE, not merely asserted in a
        // test: because fair CREATION is itself gated, a pending/rejected organizer owns 0
        // fairs — there is nothing orphaned to clean up.
        fairs: {
          select: { id: true, name: true, urlSlug: true, status: true, archivedAt: true },
          orderBy: { startDate: 'desc' },
        },
      },
    })

    // Work-queue order: PENDING (needs a decision) → APPROVED → REJECTED (terminal).
    const RANK: Record<string, number> = { PENDING: 0, APPROVED: 1, REJECTED: 2 }

    return success({
      organizers: organizers
        .sort((a, b) => (RANK[a.approvalStatus] ?? 9) - (RANK[b.approvalStatus] ?? 9))
        .map(o => ({
          id: o.id,
          name: o.name,
          contactEmail: o.contactEmail,
          contactPhone: o.contactPhone,
          website: o.website,
          appliedAt: o.createdAt,

          approvalStatus: o.approvalStatus,
          approvedAt: o.approvedAt,
          approvedBy: o.approvedBy,
          rejectionReason: o.rejectionReason,

          suspendedAt: o.suspendedAt,
          suspendedReason: o.suspendedReason,

          stripeConnected: !!o.stripeAccountId,
          stripeVerified: o.stripeVerified,
          stripeConnectedAt: o.stripeConnectedAt,

          fairs: o.fairs.map(f => ({
            id: f.id,
            name: f.name,
            urlSlug: f.urlSlug,
            status: f.status,
            archived: !!f.archivedAt,
          })),
          fairCount: o.fairs.length,
        })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
