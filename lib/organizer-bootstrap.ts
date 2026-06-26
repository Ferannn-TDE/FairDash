import { db } from './db'
import { logger } from './logger'
import { syncUserRoleMetadata } from './role-sync'

// ─── Organizer bootstrap — the SINGLE HOME for "provision a self-signup organizer" ──
//
// An organizer's authority is a FairOrganizer + an OrgMember(role='owner') row
// (lib/auth.ts requireOrganizerAuth, app/organizer/layout.tsx, computeRolesFromDb).
// Customers/vendors/runners are NOT bootstrapped here: vendor/runner are event-scoped
// (need an eventId, created when joining an event); a plain customer has no org.
//
// Provisioning runs SYNCHRONOUSLY in app/onboarding/page.tsx (before its redirect to
// /organizer) so the OrgMember exists by the time the portal's DB authority check runs
// — no eventual-consistency bounce to /organizer/unauthorized. (Historically this lived
// in the Clerk webhook gated on isNew, where the organizer signal never arrives, so it
// never fired for a real self-signup. That branch is gone; this is the only live path.)
// scripts/backfill-clerk-users.ts calls this too, so the logic has one home.
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
  profile: { name: string | null; email: string; phone: string | null },
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

  await db.fairOrganizer.createMany({
    data: [
      {
        id: organizerId,
        name: profile.name ?? profile.email,
        contactEmail: profile.email,
        ...(profile.phone ? { contactPhone: profile.phone } : {}),
      },
    ],
    skipDuplicates: true, // ON CONFLICT (id) DO NOTHING
  })

  await db.orgMember.createMany({
    data: [{ organizerId, userId, role: 'owner' }],
    skipDuplicates: true, // ON CONFLICT (organizerId, userId) DO NOTHING
  })

  // Membership-create path → derive roles[] from the DB authority (house rule).
  // Best-effort: the DB is the authority, so a transient Clerk failure self-heals on
  // the next login/sync (and onboarding has already written roles[] directly).
  try {
    await syncUserRoleMetadata(userId)
  } catch (err) {
    logger.error('[organizer-bootstrap] roles[] sync failed (DB is authority; will self-heal)', {
      userId,
      err: err instanceof Error ? err.message : String(err),
    })
  }

  return { organizerId, created: true }
}
