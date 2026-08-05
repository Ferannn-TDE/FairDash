import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireStrictAdminAuth } from '@/lib/auth'

// GET /api/admin/vendor-members
//
// The Vendor Operators panel's backing list — the READ half of the operator admittance axis.
//
// STRICT GATE, same as the writes it feeds. Seeing who is waiting, who was refused and why is as
// sensitive as making those calls, so the read does not get a weaker gate than the write.
//
// PLATFORM-LEVEL, not fair-scoped: VendorMember has no eventId (it reaches an event only through
// vendor.event) and a person may operate booths at several fairs. Like /api/admin/organizers this
// is an unscoped findMany BY DESIGN — an admin oversees operators it does not own — and it
// resolves VendorMember rows, never an Event, so the admin fair-chokepoint invariant is untouched.
//
// TWO AXES, RETURNED SEPARATELY AND NEVER MERGED. `approvalStatus` is the OPERATOR (may this human
// work this booth); `vendor.status` is the BOOTH (may this stall trade). The panel shows both
// because the interesting cases are the disagreements — an APPROVED operator on a PENDING booth
// cannot take orders, and a PENDING operator on an ACTIVE booth is the gap this axis closes.
// Collapsing them into one "status" server-side would destroy that distinction before the UI saw it.
export async function GET(_req: NextRequest) {
  try {
    await requireStrictAdminAuth()

    const members = await db.vendorMember.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        role: true,
        createdAt: true, // "joined at" — how long has this operator been waiting?

        approvalStatus: true,
        approvedAt: true,
        approvedBy: true,
        rejectionReason: true,

        user: { select: { id: true, name: true, email: true } },
        vendor: {
          select: {
            id: true, name: true, slug: true,
            status: true, // the BOOTH axis — deliberately distinct from approvalStatus above
            stripeVerified: true,
            event: { select: { id: true, name: true, urlSlug: true } },
          },
        },
      },
    })

    // Work-queue order: PENDING (needs a decision) → APPROVED → REJECTED (terminal-ish, but
    // re-admittable). This panel is a queue before it is a directory.
    const RANK: Record<string, number> = { PENDING: 0, APPROVED: 1, REJECTED: 2 }

    return success({
      vendorMembers: members
        .sort((a, b) => (RANK[a.approvalStatus] ?? 9) - (RANK[b.approvalStatus] ?? 9))
        .map(m => ({
          id: m.id,
          role: m.role,
          joinedAt: m.createdAt,

          approvalStatus: m.approvalStatus,
          approvedAt: m.approvedAt,
          approvedBy: m.approvedBy,
          rejectionReason: m.rejectionReason,

          operator: { id: m.user.id, name: m.user.name, email: m.user.email },
          booth: {
            id: m.vendor.id,
            name: m.vendor.name,
            slug: m.vendor.slug,
            status: m.vendor.status,
            stripeVerified: m.vendor.stripeVerified,
          },
          fair: m.vendor.event
            ? { id: m.vendor.event.id, name: m.vendor.event.name, slug: m.vendor.event.urlSlug }
            : null,
        })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
