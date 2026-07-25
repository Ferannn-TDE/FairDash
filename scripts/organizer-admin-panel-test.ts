/**
 * Organizer approval — SLICE 3: the admin Organizers panel.
 *
 * THE CONVERGENCE. The panel surfaces two capabilities that were built and proven but until
 * now had no UI: the #7 APPROVAL gate (pending/approved/rejected) and the A6 KILL-SWITCH
 * (suspend/un-suspend). This suite proves the panel drives them CORRECTLY and, above all,
 * PRESENTS THEM AS TWO DIFFERENT FACTS.
 *
 * It adds no new logic to test — so what it tests is:
 *
 *   1. the READ  (GET /api/admin/organizers) is real, strict-gated, and non-vacuously so;
 *   2. the ACTIONS, driven with the EXACT request shapes the panel sends (same URL, method and
 *      body as OrganizersPanel.act) — a UI that "calls the proven route" but with the wrong
 *      method is a UI that doesn't work, and this catches that;
 *   3. the DISTINCTION: pending ≠ suspended. An admin who confuses "we never let them in" with
 *      "we let them in, then stopped them" makes a real mistake. The view-model makes that
 *      distinction structural (lib/organizer-admin-view) and this asserts it — including that
 *      the UI cannot even OFFER a kill-switch for an organizer who was never admitted.
 *
 * End-to-end, the effect of each action is measured on a REAL organizer route
 * (GET /api/organizer/fairs, one of the 26 behind requireOrganizerAuth) — not on a helper.
 * Approve → it starts working. Suspend → it stops. Un-suspend → it works again.
 *
 * NON-VACUOUS BY CONSTRUCTION: every negative is paired with a positive control on the SAME
 * route (a real admin succeeds where the organizer was refused), so "refuses everyone" can
 * never masquerade as "correctly gated" — the {role:} vs {roles:[]} trap, designed out.
 *
 * Run: npx tsx --import ./scripts/_clerk-loader.mjs scripts/organizer-admin-panel-test.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
import { register } from 'node:module'
register('./_clerk-loader.mjs', import.meta.url) // substitute Clerk BEFORE any handler import

import { NextRequest } from 'next/server'
import { organizerRowView } from '../lib/organizer-admin-view'

const prisma = testPrisma()
const PFX = 'oaptest-'
const MAIL = '@oaptest.local'
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

let listH: any, approveH: any, rejectH: any, suspendH: any, organizerProbeH: any

// ── The panel's request shapes, verbatim. These mirror OrganizersPanel.act EXACTLY — same
//    URL, same HTTP method, same body. If the panel and the routes ever disagree on a method
//    (the ApprovalQueue PATCH-vs-POST trap), these calls break and the suite goes red.
async function panelList() {
  const res = await listH(new NextRequest('http://local/api/admin/organizers'))
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function panelApprove(id: string) {
  const res = await approveH(
    new NextRequest(`http://local/api/admin/organizers/${id}/approve`, { method: 'POST' }),
    { params: Promise.resolve({ id }) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function panelReject(id: string, reason?: string) {
  const res = await rejectH(new NextRequest(`http://local/api/admin/organizers/${id}/reject`, {
    method: 'POST', body: JSON.stringify({ reason }), headers: { 'Content-Type': 'application/json' },
  }), { params: Promise.resolve({ id }) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function panelSuspend(id: string, suspend: boolean, reason?: string | null) {
  const res = await suspendH(new NextRequest(`http://local/api/admin/organizers/${id}/suspend`, {
    method: 'PATCH',
    body: JSON.stringify(suspend ? { suspend: true, reason: reason ?? null } : { suspend: false }),
    headers: { 'Content-Type': 'application/json' },
  }), { params: Promise.resolve({ id }) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

/**
 * Can this organizer ACTUALLY operate? Drives a REAL organizer route (one of the 26 behind
 * requireOrganizerAuth) as the organizer themselves — the true end-to-end answer, measured on
 * product code rather than on a helper.
 *
 * THE PROBE IS GET /api/organizer/vendors, and the choice is deliberate twice over:
 *
 *  • SEMANTICS — vendor approval is the highest-stakes power the #7 gate protects (an
 *    unvetted organizer deciding who may sell at a fair). Proving THIS route flips is proving
 *    the gate where it matters most.
 *
 *  • IT CAN ACTUALLY SUCCEED — the first draft of this suite probed GET /api/organizer/fairs,
 *    which wraps its query in Next's unstable_cache. Outside a real Next server there is no
 *    incrementalCache, so that route 500s on the SUCCESS path... while still returning a
 *    correct 403 on the blocked path, because requireOrganizerAuth throws before ever reaching
 *    the cache. A probe that can only ever fail would have let every negative here pass
 *    VACUOUSLY — the same shape as the {role:} vs {roles:[]} trap, in a new costume. The
 *    baseline check in [0] now makes that impossible to reintroduce silently.
 */
