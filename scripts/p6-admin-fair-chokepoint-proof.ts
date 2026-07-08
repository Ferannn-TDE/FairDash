import { config } from 'dotenv'; config({ path: '.env.local' })
import { db } from '../lib/db'
import { hasStrictAdminRole } from '../lib/roles'
import { getFairOrders } from '../lib/fair-orders'

// ============================================================================
// SLICE 0 — admin cross-fair chokepoint: the three runtime proofs.
//
// SELF-SEEDING — depends on NO live account. Seeds a throwaway owner organizer +
// fair and a non-owning organizer, runs, then tears them down. The gate predicate
// is tested with the exact role shapes the chokepoint checks (constructed, not
// fetched from Clerk), so a deleted account can never break this proof again.
//
//   • gate predicate the chokepoint uses verbatim  → hasStrictAdminRole()
//   • unscoped Event resolve (admin)               → mirrors admin-fair-context.ts
//   • ownership-scoped Event resolve (organizer)   → mirrors requireOrganizerAuth
//   • shared order core                            → getFairOrders()
//
//   npx tsx scripts/p6-admin-fair-chokepoint-proof.ts
// ============================================================================

// The exact role sets the STRICT gate must accept/reject (no Clerk fetch needed).
const PURE_ORGANIZER_META = { roles: ['organizer'] }        // organizer, NO admin
const STRICT_ADMIN_META   = { roles: ['admin'] }            // strict platform admin

// Verbatim copies of the two resolves (admin unscoped / organizer scoped).
function adminResolve(idOrSlug: string) {
  return db.event.findFirst({ where: { OR: [{ id: idOrSlug }, { urlSlug: idOrSlug }] }, select: { id: true, urlSlug: true } })
}
function organizerResolve(fairSlug: string, organizerId: string) {
  return db.event.findFirst({ where: { urlSlug: fairSlug, organizerId }, select: { id: true, urlSlug: true } })
}

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`  ${cond ? '✅ PASS' : '❌ FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

async function main() {
  const ids: { ownerOrg?: string; otherOrg?: string; fair?: string } = {}
  try {
    // ── Seed a self-contained ownership graph ─────────────────────────────────
    const ownerOrg = await db.fairOrganizer.create({ data: { name: 'ZZ p6 Owner Org', contactEmail: 'zz-p6-owner@example.com' } })
    const otherOrg = await db.fairOrganizer.create({ data: { name: 'ZZ p6 Non-Owning Org', contactEmail: 'zz-p6-other@example.com' } })
    ids.ownerOrg = ownerOrg.id; ids.otherOrg = otherOrg.id
    const fair = await db.event.create({
      data: { name: 'ZZ p6 Fair', urlSlug: 'zz-p6-fair', startDate: new Date('2026-01-01'), endDate: new Date('2026-01-02'), organizerId: ownerOrg.id },
    })
    ids.fair = fair.id
    const FAIR_SLUG = fair.urlSlug
    console.log(`\nSeeded: fair "${FAIR_SLUG}" owned by ownerOrg=${ownerOrg.id}; non-owning org=${otherOrg.id}`)

    // ── PROOF 1 — NEGATIVE (the breach test) ────────────────────────────────────
    console.log('\n── PROOF 1 · NEGATIVE — organizer identity → 403 on admin cross-fair endpoint')
    check('pure organizer FAILS the strict-admin gate (→ 403)', hasStrictAdminRole(PURE_ORGANIZER_META) === false,
          `hasStrictAdminRole=${hasStrictAdminRole(PURE_ORGANIZER_META)}`)
    const orgScopedDenied = await organizerResolve(FAIR_SLUG, otherOrg.id)
    check('…and their ownership-scoped resolve also denies the fair (null)', orgScopedDenied === null)

    // ── PROOF 2 — POSITIVE ──────────────────────────────────────────────────────
    console.log('\n── PROOF 2 · POSITIVE — strict admin resolves a fair via the chokepoint (ownership-blind)')
    check('strict admin PASSES the strict-admin gate', hasStrictAdminRole(STRICT_ADMIN_META) === true,
          `hasStrictAdminRole=${hasStrictAdminRole(STRICT_ADMIN_META)}`)
    const adminGot = await adminResolve(FAIR_SLUG)
    check('unscoped chokepoint resolve RETURNS the fair', adminGot?.urlSlug === FAIR_SLUG)
    const nonOwnerScopedDenied = await organizerResolve(FAIR_SLUG, otherOrg.id)
    check('proof it is "not owned": non-owning-org scoped resolve returns null while admin got it',
          nonOwnerScopedDenied === null && adminGot !== null)

    // ── PROOF 3 — REGRESSION ────────────────────────────────────────────────────
    console.log('\n── PROOF 3 · REGRESSION — organizer loads their OWN owned fair, unchanged')
    const ownerGot = await organizerResolve(FAIR_SLUG, ownerOrg.id)
    check('owner org scoped resolve RETURNS its own fair', ownerGot?.urlSlug === FAIR_SLUG)
    check('owner resolve and admin resolve agree on the same fair id', ownerGot?.id === adminGot?.id)

    // ── A2 — shared core is behavior-preserving ─────────────────────────────────
    console.log('\n── A2 · shared core — getFairOrders(event.id) returns a well-formed log')
    const core = await getFairOrders(fair.id, { take: 5 })
    check('getFairOrders returns {orders,nextCursor,meta}',
          Array.isArray(core.orders) && 'nextCursor' in core && typeof core.meta?.pendingCount === 'number',
          `orders=${core.orders.length}, pending=${core.meta.pendingCount}, issues=${core.meta.issuesCount}`)
  } finally {
    // ── Teardown (self-cleaning) ────────────────────────────────────────────────
    if (ids.fair)     await db.event.delete({ where: { id: ids.fair } }).catch(() => {})
    if (ids.ownerOrg) await db.fairOrganizer.delete({ where: { id: ids.ownerOrg } }).catch(() => {})
    if (ids.otherOrg) await db.fairOrganizer.delete({ where: { id: ids.otherOrg } }).catch(() => {})
    const leftovers = await db.event.count({ where: { urlSlug: 'zz-p6-fair' } })
    console.log(`\n(cleanup) seed removed — leftovers: ${leftovers} (want 0)`)
  }

  console.log(`\n${failures === 0 ? '✅ ALL PROOFS PASS' : `❌ ${failures} CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
