import { db } from './db'
import { addOrgOwner } from './payee-membership'
import { enqueueSignupAlert, enqueueApplicationReceived } from './notifications'
import { createFairRecord, type CreateFairInput } from './create-fair'
import { WEBSITE_TERMS_VERSION } from './legal/website-terms'
import { PRIVACY_POLICY_VERSION } from './legal/privacy-policy'

/**
 * What the organizer sign-up form adds (sign-up-fixes commit 4; POST /api/organizer/apply is the
 * only caller that passes it). With it, the FIRST bootstrap also saves the organizer's event as a
 * hidden DRAFT (lib/create-fair, the wizard's own code), records their Terms + Privacy acceptance
 * (an ApprovalAction row with action TERMS_ACCEPTED, never a decision) and queues their
 * "we got your application" email — all in the same transaction as the organizer row. The backfill
 * and seed scripts never pass it, so nothing changes for them.
 */
export interface OrganizerApplication {
  website: string | null
  event: CreateFairInput & { startDate: string; endDate: string }
  acceptedBy: { clerkId: string; name: string | null }
}

// ─── Organizer bootstrap — the SINGLE HOME for "provision a self-signup organizer" ──
//
// An organizer's authority is a FairOrganizer + an OrgMember(role='owner') row
// (lib/auth.ts requireOrganizerAuth, app/organizer/layout.tsx, computeRolesFromDb).
// Customers/vendors/runners are NOT bootstrapped here: vendor/runner are event-scoped
// (need an eventId, created when joining an event); a plain customer has no org.
//
// Provisioning runs SYNCHRONOUSLY in POST /api/organizer/apply when the person submits the
// organizer sign-up form (sign-up-fixes commit 4) — never on a page load — so the OrgMember exists
// by the time the portal's DB authority check runs. Until commit 4 it ran in app/onboarding/page.tsx
// on every organizer sign-up; that page now only routes. (Historically this lived in the Clerk
// webhook gated on isNew, where the organizer signal never arrives, so it never fired for a real
// self-signup.) scripts/backfill-clerk-users.ts and scripts/seed-connect-walkthrough.ts call this
// too, without the application argument, so the logic has one home.
//
// Idempotency / concurrency / crash-recovery — all via the repo's native primitive
// (deterministic-id anchor + skipDuplicates = ON CONFLICT DO NOTHING; cf. place-order.ts,
// reconcile-order-status.ts), NOT row-locks:
//   • Already-provisioned  → the OrgMember existence check short-circuits (also protects
//                            pre-existing cuid-id orgs like the backfilled "Feran Events").
//   • Concurrent double-run → both INSERT the SAME deterministic id `org_<userId>`; Postgres
//                            ON CONFLICT DO NOTHING lets exactly one win. No duplicate orgs.
//   • Half-bootstrap (crash between the two writes) → a retry re-derives the SAME id, so the
//                            FairOrganizer INSERT no-ops and the OrgMember INSERT completes.
//                            No orphan, no duplicate.

/**
 * Ensure a self-signup organizer has their FairOrganizer + owner OrgMember, then
 * sync roles[]. Idempotent and concurrency-safe. Never re-bootstraps a user who
 * already has any OrgMember.
 *
 * @param userId   DB User.id (NOT the Clerk id).
 * @param profile  Display/contact fields for a freshly-created FairOrganizer.
 * @returns { organizerId, created } — created=false when the user was already an organizer.
 */
export async function ensureOrganizerBootstrap(
  userId: string,
  profile: { name: string | null; email: string; phone: string | null; contactName?: string | null },
  application?: OrganizerApplication,
): Promise<{ organizerId: string; created: boolean }> {
  // GUARD 1 — never re-bootstrap. Protects already-provisioned organizers (incl.
  // backfilled cuid-id orgs whose id ≠ the deterministic anchor below).
  const existing = await db.orgMember.findFirst({
    where: { userId },
    select: { organizerId: true },
  })
  if (existing) return { organizerId: existing.organizerId, created: false }

  // Deterministic per-user anchor — the collision point that serializes concurrent
  // bootstraps and makes a half-bootstrap recoverable. (FairOrganizer.id is an opaque
  // string; nothing assumes a cuid shape.)
  const organizerId = `org_${userId}`

  // The organizer row and the client's sign-up alert commit together (item 9). Both are
  // idempotent: ON CONFLICT DO NOTHING on the id, and on the alert's dedupe key, so a retried or
  // concurrent bootstrap writes neither twice.
  await db.$transaction(async tx => {
    const inserted = await tx.fairOrganizer.createMany({
      data: [
        {
          id: organizerId,
          name: profile.name ?? profile.email,
          contactEmail: profile.email,
          ...(profile.phone ? { contactPhone: profile.phone } : {}),
          ...(application?.website ? { website: application.website } : {}),
        },
      ],
      skipDuplicates: true, // ON CONFLICT (id) DO NOTHING
    })
    // Only the run that actually inserted the organizer writes the sign-up form's extras, so a
    // double submit can never save two drafts or two Terms records.
    let event: { name: string; city: string | null; state: string | null; startDate: string; endDate: string } | undefined
    if (application && inserted.count === 1) {
      await createFairRecord(tx, organizerId, application.event, { asDraft: true })
      event = {
        name: String(application.event.name).trim(), city: application.event.venueCity ?? null, state: application.event.venueState ?? null,
        startDate: application.event.startDate, endDate: application.event.endDate,
      }
      // Terms + Privacy acceptance: action TERMS_ACCEPTED, never APPROVE/REJECT, so no decision
      // reader (lib/approvals nextDecisionSeq, lib/vendor-review, lib/vendor-go-live) counts it.
      await tx.approvalAction.create({
        data: {
          action: 'TERMS_ACCEPTED', applicationType: 'organizer', applicationId: organizerId,
          actorId: application.acceptedBy.clerkId, actorType: 'applicant', actorName: application.acceptedBy.name,
          detail: { terms: WEBSITE_TERMS_VERSION, privacy: PRIVACY_POLICY_VERSION },
        },
      })
      // No typed name in it (confirmation-email-safety): the payload is the kind only.
      await enqueueApplicationReceived(tx, organizerId, profile.email, { kind: 'organizer' })
    }
    await enqueueSignupAlert(tx, organizerId, {
      kind: 'organizer', name: profile.name ?? profile.email, contactName: profile.contactName ?? profile.name,
      email: profile.email, phone: profile.phone, ...(event ? { event } : {}),
    })
  })

  // Owner OrgMember (ON CONFLICT DO NOTHING) + the organizer role, via the one create helper.
  await addOrgOwner(organizerId, userId)

  return { organizerId, created: true }
}
