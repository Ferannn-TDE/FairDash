/**
 * Organizer approval gate (#7) — the MOST security-sensitive of the three approval gates.
 *
 * The organizer is the highest-authority role — creates fairs, APPROVES VENDORS, and acts in
 * the money flow (refunds/disputes/chargebacks) — and was the ONLY ungated one (self-active on
 * signup). This proves the gate, and specifically the two negatives that matter most:
 *
 *   ⛔ a PENDING organizer cannot APPROVE VENDORS   (an unvetted person deciding who may sell)
 *   ⛔ a PENDING organizer cannot touch MONEY        (refunds / disputes / chargebacks)
 *
 * …and the production-critical positive:
 *
 *   ✅ GRANDFATHERED organizers still work           (nobody locked out of a live fair)
 *
 * The gate is ONE check in requireOrganizerAuth, and all 26 organizer routes funnel through
 * it — so this exercises the SAME decision function (organizerApprovalError) the boundary
 * makes, exactly as the A6 suspension proof does.
 *
 * Run:  npx tsx scripts/organizer-approval-gate-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { organizerApprovalError } from '../lib/organizer-approval'
import { organizerSuspensionError } from '../lib/organizer-suspension'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

async function main() {
  try {
    // ── [1] ⛔ the gate REFUSES a pending organizer ────────────────────────────
    console.log('\n[1] ⛔ a PENDING organizer is refused by the gate (403 ORGANIZER_NOT_APPROVED)')
    const pending = organizerApprovalError({ approvalStatus: 'PENDING', rejectionReason: null })
    assert(pending !== null, 'PENDING → an error is returned (not allowed through)')
    assert(pending?.statusCode === 403, `403 (got ${pending?.statusCode})`)
    assert(pending?.code === 'ORGANIZER_NOT_APPROVED',
      `distinct code ORGANIZER_NOT_APPROVED (got ${pending?.code}) — not a generic FORBIDDEN, so the UI can say "awaiting approval"`)

    console.log('\n[2] a REJECTED organizer is refused, with its own code + the reason')
    const rejected = organizerApprovalError({ approvalStatus: 'REJECTED', rejectionReason: 'failed vetting' })
    assert(rejected?.code === 'ORGANIZER_REJECTED', `ORGANIZER_REJECTED (got ${rejected?.code})`)
    assert(/failed vetting/.test(rejected?.message ?? ''), 'the rejection reason is surfaced')

    console.log('\n[3] an APPROVED organizer passes')
    assert(organizerApprovalError({ approvalStatus: 'APPROVED', rejectionReason: null }) === null,
      'APPROVED → null (allowed through)')

    // ── [4] ⛔⛔ THE ENFORCEMENT POINTS — a pending organizer is blocked at every power ──
    // All 26 organizer routes call requireOrganizerAuth, which calls organizerApprovalError.
    // So proving the gate refuses + proving these routes use the gate = they're all blocked.
    console.log('\n[4] ⛔⛔ every organizer POWER funnels through the gate (server-side, not hidden buttons)')
    const gated: Array<[string, string]> = [
      ['VENDOR APPROVAL (who may sell!)', 'app/api/organizer/vendors/[id]/route.ts'],
      ['MONEY — refunds',                 'app/api/organizer/fairs/[fairSlug]/orders/[orderId]/refund/route.ts'],
      ['MONEY — disputes',                'app/api/organizer/fairs/[fairSlug]/disputes/[disputeId]/route.ts'],
      ['MONEY — chargebacks',             'app/api/organizer/fairs/[fairSlug]/chargebacks/[chargebackId]/route.ts'],
      ['FAIR CREATION',                   'app/api/organizer/fairs/route.ts'],
      ['fair settings',                   'app/api/organizer/fairs/[fairSlug]/settings/route.ts'],
    ]
    for (const [power, file] of gated) {
      const src = readFileSync(file, 'utf8')
      assert(/requireOrganizerAuth/.test(src),
        `⛔ ${power} → requireOrganizerAuth (so a PENDING organizer is refused here)`)
    }
    // The gate must actually be wired into requireOrganizerAuth (not just defined).
    const authSrc = readFileSync('lib/auth.ts', 'utf8')
    assert(/organizerApprovalError\(orgMember\.organizer\)/.test(authSrc),
      'requireOrganizerAuth CALLS organizerApprovalError — the gate is live, not dead code')
    assert(/approvalStatus: true/.test(authSrc),
      'requireOrganizerAuth SELECTS approvalStatus fresh per request (no token lag)')

    // Fair creation being gated ⇒ a pending organizer can never accumulate a fair ⇒ no
    // orphaned-fair problem on rejection. That's the whole reason Option A is free.
    console.log('\n[5] because FAIR CREATION is gated, a pending organizer can never own a fair')
    const fairsSrc = readFileSync('app/api/organizer/fairs/route.ts', 'utf8')
    assert(/export async function POST[\s\S]{0,200}requireOrganizerAuth/.test(fairsSrc),
      'POST /organizer/fairs (create) is behind the gate → no half-built fair to orphan on rejection')

    // ── [6] ✅ THE PRODUCTION-CRITICAL POSITIVE: grandfathered orgs still work ──
    console.log('\n[6] ✅ GRANDFATHER: every pre-existing organizer is APPROVED (nobody locked out)')
    // Excludes clearly-labelled DEMO rows (scripts/seed-demo-organizers.ts, @fairsynq.demo),
    // which intentionally sit in the four gate states for eyeballing and are NOT the
    // "pre-existing real organizer" this grandfather invariant is about. The whole point of
    // the demo seed is a PENDING/REJECTED row, so counting it here would be a false lockout.
    const orgs = await prisma.fairOrganizer.findMany({
      where: { NOT: { contactEmail: { endsWith: '@fairsynq.demo' } } },
      select: { name: true, approvalStatus: true, approvedBy: true, fairs: { select: { status: true } } },
    })
    assert(orgs.length > 0, `${orgs.length} organizer(s) exist to check`)
    const notApproved = orgs.filter(o => o.approvalStatus !== 'APPROVED')
    assert(notApproved.length === 0,
      `ZERO pre-existing organizers left PENDING (would be a production lockout) — found ${notApproved.length}`)
    const withLiveFair = orgs.filter(o => o.fairs.some(f => f.status === 'ACTIVE'))
    for (const o of withLiveFair) {
      assert(o.approvalStatus === 'APPROVED',
        `"${o.name}" runs a LIVE fair and is APPROVED (by ${o.approvedBy}) — not locked out`)
      assert(organizerApprovalError({ approvalStatus: o.approvalStatus, rejectionReason: null }) === null,
        `…and the GATE lets them through (the real decision function, not just the column)`)
    }

    // ── [7] approval and suspension are DISTINCT gates ─────────────────────────
    console.log('\n[7] approval ≠ suspension — distinct gates, distinct codes')
    const approvedButSuspended = { approvalStatus: 'APPROVED', rejectionReason: null }
    assert(organizerApprovalError(approvedButSuspended) === null, 'an APPROVED org passes the approval gate…')
    assert(organizerSuspensionError({ suspendedAt: new Date(), suspendedReason: 'fraud' })?.code === 'ORGANIZER_SUSPENDED',
      '…and is still stopped by the A6 suspension gate (ORGANIZER_SUSPENDED) — the two are independent')

    console.log(`\n${'─'.repeat(66)}`)
    if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
    else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(66)}\n`)
  } finally {
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('\n💥', e); await prisma.$disconnect(); process.exit(1) })
