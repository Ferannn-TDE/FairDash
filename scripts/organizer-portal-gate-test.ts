/**
 * Organizer approval — SLICE 4: the ORGANIZER-FACING side of the gate.
 *
 * Slices 1–3 gave the gate, the decisions, and the admin panel. This closes the loop: what the
 * organizer on the RECEIVING end of a decision sees. Until now a pending organizer passed the
 * portal's OrgMember-existence guard, landed on the dashboard, and every route 403'd underneath
 * them — a wall of failed queries. And the REJECTION REASON, required/audited/shown-to-admin,
 * was never shown to the rejected organizer: the exact silent wall the reason-requirement
 * existed to prevent.
 *
 * WHAT THIS PROVES, and how it avoids being vacuous:
 *
 *  • THE SCREEN IS TIED TO THE GATE THROUGH PRODUCT CODE. For each state we drive a REAL gated
 *    organizer route (GET /api/organizer/vendors, one of the 26) AS that organizer, and assert
 *    the screen state the layout would render (organizerPortalState) CORRESPONDS to the route's
 *    actual behaviour — same outcome, same code, same message text. The screen cannot claim
 *    something the 403 wouldn't, because it is derived from the same helpers AND checked against
 *    the real route.
 *
 *  • POSITIVE CONTROL + PROBE BASELINE (the slice-3 anti-vacuity lesson, kept). An APPROVED
 *    organizer gets 200 and NO screen — so "the gate screens them" is never just "screens
 *    everyone". Step [0] proves the probe route can return 200 at all before any 403 below is
 *    allowed to mean anything.
 *
 *  • PRECEDENCE, the non-obvious one. An organizer who is BOTH rejected AND has suspendedAt set
 *    shows DECLINED, not SUSPENDED — approval is checked before suspension, matching
 *    requireOrganizerAuth exactly ("never approved isn't 'suspended'"). Screen and gate agree on
 *    the order, not just the states.
 *
 * Run: npx tsx --import ./scripts/_clerk-loader.mjs scripts/organizer-portal-gate-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { register } from 'node:module'
register('./_clerk-loader.mjs', import.meta.url) // substitute Clerk BEFORE any handler import

import { PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'
import { organizerPortalState } from '../lib/organizer-portal-state'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const PFX = 'opgtest-'
const MAIL = '@opgtest.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
function login(clerkId: string | null, roles: string[] = []) {
  ;(globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata: { roles } } : undefined
}

let probeH: any, profileH: any

/** Drive a REAL gated organizer route AS this organizer — the true gate behaviour. */
async function hitGate(clerkId: string) {
  login(clerkId, ['organizer'])
  const res = await probeH(new NextRequest('http://local/api/organizer/vendors'))
  const json = await res.json().catch(() => ({}))
  return { status: res.status, code: json?.error?.code as string | undefined, message: json?.error?.message as string | undefined }
}
/** The UNGATED self-status route (plain requireAuth) — a pending org can still read it. */
async function profile(clerkId: string) {
  login(clerkId, ['organizer'])
  const res = await profileH(new NextRequest('http://local/api/organizer/profile'))
  const json = await res.json().catch(() => ({}))
  return { status: res.status, data: json?.data }
}

