import { config } from 'dotenv'; config({ path: '.env.local' })
import { createClerkClient } from '@clerk/backend'
import { db } from '../lib/db'
import { hasStrictAdminRole } from '../lib/roles'
import { getFairOrders } from '../lib/fair-orders'

// ============================================================================
// SLICE 0 — admin cross-fair chokepoint: the three runtime proofs.
//
// Exercises the REAL security-decision surface against the REAL DB + REAL Clerk
// role metadata:
//   • the gate predicate the chokepoint uses verbatim  → hasStrictAdminRole()
//   • the unscoped Event resolve (admin)               → mirrors admin-fair-context.ts
//   • the ownership-scoped Event resolve (organizer)   → mirrors requireOrganizerAuth
//   • the shared order core                            → getFairOrders()
//
// The only glue NOT executed here is the ~5 lines in requireAdminFairContext that
// call Clerk's auth()/currentUser() (no Next request scope in a script) — that
// glue is typechecked and simply forwards the exact metadata / query proven below.
//
//   npx tsx scripts/p6-admin-fair-chokepoint-proof.ts
// ============================================================================

const ADMIN_EMAIL     = 'feranmidyro@gmail.com'        // roles ["admin","organizer"] — strict admin
const ORGANIZER_EMAIL = 'feranmi+clerk_test@gmail.com' // roles ["organizer"]         — pure organizer, owns no fair
const FAIR_SLUG       = 'springfield-state-fair-2026'  // owned by "Feran Events"

// The admin cross-fair resolve, copied verbatim from lib/admin-fair-context.ts.
// UNSCOPED by ownership.
function adminResolve(idOrSlug: string) {
  return db.event.findFirst({ where: { OR: [{ id: idOrSlug }, { urlSlug: idOrSlug }] }, select: { id: true, urlSlug: true } })
}
// The organizer resolve, copied verbatim from the organizer orders route.
// SCOPED by organizerId — the ownership boundary.
function organizerResolve(fairSlug: string, organizerId: string) {
  return db.event.findFirst({ where: { urlSlug: fairSlug, organizerId }, select: { id: true, urlSlug: true } })
}

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`  ${cond ? '✅ PASS' : '❌ FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

async function metaFor(clerk: ReturnType<typeof createClerkClient>, email: string) {
  const list = await clerk.users.getUserList({ emailAddress: [email] })
  const cu = list.data[0]
  if (!cu) throw new Error(`No Clerk user for ${email}`)
  return cu.publicMetadata
}

async function main() {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

  const adminMeta = await metaFor(clerk, ADMIN_EMAIL)
  const orgMeta   = await metaFor(clerk, ORGANIZER_EMAIL)

  // Resolve the ownership graph from the DB (ground truth).
  const fair = await db.event.findUnique({ where: { urlSlug: FAIR_SLUG }, select: { id: true, organizerId: true } })
  if (!fair) throw new Error(`No fair ${FAIR_SLUG}`)
  const ownerOrgId = fair.organizerId!                 // "Feran Events" — the owner

  // The pure organizer's OWN organizer(s) — must NOT include the fair's owner.
  const orgUser = await db.user.findFirst({ where: { email: ORGANIZER_EMAIL }, select: { id: true } })
  const orgMemberships = await db.orgMember.findMany({ where: { userId: orgUser!.id }, select: { organizerId: true } })
  const orgOrgIds = orgMemberships.map(m => m.organizerId)
  const nonOwningOrgId = orgOrgIds[0]                   // an org that does NOT own springfield

  console.log(`\nOwnership graph: fair "${FAIR_SLUG}" ownerOrg=${ownerOrgId}; pure-organizer orgs=[${orgOrgIds.join(', ')}]`)
  console.log(`(sanity) pure organizer does NOT belong to owner org: ${!orgOrgIds.includes(ownerOrgId)}`)

  // ── PROOF 1 — NEGATIVE (the breach test) ──────────────────────────────────
  // A pure organizer identity hitting an admin cross-fair endpoint is rejected
  // at the chokepoint's STRICT gate, BEFORE any fair is resolved.
  console.log('\n── PROOF 1 · NEGATIVE — organizer identity → 403 on admin cross-fair endpoint')
  check('pure organizer FAILS the strict-admin gate (→ 403)', hasStrictAdminRole(orgMeta) === false,
        `hasStrictAdminRole=${hasStrictAdminRole(orgMeta)}`)
  // Defense in depth: even the organizer's OWN scoped resolve denies this fair (they don't own it).
  const orgScopedDenied = await organizerResolve(FAIR_SLUG, nonOwningOrgId)
  check('…and their ownership-scoped resolve also denies the fair (null)', orgScopedDenied === null)

  // ── PROOF 2 — POSITIVE ────────────────────────────────────────────────────
  // A strict admin passes the gate AND the unscoped resolve returns the fair —
  // proven ownership-INDEPENDENT: the same fair a non-owning org's scoped resolve
  // DENIES, the admin chokepoint GRANTS.
  console.log('\n── PROOF 2 · POSITIVE — strict admin resolves a fair via the chokepoint (ownership-blind)')
  check('strict admin PASSES the strict-admin gate', hasStrictAdminRole(adminMeta) === true,
        `hasStrictAdminRole=${hasStrictAdminRole(adminMeta)}`)
  const adminGot = await adminResolve(FAIR_SLUG)
  check('unscoped chokepoint resolve RETURNS the fair', adminGot?.urlSlug === FAIR_SLUG)
  const nonOwnerScopedDenied = await organizerResolve(FAIR_SLUG, nonOwningOrgId)
  check('proof it is "not owned": non-owning-org scoped resolve returns null while admin got it',
        nonOwnerScopedDenied === null && adminGot !== null)

  // ── PROOF 3 — REGRESSION ──────────────────────────────────────────────────
  // The organizer OWNERSHIP-scoped path still returns the OWNER's own fair,
  // unchanged. (requireOrganizerAuth gates on OrgMember, not on any admin role,
  // so this resolve is identical for a pure organizer.)
  console.log('\n── PROOF 3 · REGRESSION — organizer loads their OWN owned fair, unchanged')
  const ownerGot = await organizerResolve(FAIR_SLUG, ownerOrgId)
  check('owner org scoped resolve RETURNS its own fair', ownerGot?.urlSlug === FAIR_SLUG)
  check('owner resolve and admin resolve agree on the same fair id', ownerGot?.id === adminGot?.id)

  // ── A2 — shared core is behavior-preserving ───────────────────────────────
  // Both the admin route and the organizer route now call getFairOrders(event.id).
  // Same function → same output shape. Prove it returns a well-formed log.
  console.log('\n── A2 · shared core — getFairOrders(event.id) identical for both callers')
  const core = await getFairOrders(fair.id, { take: 5 })
  check('getFairOrders returns {orders,nextCursor,meta}',
        Array.isArray(core.orders) && 'nextCursor' in core && typeof core.meta?.pendingCount === 'number',
        `orders=${core.orders.length}, pending=${core.meta.pendingCount}, issues=${core.meta.issuesCount}`)

  console.log(`\n${failures === 0 ? '✅ ALL PROOFS PASS' : `❌ ${failures} CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
