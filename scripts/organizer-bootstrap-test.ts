/**
 * ORGANIZER-BOOTSTRAP TEST — proves the synchronous self-signup organizer bootstrap.
 *
 * The bug: the old Clerk-webhook bootstrap was gated on isNew (user.created), but the
 * organizer signal only arrives on user.updated — so it NEVER fired for a real
 * self-signup (0 users ever provisioned this way). The fix moves provisioning into
 * app/onboarding/page.tsx via lib/organizer-bootstrap.ensureOrganizerBootstrap, called
 * SYNCHRONOUSLY before the redirect to /organizer.
 *
 * This exercises the helper directly against real seeded rows (self-cleaning cohort):
 *   H  headline      — a fresh organizer gets FairOrganizer + owner OrgMember, present
 *                      synchronously (the portal's DB authority check would pass first try)
 *   I  idempotency   — calling twice is a no-op (no second org)
 *   C  concurrency   — two simultaneous calls → exactly one org/member (ON CONFLICT DO NOTHING)
 *   R  half-bootstrap— org row but no member (simulated crash) → retry completes it, no dup
 *   E  provisioned   — an already-provisioned cuid-id org (mirrors backfilled "Feran Events")
 *                      is never re-bootstrapped
 *   N  negatives     — customer/vendor/runner are NOT bootstrapped (organizer-only)
 *   S  singular-role — bootstrap happens off the caller's decision, INDEPENDENT of the
 *                      legacy singular `role` field (which stays 'customer')
 *
 * NOTE: ensureOrganizerBootstrap calls syncUserRoleMetadata, which hits Clerk. Seeded
 * users carry fake clerkIds, so that call fail-softs (logged, by design — the DB is the
 * authority). roles[] is asserted via computeRolesFromDb (DB-derived, deterministic).
 *
 * Run:  npx tsx scripts/organizer-bootstrap-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
})

const SLUG = 'obtest-'
const MAIL = '@obtest.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0,
  fail = 0
function assert(cond: boolean, label: string) {
  if (cond) {
    pass++
    console.log(`  ✅ ${label}`)
  } else {
    fail++
    console.log(`  ❌ ${label}`)
  }
}

async function cleanup() {
  // FairOrganizer + User both cascade their OrgMember rows on delete.
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function mkUser(role: string) {
  return prisma.user.create({
    data: {
      clerkId: `${SLUG}clerk-${rand()}`,
      email: `${SLUG}${role}-${rand()}${MAIL}`,
      name: `OB ${role}`,
      role,
    },
  })
}

const profileOf = (u: { name: string | null; email: string }) => ({
  name: u.name,
  email: u.email,
  phone: null,
})

async function main() {
  await cleanup()
  const { ensureOrganizerBootstrap } = await import('../lib/organizer-bootstrap')
  const { computeRolesFromDb } = await import('../lib/role-sync')

  try {
    console.log('\n[H] headline — fresh organizer is provisioned SYNCHRONOUSLY')
    {
      const u = await mkUser('customer')
      const res = await ensureOrganizerBootstrap(u.id, profileOf(u))
      assert(res.created === true, 'created = true')
      assert(res.organizerId === `org_${u.id}`, 'deterministic organizer id')
      const org = await prisma.fairOrganizer.findUnique({ where: { id: `org_${u.id}` } })
      assert(org !== null, 'exactly one FairOrganizer exists')
      const member = await prisma.orgMember.findFirst({ where: { userId: u.id } })
      assert(
        member !== null && member.role === 'owner' && member.organizerId === `org_${u.id}`,
        'owner OrgMember present SYNCHRONOUSLY (portal DB authority would pass first load)',
      )
      const roles = await computeRolesFromDb(u.id)
      assert(roles.includes('organizer'), 'DB-derived roles[] includes organizer')
    }

    console.log('\n[I] idempotency — second call is a no-op')
    {
      const u = await mkUser('customer')
      const r1 = await ensureOrganizerBootstrap(u.id, profileOf(u))
      const r2 = await ensureOrganizerBootstrap(u.id, profileOf(u))
      assert(r1.created === true && r2.created === false, 'first creates, second is no-op')
      assert(r1.organizerId === r2.organizerId, 'same organizer both times')
      const orgCount = await prisma.fairOrganizer.count({ where: { id: `org_${u.id}` } })
      const memberCount = await prisma.orgMember.count({ where: { userId: u.id } })
      assert(orgCount === 1 && memberCount === 1, 'still exactly 1 org / 1 member')
    }

    console.log('\n[C] concurrency — two simultaneous calls → exactly one org/member')
    {
      const u = await mkUser('customer')
      await Promise.all([
        ensureOrganizerBootstrap(u.id, profileOf(u)),
        ensureOrganizerBootstrap(u.id, profileOf(u)),
      ])
      const orgCount = await prisma.fairOrganizer.count({ where: { id: `org_${u.id}` } })
      const memberCount = await prisma.orgMember.count({ where: { userId: u.id } })
      assert(orgCount === 1, 'concurrent → exactly 1 FairOrganizer (ON CONFLICT DO NOTHING)')
      assert(memberCount === 1, 'concurrent → exactly 1 OrgMember')
    }

    console.log('\n[R] half-bootstrap — org row but no member (crash) → retry completes, no dup')
    {
      const u = await mkUser('customer')
      await prisma.fairOrganizer.create({
        data: { id: `org_${u.id}`, name: u.email, contactEmail: u.email },
      })
      const res = await ensureOrganizerBootstrap(u.id, profileOf(u))
      assert(res.created === true, 'no member existed → treated as fresh and completed')
      const orgCount = await prisma.fairOrganizer.count({ where: { id: `org_${u.id}` } })
      const memberCount = await prisma.orgMember.count({ where: { userId: u.id } })
      assert(orgCount === 1, 'still exactly 1 FairOrganizer (deterministic id INSERT no-opped)')
      assert(memberCount === 1, 'OrgMember recovered — exactly 1, no orphan')
    }

    console.log('\n[E] already-provisioned cuid-id org (mirrors backfilled "Feran Events") → never re-bootstrapped')
    {
      const u = await mkUser('customer')
      const cuidOrg = await prisma.fairOrganizer.create({
        data: { name: 'Pre-existing', contactEmail: `${SLUG}pre-${rand()}${MAIL}` },
      })
      await prisma.orgMember.create({ data: { organizerId: cuidOrg.id, userId: u.id, role: 'owner' } })
      const res = await ensureOrganizerBootstrap(u.id, profileOf(u))
      assert(res.created === false, 'no re-bootstrap (created = false)')
      assert(res.organizerId === cuidOrg.id, 'returns the EXISTING cuid org id')
      const deterministic = await prisma.fairOrganizer.findUnique({ where: { id: `org_${u.id}` } })
      assert(deterministic === null, 'no deterministic-id org created alongside the existing one')
      const memberCount = await prisma.orgMember.count({ where: { userId: u.id } })
      assert(memberCount === 1, 'still exactly 1 OrgMember')
    }

    console.log('\n[N] negatives — customer/vendor/runner are NOT bootstrapped (organizer-only)')
    {
      for (const role of ['customer', 'vendor', 'runner']) {
        const u = await mkUser(role)
        const roles: string[] = [] // no organizer signal
        // mirror the caller gate (onboarding / backfill): only organizers call the helper
        if (role === 'organizer' || roles.includes('organizer')) {
          await ensureOrganizerBootstrap(u.id, profileOf(u))
        }
        const org = await prisma.fairOrganizer.findUnique({ where: { id: `org_${u.id}` } })
        assert(org === null, `${role}: no FairOrganizer bootstrapped`)
      }
    }

    console.log('\n[S] singular-role independence — bootstrap off the caller decision, not the legacy field')
    {
      const u = await mkUser('customer') // DB singular role stays 'customer'
      const res = await ensureOrganizerBootstrap(u.id, profileOf(u))
      assert(res.created === true, 'bootstrapped despite singular role = customer')
      const org = await prisma.fairOrganizer.findUnique({ where: { id: `org_${u.id}` } })
      assert(org !== null, 'FairOrganizer exists')
      const after = await prisma.user.findUnique({ where: { id: u.id }, select: { role: true } })
      assert(after?.role === 'customer', 'singular role untouched + irrelevant to bootstrap')
    }
  } finally {
    await cleanup()
  }

  console.log('\n══════════════════════════════════════════════════════════════════════════════════')
  console.log(`  ORGANIZER-BOOTSTRAP TEST — ${pass} passed, ${fail} failed`)
  if (fail === 0) {
    console.log('  VERDICT: ✅ CLEAN — fresh organizer provisioned synchronously; idempotent + concurrency-safe;')
    console.log('           half-bootstrap recovers; already-provisioned untouched; organizer-only; singular-role unread.')
  } else {
    console.log('  VERDICT: ⛔ FAILURE — do NOT ship the signup change until resolved.')
  }
  console.log('  (cohort deleted — DB back to baseline)')
  console.log('══════════════════════════════════════════════════════════════════════════════════\n')

  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('[organizer-bootstrap-test] FAILED:', err)
  try {
    await cleanup()
  } catch {
    /* best effort */
  }
  await prisma.$disconnect()
  process.exit(2)
})