async function cleanup() {
  await prisma.event.deleteMany({ where: { organizer: { contactEmail: { endsWith: MAIL } } } })
  await prisma.orgMember.deleteMany({ where: { organizer: { contactEmail: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function seed(label: string, data: Record<string, unknown>) {
  const user = await prisma.user.create({
    data: { clerkId: `${PFX}u-${rand()}`, email: `${PFX}u-${rand()}${MAIL}`, name: `${label} owner`, role: 'organizer' },
  })
  const org = await prisma.fairOrganizer.create({
    data: { name: label, contactEmail: `${PFX}o-${rand()}${MAIL}`, ...data } as any,
  })
  await prisma.orgMember.create({ data: { userId: user.id, organizerId: org.id, role: 'owner' } })
  return { user, org }
}
/** Re-read the org's gate facts from the DB — what the layout feeds organizerPortalState. */
async function facts(orgId: string) {
  return prisma.fairOrganizer.findUnique({
    where: { id: orgId },
    select: { approvalStatus: true, rejectionReason: true, suspendedAt: true, suspendedReason: true },
  })
}

async function main() {
  ;({ GET: probeH } = await import('../app/api/organizer/vendors/route'))
  ;({ GET: profileH } = await import('../app/api/organizer/profile/route'))

  await cleanup()
  try {
    const approved  = await seed('Approved Org',  { approvalStatus: 'APPROVED', approvedAt: new Date(), approvedBy: 'seed' })
    const pending   = await seed('Pending Org',   { approvalStatus: 'PENDING' })
    const rejected  = await seed('Rejected Org',  { approvalStatus: 'REJECTED', rejectionReason: 'incomplete tax documentation' })
    const suspended = await seed('Suspended Org', { approvalStatus: 'APPROVED', approvedAt: new Date(), approvedBy: 'seed', suspendedAt: new Date(), suspendedReason: 'active fraud investigation' })
    // The non-obvious one: approved-then-rejected AND suspendedAt set. Precedence must resolve.
    const both      = await seed('Rejected+Suspended Org', { approvalStatus: 'REJECTED', rejectionReason: 'declined on appeal', suspendedAt: new Date(), suspendedReason: 'also suspended' })

    // ── [0] the probe can SUCCEED (approved org passes) — so a 403 below means something ──
    console.log('\n[0] the probe route can return 200 (an approved org passes) — the instrument works')
    const base = await hitGate(approved.user.clerkId)
    assert(base.status === 200, `an APPROVED organizer gets 200 from the real gated route (got ${base.status})`)

    // ── [1] ACTIVE: approved → no screen, portal renders ─────────────────────────────────
    console.log('\n[1] APPROVED → ACTIVE: no gate screen, the portal renders')
    const vApproved = organizerPortalState(await facts(approved.org.id))
    assert(vApproved.state === 'ACTIVE', 'organizerPortalState = ACTIVE (the layout renders the shell, not a gate screen)')

    // ── [2] AWAITING: pending → the real route 403s NOT_APPROVED, screen says AWAITING ───
    console.log('\n[2] PENDING → the route 403s, and the screen says AWAITING (matching, same message)')
    const gPending = await hitGate(pending.user.clerkId)
    const vPending = organizerPortalState(await facts(pending.org.id))
    assert(gPending.status === 403 && gPending.code === 'ORGANIZER_NOT_APPROVED', `real route → 403 ORGANIZER_NOT_APPROVED (got ${gPending.status}/${gPending.code})`)
    assert(vPending.state === 'AWAITING', 'screen state = AWAITING')
    assert(vPending.message === gPending.message, 'the screen shows the SAME text the 403 returns (derived from one source, cannot drift)')
    assert(vPending.reason === null, 'an awaiting org has no reason to show yet')

    // ── [3] DECLINED: rejected → 403 REJECTED, screen DECLINED, THE REASON IS SHOWN ──────
    console.log('\n[3] REJECTED → DECLINED, and the REASON is surfaced (the whole point of the reason-requirement)')
    const gRejected = await hitGate(rejected.user.clerkId)
    const vRejected = organizerPortalState(await facts(rejected.org.id))
    assert(gRejected.status === 403 && gRejected.code === 'ORGANIZER_REJECTED', `real route → 403 ORGANIZER_REJECTED (got ${gRejected.status}/${gRejected.code})`)
    assert(vRejected.state === 'DECLINED', 'screen state = DECLINED')
    assert(vRejected.reason === 'incomplete tax documentation', 'the rejection reason is on the screen — an explanation, NOT a silent wall (this is what was missing)')
    assert((gRejected.message ?? '').includes('incomplete tax documentation'), 'and the same reason rides the 403 the gate returns')
    assert(vRejected.message === gRejected.message, 'screen message === gate message')

    // ── [4] SUSPENDED: approved-then-stopped → 403 SUSPENDED, screen SUSPENDED, reason ───
    console.log('\n[4] SUSPENDED → the OTHER axis: approved, then stopped; reason surfaced')
    const gSusp = await hitGate(suspended.user.clerkId)
    const vSusp = organizerPortalState(await facts(suspended.org.id))
    assert(gSusp.status === 403 && gSusp.code === 'ORGANIZER_SUSPENDED', `real route → 403 ORGANIZER_SUSPENDED — DISTINCT code from NOT_APPROVED (got ${gSusp.status}/${gSusp.code})`)
    assert(vSusp.state === 'SUSPENDED', 'screen state = SUSPENDED (not AWAITING — a suspended org WAS admitted)')
    assert(vSusp.reason === 'active fraud investigation', 'the suspension reason is surfaced')
    assert(vSusp.message === gSusp.message, 'screen message === gate message')

    // ── [5] PRECEDENCE: rejected AND suspended → DECLINED wins, matching the gate ─────────
    console.log('\n[5] ⛔ PRECEDENCE: an org that is BOTH rejected AND has suspendedAt shows DECLINED, not SUSPENDED')
    const gBoth = await hitGate(both.user.clerkId)
    const vBoth = organizerPortalState(await facts(both.org.id))
    assert(gBoth.code === 'ORGANIZER_REJECTED', `the real gate resolves it as REJECTED, not SUSPENDED (got ${gBoth.code}) — approval is checked first`)
    assert(vBoth.state === 'DECLINED', 'the screen agrees: DECLINED, not SUSPENDED — "never approved isn’t suspended", same order as the gate')
    assert(vBoth.reason === 'declined on appeal', 'and shows the REJECTION reason, not the suspension one')

    // ── [6] the profile route (ungated) exposes the status — the enabling piece ──────────
    console.log('\n[6] /api/organizer/profile (ungated) surfaces the status — a pending org can read its own state')
    const pProf = await profile(pending.user.clerkId)
    assert(pProf.status === 200, `a PENDING org can still load /profile → 200 (got ${pProf.status}) — it is deliberately ungated`)
    assert(pProf.data?.approvalStatus === 'PENDING', 'profile returns approvalStatus = PENDING')
    const rProf = await profile(rejected.user.clerkId)
    assert(rProf.data?.approvalStatus === 'REJECTED' && rProf.data?.rejectionReason === 'incomplete tax documentation', 'profile returns REJECTED + the reason')
    const sProf = await profile(suspended.user.clerkId)
    assert(sProf.data?.suspended === true && sProf.data?.suspendedReason === 'active fraud investigation', 'profile returns suspended + reason')
    const aProf = await profile(approved.user.clerkId)
    assert(aProf.data?.approvalStatus === 'APPROVED' && aProf.data?.suspended === false, 'an approved org reads APPROVED + not suspended')

    console.log(`\n${'─'.repeat(66)}`)
    if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
    else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(66)}\n`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('\n💥', e); await cleanup().catch(() => {}); await prisma.$disconnect(); process.exit(1) })
