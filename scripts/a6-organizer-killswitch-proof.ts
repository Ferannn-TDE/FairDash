import { config } from 'dotenv'; config({ path: '.env.local' })
import { createClerkClient } from '@clerk/backend'
import { db } from '../lib/db'
import { hasStrictAdminRole } from '../lib/roles'
import { organizerSuspensionError } from '../lib/organizer-suspension'

// ============================================================================
// A6 — disable-organizer kill-switch: the five runtime proofs.
//
// Exercises the REAL decision surface against the REAL DB + REAL Clerk metadata:
//   • the WRITE core (set/clear suspendedAt)         → mirrors the admin endpoint
//   • the READ boundary (fresh per-request org read) → mirrors requireOrganizerAuth
//   • the suspension guard                           → organizerSuspensionError()
//   • the write GATE                                 → hasStrictAdminRole()
//
// The only glue NOT executed is the ~4 lines calling Clerk auth()/currentUser()
// (no request scope in a script) — typechecked, and it forwards the exact
// metadata / query proven below.
//
//   npx tsx scripts/a6-organizer-killswitch-proof.ts
// ============================================================================

const ADMIN_EMAIL     = 'feranmidyro@gmail.com'        // ["admin","organizer"] — strict admin, member of Feran Events (org B)
const ORGANIZER_EMAIL = 'feranmi+clerk_test@gmail.com' // ["organizer"]         — pure organizer, member of org A
const ORG_A = 'org_cmr0557cv0000ty0pddvq2oi4'          // clerk_test org — the one we suspend (owns no fairs; safe)
const ORG_B = 'cmpe8hz620000axso03by30vn'              // Feran Events — must stay unaffected

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`  ${cond ? '✅ PASS' : '❌ FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

// The admin write core — verbatim shape of what the admin endpoint mutates.
function adminSetSuspension(orgId: string, suspend: boolean, reason: string | null = null) {
  return db.fairOrganizer.update({
    where: { id: orgId },
    data: { suspendedAt: suspend ? new Date() : null, suspendedReason: suspend ? reason : null },
    select: { id: true, suspendedAt: true },
  })
}

// The organizer READ boundary — verbatim query from requireOrganizerAuth: resolve
// membership + org suspension FRESH, then run it through the REAL guard. Returns
// the ApiError the boundary would throw (or null = allowed through).
async function organizerBoundaryVerdict(userId: string) {
  const orgMember = await db.orgMember.findFirst({
    where: { userId },
    select: { organizerId: true, organizer: { select: { suspendedAt: true, suspendedReason: true } } },
  })
  if (!orgMember) return { code: 'FORBIDDEN', status: 403 }
  const err = organizerSuspensionError(orgMember.organizer)
  return err ? { code: err.code, status: err.statusCode } : null
}

async function metaFor(clerk: ReturnType<typeof createClerkClient>, email: string) {
  const list = await clerk.users.getUserList({ emailAddress: [email] })
  if (!list.data[0]) throw new Error(`No Clerk user for ${email}`)
  return list.data[0].publicMetadata
}

async function main() {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  const adminMeta = await metaFor(clerk, ADMIN_EMAIL)
  const orgMeta   = await metaFor(clerk, ORGANIZER_EMAIL)

  const orgUserA = await db.user.findFirst({ where: { email: ORGANIZER_EMAIL }, select: { id: true } })
  const orgUserB = await db.user.findFirst({ where: { email: ADMIN_EMAIL }, select: { id: true } })
  if (!orgUserA || !orgUserB) throw new Error('missing DB users')

  // Clean slate — ensure org A starts UNSUSPENDED.
  await adminSetSuspension(ORG_A, false)

  try {
    // ── PROOF 5 (happy path first, establishes the baseline) ─────────────────
    console.log('\n── PROOF 5 · REGRESSION — non-suspended organizer enters normally')
    const baseline = await organizerBoundaryVerdict(orgUserA.id)
    check('unsuspended organizer is ALLOWED through (no verdict)', baseline === null,
          baseline ? `got ${baseline.code}` : 'allowed')

    // ── PROOF 1 · IMMEDIACY (the one that matters) ───────────────────────────
    // Admin suspends → the very NEXT request (a fresh DB read, no token refresh)
    // is denied. Same identity, no re-auth between the write and the read.
    console.log('\n── PROOF 1 · IMMEDIACY — suspend, then the NEXT request is denied (no token lag)')
    await adminSetSuspension(ORG_A, true, 'A6 proof — misbehaving organizer')
    const afterSuspend = await organizerBoundaryVerdict(orgUserA.id)   // fresh per-request read
    check('next request → 403 ORGANIZER_SUSPENDED (distinct from FORBIDDEN)',
          afterSuspend?.status === 403 && afterSuspend?.code === 'ORGANIZER_SUSPENDED',
          afterSuspend ? `${afterSuspend.status} ${afterSuspend.code}` : 'allowed(!)')

    // ── PROOF 3 · ISOLATION (while A is suspended) ───────────────────────────
    console.log('\n── PROOF 3 · ISOLATION — a different organizer is unaffected by A’s suspension')
    const orgBVerdict = await organizerBoundaryVerdict(orgUserB.id)
    check('org B organizer still allowed through while org A is suspended', orgBVerdict === null,
          orgBVerdict ? `got ${orgBVerdict.code}` : 'allowed')

    // ── PROOF 2 · RE-ENABLE ──────────────────────────────────────────────────
    console.log('\n── PROOF 2 · RE-ENABLE — clear suspension → access restored on next request')
    await adminSetSuspension(ORG_A, false)
    const afterClear = await organizerBoundaryVerdict(orgUserA.id)
    check('next request → allowed again (verdict cleared)', afterClear === null,
          afterClear ? `got ${afterClear.code}` : 'allowed')

    // ── PROOF 4 · ADMIN-ONLY WRITE (organizer can’t un-suspend themselves) ────
    // The write endpoint gates on requireStrictAdminAuth → hasStrictAdminRole.
    console.log('\n── PROOF 4 · ADMIN-ONLY WRITE — organizer rejected, cannot touch suspension state')
    check('organizer identity FAILS the write gate (can’t suspend/un-suspend anyone)',
          hasStrictAdminRole(orgMeta) === false, `hasStrictAdminRole=${hasStrictAdminRole(orgMeta)}`)
    check('strict admin PASSES the write gate', hasStrictAdminRole(adminMeta) === true,
          `hasStrictAdminRole=${hasStrictAdminRole(adminMeta)}`)
    // The dangerous case, stated explicitly: the suspended org’s own member is a
    // pure organizer → the same gate that denies the write denies self-rescue.
    check('⇒ a suspended organizer CANNOT un-suspend themselves (same gate rejects them)',
          hasStrictAdminRole(orgMeta) === false)
  } finally {
    // Teardown — never leave a test org suspended.
    await adminSetSuspension(ORG_A, false)
    console.log('\n(teardown) org A restored to unsuspended')
  }

  console.log(`\n${failures === 0 ? '✅ ALL PROOFS PASS' : `❌ ${failures} CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
