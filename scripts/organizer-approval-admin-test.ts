/**
 * Organizer approval — SLICE 2: the admin approve/reject routes.
 *
 * Drives the REAL route handlers with Clerk auth() / currentUser() substituted per-identity
 * (scripts/_clerk-loader.mjs), so every authorization decision under test is the real route
 * code, unmocked — the same harness the runner-boundary and A6 proofs use.
 *
 * THE LOAD-BEARING NEGATIVE: ⛔ NO SELF-APPROVAL. An organizer must not be able to flip their
 * own approvalStatus to APPROVED — that would make the entire gate decorative. Same
 * no-self-rescue standard as the A6 kill-switch.
 *
 * AND IT IS NOT VACUOUS: a POSITIVE CONTROL (a real admin succeeds on the same route, same
 * organizer) runs alongside, so a "rejected the organizer" pass cannot be a gate that simply
 * rejects everyone. (The {role:} vs {roles:[]} catch earlier this session was exactly that
 * failure — a helper returning false for every input made the negatives pass vacuously.)
 *
 * Run: npx tsx --import ./scripts/_clerk-loader.mjs scripts/organizer-approval-admin-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { register } from 'node:module'
register('./_clerk-loader.mjs', import.meta.url) // substitute Clerk BEFORE any handler import

import { PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const PFX = 'oatest-'
const MAIL = '@oatest.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
/** Identity for the next request. publicMetadata.roles[] is the REAL shape (plural array). */
function login(clerkId: string | null, roles: string[] = []) {
  ;(globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata: { roles } } : undefined
}

let approveH: any, rejectH: any, organizerApprovalError: any

