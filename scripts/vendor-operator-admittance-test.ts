/**
 * VENDOR OPERATOR ADMITTANCE — STEP 2: the admin approve/reject routes.
 *
 * Drives the REAL route handlers with Clerk auth() / currentUser() substituted per-identity
 * (scripts/_clerk-loader.mjs), so every authorization decision under test is the real route code,
 * unmocked — the same harness the runner-boundary, A6 and organizer-approval proofs use.
 *
 * WHAT MATTERS HERE, in order:
 *
 *   ⛔ NO SELF-ADMITTANCE. The operator being judged must not be able to approve themselves. This
 *      is the property that decides whether the axis means anything at all, and it comes from
 *      requireStrictAdminAuth structurally (a vendor identity carries no admin role) rather than
 *      from a check someone remembered to write. Also proven for event_operator, who is admin
 *      FAMILY but not strict admin — the exact boundary this route chose over the runner routes'.
 *
 *   ✅ THE REASON IS PERSISTED. The sibling BOOTH reject route validates a reason then discards
 *      it. That bug is the reason VendorMember.rejectionReason exists, so the test reads the
 *      reason back off the row rather than trusting a 200.
 *
 *   ✅ REJECTION IS REVERSIBLE. REJECTED → approve → APPROVED with the reason cleared. The runner
 *      routes 409 here; this one must not.
 *
 *   ✅ THE CACHE IS INVALIDATED. getVendorAuth caches a membership for 600s at role 'owner', so a
 *      reject that does not invalidate would leave a refused operator working for ~10 minutes
 *      once the gate reads through it. Nothing reads it yet — which is exactly why this is
 *      asserted NOW, by injecting a fake Redis and watching the real DEL key, rather than being
 *      "added later" in the commit that would depend on it.
 *
 *   ⚡ NO LONGER INERT. Step 2 shipped changing no vendor-facing behaviour; step 3 gave these
 *      routes teeth, so a reject here now WALLS the operator out of the portal. [7] tracks that
 *      reach: the door reads approvalStatus, the accept path still does not (step 4).
 *
 * NOT VACUOUS: every negative has a positive control on the SAME route and SAME subject — a real
 * strict admin succeeds where the others are refused, and step [0] proves the route can return
 * 200 at all before any 403 below is allowed to mean anything.
 *
 * Run: npx tsx --import ./scripts/_clerk-loader.mjs scripts/vendor-operator-admittance-test.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
import { register } from 'node:module'
register('./_clerk-loader.mjs', import.meta.url) // substitute Clerk BEFORE any handler import

import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'

const prisma = testPrisma()
const PFX = 'voatest-'
const MAIL = '@voatest.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/** Identity for the next request. publicMetadata.roles[] is the REAL shape (plural array). */
function login(clerkId: string | null, roles: string[] = []) {
  ;(globalThis as never as { __MOCK_CLERK?: unknown }).__MOCK_CLERK =
    clerkId ? { userId: clerkId, publicMetadata: { roles } } : undefined
}