async function canOperate(clerkId: string): Promise<{ ok: boolean; status: number; code?: string; message?: string }> {
  login(clerkId, ['organizer'])
  const res = await organizerProbeH(new NextRequest('http://local/api/organizer/vendors'))
  const json = await res.json().catch(() => ({}))
  return { ok: res.status === 200, status: res.status, code: json?.error?.code, message: json?.error?.message }
}

const findOrg = (list: any[], id: string) => list.find((o: any) => o.id === id)

async function cleanup() {
  await prisma.event.deleteMany({ where: { organizer: { contactEmail: { endsWith: MAIL } } } })
  await prisma.orgMember.deleteMany({ where: { organizer: { contactEmail: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

/** Seed one organizer + its owning user (so we can drive a real organizer route as them). */
async function seedOrg(label: string, data: Record<string, unknown>) {
  const user = await prisma.user.create({
    data: { clerkId: `${PFX}u-${rand()}`, email: `${PFX}u-${rand()}${MAIL}`, name: `${label} owner`, role: 'organizer' },
  })
  const org = await prisma.fairOrganizer.create({
    data: { name: label, contactEmail: `${PFX}o-${rand()}${MAIL}`, ...data } as any,
  })
  await prisma.orgMember.create({ data: { userId: user.id, organizerId: org.id, role: 'owner' } })
  return { org, user }
}

async function main() {
  ;({ GET: listH } = await import('../app/api/admin/organizers/route'))
  ;({ POST: approveH } = await import('../app/api/admin/organizers/[id]/approve/route'))
  ;({ POST: rejectH } = await import('../app/api/admin/organizers/[id]/reject/route'))
  ;({ PATCH: suspendH } = await import('../app/api/admin/organizers/[id]/suspend/route'))
  ;({ GET: organizerProbeH } = await import('../app/api/organizer/vendors/route'))

  await cleanup()
  try {
    // ── seed all four presentations the panel must render ──────────────────────────────
    const pending   = await seedOrg('Pending Org',   { approvalStatus: 'PENDING' })
    const approved  = await seedOrg('Approved Org',  { approvalStatus: 'APPROVED', approvedAt: new Date(), approvedBy: 'seed-admin', stripeAccountId: 'acct_seed', stripeVerified: true })
    const rejected  = await seedOrg('Rejected Org',  { approvalStatus: 'REJECTED', rejectionReason: 'insufficient documentation' })
    const suspended = await seedOrg('Suspended Org', { approvalStatus: 'APPROVED', approvedAt: new Date(), approvedBy: 'seed-admin', suspendedAt: new Date(), suspendedReason: 'fraud investigation' })

    // The approved organizer owns a real fair — so "their fairs" is rendered from real rows.
    await prisma.event.create({
      data: {
        name: 'Seeded Fair', urlSlug: `${PFX}fair-${rand()}`,
        startDate: new Date(), endDate: new Date(Date.now() + 864e5),
        organizerId: approved.org.id,
      },
    })

    const admin = await prisma.user.create({
      data: { clerkId: `${PFX}admin-${rand()}`, email: `${PFX}a-${rand()}${MAIL}`, name: 'Admin', role: 'admin' },
    })

    // ── [0] THE PROBE ITSELF IS TRUSTWORTHY ────────────────────────────────────────────
    // Before ANY 403 below is allowed to mean something, prove the probe route can return 200
    // at all — an ALREADY-APPROVED organizer must sail through it. Without this, a probe that
    // is simply broken (see the unstable_cache note on canOperate) would make every "the gate
    // refused them" assertion pass vacuously: refusing everyone and being incapable of
    // succeeding look IDENTICAL from the negative side. This is the anti-vacuity guard for the
    // measuring instrument itself, not just for the thing being measured.
    console.log('\n[0] the probe can actually SUCCEED (an approved organizer passes) — so a 403 below means something')
    const probeBaseline = await canOperate(approved.user.clerkId)
    assert(probeBaseline.ok === true, `an ALREADY-APPROVED organizer gets 200 from the probe route (got ${probeBaseline.status}) — the instrument works, so the refusals that follow are real`)

    // ── [1] THE READ IS STRICT-GATED — and not vacuously so ────────────────────────────
    console.log('\n[1] the panel’s list route is STRICT-gated (reading who is pending/rejected is as sensitive as deciding it)')
    for (const role of ['organizer', 'vendor', 'runner', 'event_operator']) {
      login(`${PFX}x-${rand()}`, [role])
      const r = await panelList()
      assert(r.status === 403, `${role} cannot read the organizer list → 403 (got ${r.status})`)
    }
    login(null)
    const anonList = await panelList()
    assert(anonList.status === 401 || anonList.status === 403, `anonymous → ${anonList.status} (refused)`)

    console.log('\n[1b] ✅ POSITIVE CONTROL: a strict admin CAN read it (so the 403s are real rejections, not a route that refuses everyone)')
    login(admin.clerkId, ['admin'])
    const listed = await panelList()
    assert(listed.status === 200, `admin → 200 (got ${listed.status})`)
    const rows = listed.json?.data?.organizers ?? []
    // The list is platform-wide, so it legitimately contains other (pre-existing) organizers
    // too — assert on OUR four specifically rather than a loose count that could drift.
    const seededIds = [pending.org.id, approved.org.id, rejected.org.id, suspended.org.id]
    assert(seededIds.every(id => !!findOrg(rows, id)), `the panel receives all 4 seeded organizers (of ${rows.length} platform-wide)`)

    // ── [2] THE PANEL RENDERS REAL DB STATE ────────────────────────────────────────────
    console.log('\n[2] the panel renders REAL organizer state from the DB (all four presentations)')
    const rPending   = findOrg(rows, pending.org.id)
    const rApproved  = findOrg(rows, approved.org.id)
    const rRejected  = findOrg(rows, rejected.org.id)
    const rSuspended = findOrg(rows, suspended.org.id)

    assert(rPending?.approvalStatus === 'PENDING',   'PENDING organizer is listed as PENDING')
    assert(rApproved?.approvalStatus === 'APPROVED', 'APPROVED organizer is listed as APPROVED')
    assert(rRejected?.approvalStatus === 'REJECTED', 'REJECTED organizer is listed as REJECTED')
    assert(rRejected?.rejectionReason === 'insufficient documentation', 'the rejection reason is surfaced to the admin (the same text the gate shows the organizer)')
    assert(!!rSuspended?.suspendedAt, 'SUSPENDED organizer carries suspendedAt')
    assert(rSuspended?.suspendedReason === 'fraud investigation', 'the suspension reason is surfaced')
    // Work-queue order, asserted as an INVARIANT over the whole list (not just rows[0], which
    // would pass by luck): no organizer needing a decision ever sorts below one that doesn't.
    const RANK: Record<string, number> = { PENDING: 0, APPROVED: 1, REJECTED: 2 }
    const ranks = rows.map((o: any) => RANK[o.approvalStatus] ?? 9)
    assert(ranks.every((r: number, i: number) => i === 0 || ranks[i - 1] <= r),
      'PENDING sorts first, always — the panel is a work queue before it is a directory')

    console.log('\n[2b] decision-relevant detail is real, not decorative')
    assert(rApproved?.stripeVerified === true && rApproved?.stripeConnected === true, 'Stripe Connect status is read from the row (can this organizer actually be paid?)')
    assert(rPending?.stripeConnected === false, 'an organizer with no Connect account is shown as unpayable')
    assert(rApproved?.fairCount === 1 && rApproved?.fairs?.[0]?.name === 'Seeded Fair', 'an approved organizer’s fairs are listed from real Event rows')
    assert(!!rPending?.appliedAt, 'applied-at is shown (how long has this application been waiting?)')

    // ── [3] ⛔ THE DISTINCTION: pending ≠ suspended ─────────────────────────────────────
    // The mistake this guards against: an admin un-suspending someone who was NEVER approved,
    // or hunting for a suspension on someone we simply never let in.
    console.log('\n[3] ⛔ PENDING and SUSPENDED are TWO DIFFERENT FACTS — never conflated')
    const vPending   = organizerRowView(rPending)
    const vApproved  = organizerRowView(rApproved)
    const vRejected  = organizerRowView(rRejected)
    const vSuspended = organizerRowView(rSuspended)

    assert(vPending.operating === 'NOT_ADMITTED', 'a PENDING organizer is NOT_ADMITTED — NOT "suspended" (nobody stopped them; we never let them in)')
    assert(vSuspended.operating === 'SUSPENDED', 'a suspended organizer is SUSPENDED')
    assert(vSuspended.approval === 'APPROVED', '…and is STILL "approved" — both facts are true at once, which is exactly why one badge could never say it')
    assert(vPending.operating !== vSuspended.operating, 'the two states are rendered differently (different operating state)')
    assert(vApproved.operating === 'ACTIVE' && vRejected.operating === 'NOT_ADMITTED', 'approved → Operating; rejected → Never admitted')

    console.log('\n[3b] the UI cannot OFFER the wrong action (affordances follow from the distinction)')
    assert(vPending.canSuspend === false,   '⛔ no Suspend button for a PENDING organizer — you cannot stop someone who was never let in')
    assert(vRejected.canSuspend === false,  '⛔ no Suspend button for a REJECTED organizer')
    assert(vPending.canUnsuspend === false, '⛔ no Un-suspend button for a PENDING organizer — the exact mistake the two-badge design prevents')
    assert(vApproved.canSuspend === true,   '✅ Suspend IS offered for an admitted, operating organizer')
    assert(vSuspended.canUnsuspend === true && vSuspended.canSuspend === false, '✅ a suspended organizer offers Un-suspend, not Suspend')
    assert(vPending.canApprove === true && vPending.canReject === true, 'a pending organizer offers Approve / Reject')
    assert(vRejected.canApprove === true, 'a rejected organizer can be reconsidered (the route allows REJECTED → APPROVED)')

    // ── [4] APPROVE → the organizer can now operate (a previously-403’d route succeeds) ─
    console.log('\n[4] APPROVE: a previously-403’d REAL organizer route starts succeeding')
    const before = await canOperate(pending.user.clerkId)
    assert(before.ok === false && before.status === 403, `before: GET /api/organizer/vendors (the vendor-approval power) → 403 (got ${before.status})`)
    assert(before.code === 'ORGANIZER_NOT_APPROVED', `…with ORGANIZER_NOT_APPROVED (got ${before.code})`)

    login(admin.clerkId, ['admin'])
    const appr = await panelApprove(pending.org.id)
    assert(appr.status === 200, `the panel’s Approve button (POST) → 200 (got ${appr.status}) — the UI drives the proven route correctly`)

    const after = await canOperate(pending.user.clerkId)
    assert(after.ok === true, `after: the SAME route now → 200 (got ${after.status}) — approval genuinely unlocks the organizer`)

    console.log('\n[4b] the panel RE-READS: the list now reports the new state from the DB')
    login(admin.clerkId, ['admin'])
    const afterList = (await panelList()).json?.data?.organizers ?? []
    assert(findOrg(afterList, pending.org.id)?.approvalStatus === 'APPROVED', 'the re-read list shows APPROVED (not a locally-patched guess)')
    assert(findOrg(afterList, pending.org.id)?.approvedBy === admin.clerkId, 'and records WHO approved — audit, on the row')

    // ── [5] SUSPEND → immediately blocked. UN-SUSPEND → restored. (A6, via the panel) ───
    console.log('\n[5] SUSPEND (the A6 kill-switch, driven by the panel): immediate block')
    login(admin.clerkId, ['admin'])
    const susp = await panelSuspend(pending.org.id, true, 'panel test')
    assert(susp.status === 200, `the panel’s Suspend button (PATCH) → 200 (got ${susp.status})`)

    const blocked = await canOperate(pending.user.clerkId)
    assert(blocked.ok === false && blocked.status === 403, `the just-approved organizer is IMMEDIATELY blocked → 403 (got ${blocked.status})`)
    assert(blocked.code === 'ORGANIZER_SUSPENDED', `…with ORGANIZER_SUSPENDED — a DIFFERENT code from NOT_APPROVED (got ${blocked.code})`)

    console.log('\n[5b] …and the panel shows it as the OTHER axis: approved, but stopped')
    login(admin.clerkId, ['admin'])
    const suspList = (await panelList()).json?.data?.organizers ?? []
    const vNow = organizerRowView(findOrg(suspList, pending.org.id))
    assert(vNow.approval === 'APPROVED' && vNow.operating === 'SUSPENDED', 'the row reads APPROVED + SUSPENDED — "we let them in, then stopped them", which is the truth')

    console.log('\n[5c] UN-SUSPEND: restored')
    login(admin.clerkId, ['admin'])
    const unsusp = await panelSuspend(pending.org.id, false)
    assert(unsusp.status === 200, `the panel’s Un-suspend button → 200 (got ${unsusp.status})`)
    const restored = await canOperate(pending.user.clerkId)
    assert(restored.ok === true, `the organizer can operate again → 200 (got ${restored.status})`)

    // ── [6] REJECT → terminal, reason required, reason surfaced ────────────────────────
    console.log('\n[6] REJECT: a reason is REQUIRED (the UI disables Confirm without one — the API refuses it)')
    login(admin.clerkId, ['admin'])
    const blank = await panelReject(pending.org.id, '   ')
    assert(blank.status === 400, `blank reason → 400 (got ${blank.status}) — so the disabled Confirm button matches the API, it isn’t decoration`)

    login(admin.clerkId, ['admin'])
    const rej = await panelReject(pending.org.id, 'did not pass vetting')
    assert(rej.status === 200, `the panel’s Reject button (POST, with reason) → 200 (got ${rej.status})`)

    const rejBlocked = await canOperate(pending.user.clerkId)
    assert(rejBlocked.ok === false, 'a REJECTED organizer is refused by the gate (terminal)')
    assert(rejBlocked.code === 'ORGANIZER_REJECTED', `…with ORGANIZER_REJECTED (got ${rejBlocked.code})`)
    assert(/did not pass vetting/.test(rejBlocked.message ?? ''), 'and the REASON is surfaced to the organizer — they hit an explanation, not a silent wall')

    // ── [7] Option A’s payoff, VISIBLE in the panel ────────────────────────────────────
    console.log('\n[7] Option A payoff: a rejected organizer owns 0 fairs — nothing orphaned')
    login(admin.clerkId, ['admin'])
    const finalList = (await panelList()).json?.data?.organizers ?? []
    const rejRow = findOrg(finalList, rejected.org.id)
    assert(rejRow?.fairCount === 0, 'the panel SHOWS 0 fairs for the rejected organizer')
    const dbFairs = await prisma.event.count({ where: { organizerId: rejected.org.id } })
    assert(dbFairs === 0, 'and the DB agrees — fair creation was gated, so rejection is clean (no orphaned fair to unwind)')

    // ── [8] the panel never invents a second source of truth ───────────────────────────
    console.log('\n[8] no second source of truth: every figure the panel shows is the DB’s')
    const dbRow = await prisma.fairOrganizer.findUnique({
      where: { id: pending.org.id },
      select: { approvalStatus: true, rejectionReason: true, suspendedAt: true, approvedBy: true },
    })
    const uiRow = findOrg(finalList, pending.org.id)
    assert(uiRow?.approvalStatus === dbRow?.approvalStatus, 'approvalStatus: panel === DB')
    assert(uiRow?.rejectionReason === dbRow?.rejectionReason, 'rejectionReason: panel === DB')
    assert((uiRow?.suspendedAt ?? null) === (dbRow?.suspendedAt?.toISOString() ?? null) || (!uiRow?.suspendedAt && !dbRow?.suspendedAt), 'suspendedAt: panel === DB')
    assert(uiRow?.approvedBy === dbRow?.approvedBy, 'approvedBy: panel === DB')

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