async function callApprove(orgId: string) {
  const res = await approveH(new NextRequest(`http://local/api/admin/organizers/${orgId}/approve`, { method: 'POST' }),
    { params: Promise.resolve({ id: orgId }) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function callReject(orgId: string, reason: string) {
  const res = await rejectH(new NextRequest(`http://local/api/admin/organizers/${orgId}/reject`, {
    method: 'POST', body: JSON.stringify({ reason }), headers: { 'Content-Type': 'application/json' },
  }), { params: Promise.resolve({ id: orgId }) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

/** Does the GATE let this organizer operate? (the real decision the 26 routes make) */
async function canOperate(orgId: string): Promise<boolean> {
  const o = await prisma.fairOrganizer.findUnique({
    where: { id: orgId }, select: { approvalStatus: true, rejectionReason: true },
  })
  return organizerApprovalError(o) === null
}

async function cleanup() {
  await prisma.orgMember.deleteMany({ where: { organizer: { contactEmail: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  ;({ POST: approveH } = await import('../app/api/admin/organizers/[id]/approve/route'))
  ;({ POST: rejectH } = await import('../app/api/admin/organizers/[id]/reject/route'))
  ;({ organizerApprovalError } = await import('../lib/organizer-approval'))

  await cleanup()
  try {
    // A PENDING organizer + the user who owns it (the would-be self-approver).
    const owner = await prisma.user.create({
      data: { clerkId: `${PFX}owner-${rand()}`, email: `${PFX}o-${rand()}${MAIL}`, name: 'Org Owner', role: 'organizer' },
    })
    const org = await prisma.fairOrganizer.create({
      data: { name: 'Pending Org', contactEmail: `${PFX}org-${rand()}${MAIL}`, approvalStatus: 'PENDING' },
    })
    await prisma.orgMember.create({ data: { userId: owner.id, organizerId: org.id, role: 'owner' } })

    const admin = await prisma.user.create({
      data: { clerkId: `${PFX}admin-${rand()}`, email: `${PFX}a-${rand()}${MAIL}`, name: 'Admin', role: 'admin' },
    })

    console.log('\n[0] baseline: the seeded organizer is PENDING and CANNOT operate')
    assert((await canOperate(org.id)) === false, 'the gate refuses them (pending)')

    // ── [1] ⛔ NO SELF-APPROVAL — the organizer tries to approve THEMSELVES ────
    console.log('\n[1] ⛔ NO SELF-APPROVAL: the organizer cannot approve their own account')
    login(owner.clerkId, ['organizer'])
    const self = await callApprove(org.id)
    assert(self.status === 403, `organizer self-approve → 403 (got ${self.status})`)
    assert((await canOperate(org.id)) === false, '⛔ still PENDING — they did NOT let themselves in')

    console.log('\n[1b] …nor reject (the same gate guards both)')
    login(owner.clerkId, ['organizer'])
    const selfRej = await callReject(org.id, 'sneaky')
    assert(selfRej.status === 403, `organizer self-reject → 403 (got ${selfRej.status})`)

    console.log('\n[2] other non-admins are refused too (vendor / runner / event_operator)')
    for (const role of ['vendor', 'runner', 'event_operator']) {
      login(`${PFX}x-${rand()}`, [role])
      const r = await callApprove(org.id)
      assert(r.status === 403, `${role} → 403 (got ${r.status})`)
    }
    login(null)
    const anon = await callApprove(org.id)
    assert(anon.status === 401 || anon.status === 403, `anonymous → ${anon.status} (refused)`)
    assert((await canOperate(org.id)) === false, 'after ALL those attempts the org is STILL pending')

    // ── [3] ✅ POSITIVE CONTROL — a real admin SUCCEEDS on the same route ──────
    // This is what makes [1]/[2] meaningful: the gate is not simply rejecting everyone.
    console.log('\n[3] ✅ POSITIVE CONTROL: a STRICT ADMIN approves the same organizer on the same route')
    login(admin.clerkId, ['admin'])
    const ok = await callApprove(org.id)
    assert(ok.status === 200, `admin approve → 200 (got ${ok.status}) — so the 403s above were REAL rejections, not a gate that refuses everyone`)
    assert(ok.json?.data?.organizer?.approvalStatus === 'APPROVED', 'response says APPROVED')

    console.log('\n[4] approval UNLOCKS the organizer — the gate now lets them operate')
    assert((await canOperate(org.id)) === true, 'the gate (the same one guarding all 26 routes) now passes them')

    console.log('\n[5] AUDIT: the decision is recorded durably on the row (who / when)')
    const afterApprove = await prisma.fairOrganizer.findUnique({
      where: { id: org.id }, select: { approvedBy: true, approvedAt: true, rejectionReason: true },
    })
    assert(afterApprove?.approvedBy === admin.clerkId, `approvedBy = the acting admin (${afterApprove?.approvedBy})`)
    assert(!!afterApprove?.approvedAt, 'approvedAt timestamped')
    assert(afterApprove?.rejectionReason === null, 'any prior rejection reason is cleared')

    // ── [6] REJECT — terminal, still blocked, reason recorded + surfaced ───────
    console.log('\n[6] REJECT: terminal — the organizer stays blocked, with the reason surfaced')
    login(admin.clerkId, ['admin'])
    const rej = await callReject(org.id, 'failed vetting')
    assert(rej.status === 200, `admin reject → 200 (got ${rej.status})`)
    assert((await canOperate(org.id)) === false, '⛔ a REJECTED organizer is refused by the gate')
    const afterReject = await prisma.fairOrganizer.findUnique({
      where: { id: org.id }, select: { approvalStatus: true, rejectionReason: true, approvedBy: true },
    })
    assert(afterReject?.approvalStatus === 'REJECTED', 'status = REJECTED')
    assert(afterReject?.rejectionReason === 'failed vetting', 'the reason is recorded (durably, on the row)')
    assert(afterReject?.approvedBy === admin.clerkId, 'the deciding admin is recorded on a rejection too')
    const gateErr = organizerApprovalError(afterReject)
    assert(gateErr?.code === 'ORGANIZER_REJECTED', `the gate returns ORGANIZER_REJECTED (got ${gateErr?.code})`)
    assert(/failed vetting/.test(gateErr?.message ?? ''), 'and surfaces the reason to the organizer')

    console.log('\n[7] a rejection REQUIRES a reason (an unauditable decision is refused)')
    login(admin.clerkId, ['admin'])
    const noReason = await callReject(org.id, '   ')
    assert(noReason.status === 400, `blank reason → 400 (got ${noReason.status})`)

    console.log('\n[8] Option A payoff: a rejected organizer has NO fairs to orphan')
    const fairs = await prisma.event.count({ where: { organizerId: org.id } })
    assert(fairs === 0, 'the (never-approved) organizer owns 0 fairs — fair creation was gated, so rejection is clean')

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