let approveH: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
let rejectH:  (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
// Hold the module namespace rather than hand-typing the setter: its parameter is the real
// Redis client type, and a hand-written `(c: unknown) => void` is not assignable to it under
// strictFunctionTypes (the typecheck gate caught exactly that).
let cacheMod: typeof import('../lib/vendor-auth-cache')

/** Records every Redis DEL the routes perform — the real invalidation, not a source-code scan. */
const delKeys: string[] = []
const fakeRedis = {
  del: async (k: string) => { delKeys.push(k); return 1 },
  get: async () => null,
  set: async () => 'OK',
}

async function callApprove(id: string) {
  const res = await approveH(
    new NextRequest(`http://local/api/admin/vendor-members/${id}/approve`, { method: 'PATCH' }),
    { params: Promise.resolve({ id }) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function callReject(id: string, body?: unknown) {
  const res = await rejectH(
    new NextRequest(`http://local/api/admin/vendor-members/${id}/reject`, {
      method: 'PATCH',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: Promise.resolve({ id }) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

const rowOf = (id: string) => prisma.vendorMember.findUnique({
  where: { id },
  select: { approvalStatus: true, approvedAt: true, approvedBy: true, rejectionReason: true },
})

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vs.map(v => v.id) } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  ;({ PATCH: approveH } = await import('../app/api/admin/vendor-members/[id]/approve/route'))
  ;({ PATCH: rejectH }  = await import('../app/api/admin/vendor-members/[id]/reject/route'))
  cacheMod = await import('../lib/vendor-auth-cache')

  await cleanup()
  // The fake only needs del/get/set — the routes call del. Cast at the boundary, once.
  cacheMod.__setRedisOverrideForTest(fakeRedis as never)
  try {
    // ── Fixtures: one booth, its operator (the would-be self-approver), one strict admin ──
    const ev = await prisma.event.create({
      data: { name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE',
              startDate: new Date(), endDate: new Date(Date.now() + 86_400_000) },
    })
    const vendor = await prisma.vendor.create({
      data: { eventId: ev.id, name: `${PFX}booth`, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' },
    })
    const operator = await prisma.user.create({
      data: { clerkId: `${PFX}op-${rand()}`, email: `${PFX}op-${rand()}${MAIL}`, name: 'Booth Operator', role: 'vendor' },
    })
    const admin = await prisma.user.create({
      data: { clerkId: `${PFX}admin-${rand()}`, email: `${PFX}a-${rand()}${MAIL}`, name: 'Platform Admin', role: 'admin' },
    })
    const member = await prisma.vendorMember.create({
      data: { vendorId: vendor.id, userId: operator.id, role: 'owner', approvalStatus: 'PENDING' },
    })
    const EXPECTED_KEY = `v1:vendor-auth:${operator.id}:${vendor.id}`

    // ── [0] BASELINE / PROBE FLOOR ────────────────────────────────────────────────
    // Before any 403 below is allowed to mean anything, prove this route can succeed at all.
    console.log('\n[0] baseline: the operator is PENDING, and a real strict admin CAN drive this route')
    assert((await rowOf(member.id))?.approvalStatus === 'PENDING', 'seeded operator starts PENDING')
    login(admin.clerkId, ['admin'])
    const baseline = await callApprove(member.id)
    assert(baseline.status === 200, `strict admin approve → 200 (got ${baseline.status}) — the probe is not refuse-everything`)

    // ── [1] APPROVE writes the full audit shape ───────────────────────────────────
    console.log('\n[1] approve: APPROVED + audit fields, approvedBy is a DB User.id (not a Clerk id)')
    const afterApprove = await rowOf(member.id)
    assert(afterApprove?.approvalStatus === 'APPROVED', 'approvalStatus is APPROVED')
    assert(afterApprove?.approvedAt instanceof Date, 'approvedAt stamped')
    assert(afterApprove?.approvedBy === admin.id, `approvedBy is the admin's User.id (${admin.id}), joinable in SQL`)
    assert(afterApprove?.approvedBy !== admin.clerkId, 'approvedBy is NOT the Clerk id — the resolved inconsistency')
    assert(afterApprove?.rejectionReason === null, 'rejectionReason cleared')

    // ── [2] REJECT REQUIRES A REASON ──────────────────────────────────────────────
    console.log('\n[2] reject without a reason is refused, and the row is untouched')
    for (const [label, body] of [
      ['no body at all', undefined],
      ['empty object', {}],
      ['empty string', { reason: '' }],
      ['whitespace only', { reason: '   ' }],
      ['wrong type', { reason: 42 }],
    ] as const) {
      login(admin.clerkId, ['admin'])
      const r = await callReject(member.id, body)
      assert(r.status === 400, `${label} → 400 (got ${r.status})`)
      assert(r.json?.error?.code === 'VALIDATION_ERROR', `${label} → NAMED code VALIDATION_ERROR (got ${r.json?.error?.code})`)
    }
    assert((await rowOf(member.id))?.approvalStatus === 'APPROVED',
      'after every reasonless reject the row is STILL APPROVED — a refused write changed nothing')

    // ── [3] REJECT PERSISTS THE REASON ────────────────────────────────────────────
    console.log('\n[3] reject with a reason: REJECTED, and the reason is READ BACK OFF THE ROW')
    const REASON = 'Food handler permit expired — resubmit to be re-admitted'
    login(admin.clerkId, ['admin'])
    const rej = await callReject(member.id, { reason: REASON })
    assert(rej.status === 200, `reject → 200 (got ${rej.status})`)
    const afterReject = await rowOf(member.id)
    assert(afterReject?.approvalStatus === 'REJECTED', 'approvalStatus is REJECTED')
    assert(afterReject?.rejectionReason === REASON,
      '⛔ the reason is PERSISTED (the booth reject route validates then discards — not reproduced here)')
    assert(afterReject?.approvedAt === null, 'approvedAt nulled — no stale admission timestamp on a refused operator')
    assert(afterReject?.approvedBy === admin.id, 'approvedBy records WHO decided, on a rejection too')

    // ── [4] REVERSIBLE ────────────────────────────────────────────────────────────
    console.log('\n[4] rejection is REVERSIBLE: REJECTED → approve → APPROVED, reason cleared')
    login(admin.clerkId, ['admin'])
    const readmit = await callApprove(member.id)
    assert(readmit.status === 200, `approve on a REJECTED row → 200 (got ${readmit.status}) — NOT the runner routes' 409`)
    const afterReadmit = await rowOf(member.id)
    assert(afterReadmit?.approvalStatus === 'APPROVED', 're-admitted to APPROVED')
    assert(afterReadmit?.rejectionReason === null, 'the old reason is cleared — a fresh decision, not an amendment')

    // ── [5] ⛔ AUTHZ: who may NOT decide ──────────────────────────────────────────
    console.log('\n[5] ⛔ NO SELF-ADMITTANCE, and event_operator is not strict admin')
    login(operator.clerkId, ['vendor'])
    const selfApprove = await callApprove(member.id)
    assert(selfApprove.status === 403, `the operator approving THEMSELVES → 403 (got ${selfApprove.status})`)
    const selfReject = await callReject(member.id, { reason: 'x' })
    assert(selfReject.status === 403, `…and rejecting → 403 (got ${selfReject.status})`)

    for (const role of ['event_operator', 'organizer', 'runner', 'vendor']) {
      login(`${PFX}x-${rand()}`, [role])
      const r = await callApprove(member.id)
      assert(r.status === 403, `${role} → 403 (got ${r.status})`)
    }
    login(null)
    const anon = await callApprove(member.id)
    assert(anon.status === 401, `unauthenticated → 401 (got ${anon.status})`)

    assert((await rowOf(member.id))?.approvalStatus === 'APPROVED',
      '⛔ after every refused attempt the row is UNCHANGED — nobody let themselves in')

    // ── [6] THE CACHE IS INVALIDATED, on both routes ──────────────────────────────
    console.log('\n[6] both routes invalidate the membership cache (wired before anything reads it)')
    delKeys.length = 0
    login(admin.clerkId, ['admin'])
    await callReject(member.id, { reason: 'cache check' })
    assert(delKeys.includes(EXPECTED_KEY), `reject DELETED the membership key ${EXPECTED_KEY} (saw: ${delKeys.join(', ') || 'none'})`)
    delKeys.length = 0
    await callApprove(member.id)
    assert(delKeys.includes(EXPECTED_KEY), `approve DELETED the membership key (saw: ${delKeys.join(', ') || 'none'})`)

    // ── [7] 🔌 NO LONGER INERT AT THE DOOR — step 3 shipped ───────────────────────
    // Converted rather than deleted (this block's note said to delete it): the step-4 sites it
    // also pins are still inert, and dropping that pin would let the accept-verb gate land
    // unnoticed. What step 2 called "inert" is now true of everything EXCEPT the portal door.
    console.log('\n[7] the portal door reads approvalStatus (step 3); the accept path does not (step 4)')
    assert(/approvalStatus/.test(readFileSync('app/vendor/layout.tsx', 'utf8')),
      'app/vendor/layout.tsx reads approvalStatus — these routes now change what an operator can reach')
    for (const f of ['lib/vendor-auth-cache.ts', 'app/api/orders/[id]/vendor-status/route.ts']) {
      assert(!/approvalStatus/.test(readFileSync(f, 'utf8')), `${f} still does not read approvalStatus (step 4)`)
    }
    const authSrc = readFileSync('lib/auth.ts', 'utf8')
    const vendorAuthFn = authSrc.slice(
      authSrc.indexOf('export async function requireVendorAuth'),
      authSrc.indexOf('export async function requireOrganizerAuth'))
    assert(vendorAuthFn.length > 0 && !/approvalStatus/.test(vendorAuthFn),
      'requireVendorAuth still does not read approvalStatus (the gate is a later commit)')

    // ── [8] roles[] IS NOT TOUCHED ────────────────────────────────────────────────
    console.log('\n[8] admittance never writes roles[] — it is a separate axis from membership')
    for (const f of ['app/api/admin/vendor-members/[id]/approve/route.ts',
                     'app/api/admin/vendor-members/[id]/reject/route.ts']) {
      assert(!/syncUserRoleMetadata/.test(readFileSync(f, 'utf8')),
        `${f.split('/').slice(-2).join('/')} does not call syncUserRoleMetadata`)
    }
    // Scan CODE only — both routes discuss Vendor.status at length in their comments (that
    // distinction is the point of the axis), so a raw scan would flag the explanation rather
    // than a write. This caught itself on first run.
    const stripComments = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    for (const f of ['app/api/admin/vendor-members/[id]/approve/route.ts',
                     'app/api/admin/vendor-members/[id]/reject/route.ts']) {
      const code = stripComments(readFileSync(f, 'utf8'))
      assert(!/\bvendor\.update\(/.test(code) && !/\bvendor\.updateMany\(/.test(code),
        `${f.split('/').slice(-2).join('/')} never writes the BOOTH axis (no vendor.update)`)
    }

    console.log(`\n── RESULT: ${pass} passed, ${fail} failed ──`)
  } finally {
    cacheMod?.__clearRedisOverrideForTest()
    await cleanup()
    console.log(`cleanup done (all ${PFX} rows removed)`)
    await prisma.$disconnect()
  }
  if (fail > 0) process.exit(1)
}

main().catch(async err => { console.error(err); await prisma.$disconnect(); process.exit(1) })
