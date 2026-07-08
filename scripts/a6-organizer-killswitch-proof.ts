import { config } from 'dotenv'; config({ path: '.env.local' })
import { db } from '../lib/db'
import { hasStrictAdminRole } from '../lib/roles'
import { organizerSuspensionError } from '../lib/organizer-suspension'

// ============================================================================
// A6 — disable-organizer kill-switch: the five runtime proofs.
//
// SELF-SEEDING — depends on NO live account. Seeds two throwaway organizers (A to
// suspend, B unaffected) each with a member user, runs, tears down. The write-gate
// predicate is tested with the exact role shapes (constructed, not fetched from
// Clerk), so a deleted account can never break this proof again.
//
//   • WRITE core (set/clear suspendedAt)         → mirrors the admin endpoint
//   • READ boundary (fresh per-request org read) → mirrors requireOrganizerAuth
//   • suspension guard                           → organizerSuspensionError()
//   • write GATE                                 → hasStrictAdminRole()
//
//   npx tsx scripts/a6-organizer-killswitch-proof.ts
// ============================================================================

const PURE_ORGANIZER_META = { roles: ['organizer'] }   // organizer, NO admin
const STRICT_ADMIN_META   = { roles: ['admin'] }       // strict platform admin

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`  ${cond ? '✅ PASS' : '❌ FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

// Admin write core — verbatim shape of what the admin endpoint mutates.
function adminSetSuspension(orgId: string, suspend: boolean, reason: string | null = null) {
  return db.fairOrganizer.update({
    where: { id: orgId },
    data: { suspendedAt: suspend ? new Date() : null, suspendedReason: suspend ? reason : null },
    select: { id: true, suspendedAt: true },
  })
}

// Organizer READ boundary — verbatim query from requireOrganizerAuth + the REAL guard.
async function organizerBoundaryVerdict(userId: string) {
  const orgMember = await db.orgMember.findFirst({
    where: { userId },
    select: { organizerId: true, organizer: { select: { suspendedAt: true, suspendedReason: true } } },
  })
  if (!orgMember) return { code: 'FORBIDDEN', status: 403 }
  const err = organizerSuspensionError(orgMember.organizer)
  return err ? { code: err.code, status: err.statusCode } : null
}

async function main() {
  const ids: { orgA?: string; orgB?: string; userA?: string; userB?: string } = {}
  try {
    // ── Seed two organizers + a member user each ──────────────────────────────
    const orgA = await db.fairOrganizer.create({ data: { name: 'ZZ a6 Org A', contactEmail: 'zz-a6-a@example.com' } })
    const orgB = await db.fairOrganizer.create({ data: { name: 'ZZ a6 Org B', contactEmail: 'zz-a6-b@example.com' } })
    ids.orgA = orgA.id; ids.orgB = orgB.id
    const userA = await db.user.create({ data: { email: 'zz-a6-usera@example.com', clerkId: 'zz_a6_usera_clerk' } })
    const userB = await db.user.create({ data: { email: 'zz-a6-userb@example.com', clerkId: 'zz_a6_userb_clerk' } })
    ids.userA = userA.id; ids.userB = userB.id
    await db.orgMember.create({ data: { organizerId: orgA.id, userId: userA.id, role: 'owner' } })
    await db.orgMember.create({ data: { organizerId: orgB.id, userId: userB.id, role: 'owner' } })
    await adminSetSuspension(orgA.id, false)   // start clean

    // ── PROOF 5 — REGRESSION (baseline) ─────────────────────────────────────────
    console.log('\n── PROOF 5 · REGRESSION — non-suspended organizer enters normally')
    check('unsuspended organizer is ALLOWED through (no verdict)', (await organizerBoundaryVerdict(userA.id)) === null)

    // ── PROOF 1 — IMMEDIACY (the one that matters) ──────────────────────────────
    console.log('\n── PROOF 1 · IMMEDIACY — suspend, then the NEXT request is denied (no token lag)')
    await adminSetSuspension(orgA.id, true, 'A6 proof — misbehaving organizer')
    const afterSuspend = await organizerBoundaryVerdict(userA.id)   // fresh per-request read
    check('next request → 403 ORGANIZER_SUSPENDED (distinct from FORBIDDEN)',
          afterSuspend?.status === 403 && afterSuspend?.code === 'ORGANIZER_SUSPENDED',
          afterSuspend ? `${afterSuspend.status} ${afterSuspend.code}` : 'allowed(!)')

    // ── PROOF 3 — ISOLATION ─────────────────────────────────────────────────────
    console.log('\n── PROOF 3 · ISOLATION — a different organizer is unaffected by A’s suspension')
    check('org B organizer still allowed through while org A is suspended', (await organizerBoundaryVerdict(userB.id)) === null)

    // ── PROOF 2 — RE-ENABLE ─────────────────────────────────────────────────────
    console.log('\n── PROOF 2 · RE-ENABLE — clear suspension → access restored on next request')
    await adminSetSuspension(orgA.id, false)
    check('next request → allowed again (verdict cleared)', (await organizerBoundaryVerdict(userA.id)) === null)

    // ── PROOF 4 — ADMIN-ONLY WRITE (organizer can’t un-suspend themselves) ──────
    console.log('\n── PROOF 4 · ADMIN-ONLY WRITE — organizer rejected, cannot touch suspension state')
    check('organizer identity FAILS the write gate', hasStrictAdminRole(PURE_ORGANIZER_META) === false,
          `hasStrictAdminRole=${hasStrictAdminRole(PURE_ORGANIZER_META)}`)
    check('strict admin PASSES the write gate', hasStrictAdminRole(STRICT_ADMIN_META) === true,
          `hasStrictAdminRole=${hasStrictAdminRole(STRICT_ADMIN_META)}`)
    check('⇒ a suspended organizer CANNOT un-suspend themselves (same gate rejects them)',
          hasStrictAdminRole(PURE_ORGANIZER_META) === false)
  } finally {
    // ── Teardown (self-cleaning) — orgs cascade their members ───────────────────
    if (ids.orgA)  await db.fairOrganizer.delete({ where: { id: ids.orgA } }).catch(() => {})
    if (ids.orgB)  await db.fairOrganizer.delete({ where: { id: ids.orgB } }).catch(() => {})
    if (ids.userA) await db.user.delete({ where: { id: ids.userA } }).catch(() => {})
    if (ids.userB) await db.user.delete({ where: { id: ids.userB } }).catch(() => {})
    const leftovers = await db.fairOrganizer.count({ where: { contactEmail: { startsWith: 'zz-a6-' } } })
    console.log(`\n(teardown) seed removed — leftovers: ${leftovers} (want 0)`)
  }

  console.log(`\n${failures === 0 ? '✅ ALL PROOFS PASS' : `❌ ${failures} CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
